/**
 * Encryption Service for Bonsai PWA
 * 
 * Manages encryption state, session keys, and provides the interface
 * for encrypting/decrypting data at rest.
 * 
 * Encryption state is stored in localStorage (metadata only, never the passphrase).
 * Session key (CryptoKey) is held in memory only.
 */

import {
  deriveKey,
  generateSalt,
  createKeyHash,
  verifyPassphrase,
  encrypt,
  decrypt,
  arrayBufferToBase64,
  base64ToArrayBuffer,
  ENCRYPTION_VERSION,
  DEFAULT_ITERATIONS,
  type EncryptionMetadata,
  type EncryptedData,
} from './crypto';
import type { BonsaiDatabase } from '../database';
import { db as defaultDb, nowISO } from '../database';
import type { Message, MessageRevision, Conversation } from '../types';

// ============================================================================
// Constants
// ============================================================================

const STORAGE_KEY = 'bonsai:encryption:metadata';
const API_KEY_STORAGE_KEY = 'bonsai:encryption:apiKey';

// ============================================================================
// State
// ============================================================================

/** In-memory session key - never persisted */
let sessionKey: CryptoKey | null = null;

/**
 * In-memory cache for decrypted content
 * Key: content checksum (first 16 chars of ciphertext), Value: decrypted plaintext
 * This prevents repeated decryption of the same encrypted content
 * IMPORTANT: Cleared on lock() for security
 */
const decryptionCache = new Map<string, string>();

/** Maximum cache entries to prevent unbounded memory growth */
const MAX_CACHE_ENTRIES = 10000;

/**
 * Get a cache key from encrypted data
 * Uses ciphertext prefix as a unique identifier
 */
function getCacheKey(encData: EncryptedData): string {
  // Use first 24 chars of ciphertext + iv as a unique key
  return `${encData.iv.slice(0, 12)}:${encData.ciphertext.slice(0, 12)}`;
}

/**
 * Clear the decryption cache (security: call on lock)
 */
export function clearDecryptionCache(): void {
  decryptionCache.clear();
}

/**
 * Get decryption cache statistics (for diagnostics)
 */
export function getDecryptionCacheStats(): { size: number; maxSize: number } {
  return {
    size: decryptionCache.size,
    maxSize: MAX_CACHE_ENTRIES,
  };
}

// ============================================================================
// Metadata Management
// ============================================================================

/**
 * Get encryption metadata from localStorage
 */
export function getEncryptionMetadata(): EncryptionMetadata | null {
  try {
    const json = localStorage.getItem(STORAGE_KEY);
    if (!json) return null;
    return JSON.parse(json) as EncryptionMetadata;
  } catch {
    return null;
  }
}

/**
 * Save encryption metadata to localStorage
 */
export function saveEncryptionMetadata(metadata: EncryptionMetadata): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(metadata));
}

/**
 * Remove encryption metadata from localStorage
 */
export function clearEncryptionMetadata(): void {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(API_KEY_STORAGE_KEY);
}

// ============================================================================
// Session Key Management
// ============================================================================

/**
 * Check if encryption is enabled (metadata exists)
 */
export function isEncryptionEnabled(): boolean {
  return getEncryptionMetadata() !== null;
}

/**
 * Check if the app is currently unlocked (session key in memory)
 */
export function isUnlocked(): boolean {
  return sessionKey !== null;
}

/**
 * Check if the app is locked (encryption enabled but no session key)
 */
export function isLocked(): boolean {
  return isEncryptionEnabled() && !isUnlocked();
}

/**
 * Get the current session key (for internal use)
 * @throws Error if not unlocked
 */
export function getSessionKey(): CryptoKey {
  if (!sessionKey) {
    throw new Error('App is locked. Unlock with passphrase first.');
  }
  return sessionKey;
}

/**
 * Set the session key (internal use only)
 */
function setSessionKey(key: CryptoKey | null): void {
  sessionKey = key;
}

/**
 * Lock the app (clear session key and caches from memory)
 * Security: Clears all decrypted data from memory
 */
export function lock(): void {
  setSessionKey(null);
  clearDecryptionCache();
}

// ============================================================================
// Unlock Flow
// ============================================================================

/**
 * Unlock the app with a passphrase
 * 
 * @param passphrase - User's passphrase
 * @returns true if successful, false if passphrase is wrong
 * @throws Error if encryption is not enabled
 */
export async function unlock(passphrase: string): Promise<boolean> {
  const metadata = getEncryptionMetadata();
  if (!metadata) {
    throw new Error('Encryption is not enabled');
  }

  const isValid = await verifyPassphrase(passphrase, metadata);
  if (!isValid) {
    return false;
  }

  // Derive the key and store in memory
  const salt = new Uint8Array(base64ToArrayBuffer(metadata.salt));
  const key = await deriveKey(passphrase, salt, metadata.iterations);
  setSessionKey(key);
  return true;
}

// ============================================================================
// Enable/Disable Encryption
// ============================================================================

/**
 * Enable encryption with a new passphrase
 * 
 * @param passphrase - New passphrase to set
 * @param database - Database instance
 * @returns Migration result
 */
export async function enableEncryption(
  passphrase: string,
  database: BonsaiDatabase = defaultDb
): Promise<{ success: boolean; error?: string; migratedMessages: number }> {
  if (isEncryptionEnabled()) {
    return { success: false, error: 'Encryption is already enabled', migratedMessages: 0 };
  }

  try {
    // Generate salt and derive key
    const salt = generateSalt();
    const key = await deriveKey(passphrase, salt, DEFAULT_ITERATIONS);
    const keyHash = await createKeyHash(key, salt);

    // Create metadata
    const metadata: EncryptionMetadata = {
      version: ENCRYPTION_VERSION,
      salt: arrayBufferToBase64(salt.buffer as ArrayBuffer),
      iterations: DEFAULT_ITERATIONS,
      enabledAt: nowISO(),
      keyHash,
    };

    // Migrate existing data
    let migratedMessages = 0;

    await database.transaction('rw', [database.messages, database.messageRevisions, database.conversations], async () => {
      // Encrypt all message content
      const messages = await database.messages.toArray();
      for (const message of messages) {
        const encryptedContent = await encrypt(message.content, key);
        const encryptedBranchTitle = message.branchTitle 
          ? await encrypt(message.branchTitle, key) 
          : null;

        await database.messages.update(message.id, {
          contentEnc: encryptedContent,
          branchTitleEnc: encryptedBranchTitle,
          content: '', // Clear plaintext
          branchTitle: undefined,
        });
        migratedMessages++;
      }

      // Encrypt all message revisions
      const revisions = await database.messageRevisions.toArray();
      for (const revision of revisions) {
        const encryptedContent = await encrypt(revision.previousContent, key);
        await database.messageRevisions.update(revision.id, {
          previousContentEnc: encryptedContent,
          previousContent: '', // Clear plaintext
        });
      }

      // Encrypt conversation titles
      const conversations = await database.conversations.toArray();
      for (const conversation of conversations) {
        const encryptedTitle = await encrypt(conversation.title, key);
        await database.conversations.update(conversation.id, {
          titleEnc: encryptedTitle,
          title: '', // Clear plaintext (will show as "Encrypted" when locked)
        });
      }
    });

    // Also encrypt the API key if present
    const plainApiKey = localStorage.getItem('bonsai:nanogpt:apiKey');
    if (plainApiKey) {
      const encryptedApiKey = await encrypt(plainApiKey, key);
      localStorage.setItem(API_KEY_STORAGE_KEY, JSON.stringify(encryptedApiKey));
      localStorage.removeItem('bonsai:nanogpt:apiKey');
    }

    // Save metadata and set session key
    saveEncryptionMetadata(metadata);
    setSessionKey(key);

    return { success: true, migratedMessages };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during encryption setup',
      migratedMessages: 0,
    };
  }
}

/**
 * Disable encryption (requires current passphrase)
 * 
 * @param passphrase - Current passphrase to verify
 * @param database - Database instance
 * @returns Migration result
 */
export async function disableEncryption(
  passphrase: string,
  database: BonsaiDatabase = defaultDb
): Promise<{ success: boolean; error?: string; migratedMessages: number }> {
  const metadata = getEncryptionMetadata();
  if (!metadata) {
    return { success: false, error: 'Encryption is not enabled', migratedMessages: 0 };
  }

  // Verify passphrase
  const isValid = await verifyPassphrase(passphrase, metadata);
  if (!isValid) {
    return { success: false, error: 'Incorrect passphrase', migratedMessages: 0 };
  }

  try {
    // Derive key
    const salt = new Uint8Array(base64ToArrayBuffer(metadata.salt));
    const key = await deriveKey(passphrase, salt, metadata.iterations);

    let migratedMessages = 0;

    await database.transaction('rw', [database.messages, database.messageRevisions, database.conversations], async () => {
      // Decrypt all message content
      const messages = await database.messages.toArray();
      for (const message of messages) {
        const msg = message as Message & { contentEnc?: EncryptedData; branchTitleEnc?: EncryptedData };
        if (msg.contentEnc) {
          const decryptedContent = await decrypt(msg.contentEnc, key);
          const decryptedBranchTitle = msg.branchTitleEnc 
            ? await decrypt(msg.branchTitleEnc, key) 
            : undefined;

          await database.messages.update(message.id, {
            content: decryptedContent,
            branchTitle: decryptedBranchTitle,
            contentEnc: undefined,
            branchTitleEnc: undefined,
          });
          migratedMessages++;
        }
      }

      // Decrypt all message revisions
      const revisions = await database.messageRevisions.toArray();
      for (const revision of revisions) {
        const rev = revision as MessageRevision & { previousContentEnc?: EncryptedData };
        if (rev.previousContentEnc) {
          const decryptedContent = await decrypt(rev.previousContentEnc, key);
          await database.messageRevisions.update(revision.id, {
            previousContent: decryptedContent,
            previousContentEnc: undefined,
          });
        }
      }

      // Decrypt conversation titles
      const conversations = await database.conversations.toArray();
      for (const conversation of conversations) {
        const conv = conversation as Conversation & { titleEnc?: EncryptedData };
        if (conv.titleEnc) {
          const decryptedTitle = await decrypt(conv.titleEnc, key);
          await database.conversations.update(conversation.id, {
            title: decryptedTitle,
            titleEnc: undefined,
          });
        }
      }
    });

    // Decrypt the API key if present
    const encryptedApiKeyJson = localStorage.getItem(API_KEY_STORAGE_KEY);
    if (encryptedApiKeyJson) {
      const encryptedApiKey = JSON.parse(encryptedApiKeyJson) as EncryptedData;
      const plainApiKey = await decrypt(encryptedApiKey, key);
      localStorage.setItem('bonsai:nanogpt:apiKey', plainApiKey);
      localStorage.removeItem(API_KEY_STORAGE_KEY);
    }

    // Clear metadata and session key
    clearEncryptionMetadata();
    setSessionKey(null);

    return { success: true, migratedMessages };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during decryption',
      migratedMessages: 0,
    };
  }
}

/**
 * Change passphrase (requires current passphrase)
 * 
 * @param currentPassphrase - Current passphrase
 * @param newPassphrase - New passphrase
 * @param database - Database instance
 * @returns Success result
 */
export async function changePassphrase(
  currentPassphrase: string,
  newPassphrase: string,
  database: BonsaiDatabase = defaultDb
): Promise<{ success: boolean; error?: string }> {
  const metadata = getEncryptionMetadata();
  if (!metadata) {
    return { success: false, error: 'Encryption is not enabled' };
  }

  // Verify current passphrase
  const isValid = await verifyPassphrase(currentPassphrase, metadata);
  if (!isValid) {
    return { success: false, error: 'Incorrect current passphrase' };
  }

  try {
    // Derive old and new keys
    const oldSalt = new Uint8Array(base64ToArrayBuffer(metadata.salt));
    const oldKey = await deriveKey(currentPassphrase, oldSalt, metadata.iterations);
    
    const newSalt = generateSalt();
    const newKey = await deriveKey(newPassphrase, newSalt, DEFAULT_ITERATIONS);
    const newKeyHash = await createKeyHash(newKey, newSalt);

    await database.transaction('rw', [database.messages, database.messageRevisions, database.conversations], async () => {
      // Re-encrypt all message content
      const messages = await database.messages.toArray();
      for (const message of messages) {
        const msg = message as Message & { contentEnc?: EncryptedData; branchTitleEnc?: EncryptedData };
        if (msg.contentEnc) {
          // Decrypt with old key, encrypt with new key
          const decryptedContent = await decrypt(msg.contentEnc, oldKey);
          const newEncryptedContent = await encrypt(decryptedContent, newKey);
          
          const newEncryptedBranchTitle = msg.branchTitleEnc 
            ? await encrypt(await decrypt(msg.branchTitleEnc, oldKey), newKey) 
            : null;

          await database.messages.update(message.id, {
            contentEnc: newEncryptedContent,
            branchTitleEnc: newEncryptedBranchTitle,
          });
        }
      }

      // Re-encrypt all message revisions
      const revisions = await database.messageRevisions.toArray();
      for (const revision of revisions) {
        const rev = revision as MessageRevision & { previousContentEnc?: EncryptedData };
        if (rev.previousContentEnc) {
          const decryptedContent = await decrypt(rev.previousContentEnc, oldKey);
          const newEncryptedContent = await encrypt(decryptedContent, newKey);
          await database.messageRevisions.update(revision.id, {
            previousContentEnc: newEncryptedContent,
          });
        }
      }

      // Re-encrypt conversation titles
      const conversations = await database.conversations.toArray();
      for (const conversation of conversations) {
        const conv = conversation as Conversation & { titleEnc?: EncryptedData };
        if (conv.titleEnc) {
          const decryptedTitle = await decrypt(conv.titleEnc, oldKey);
          const newEncryptedTitle = await encrypt(decryptedTitle, newKey);
          await database.conversations.update(conversation.id, {
            titleEnc: newEncryptedTitle,
          });
        }
      }
    });

    // Re-encrypt the API key if present
    const encryptedApiKeyJson = localStorage.getItem(API_KEY_STORAGE_KEY);
    if (encryptedApiKeyJson) {
      const encryptedApiKey = JSON.parse(encryptedApiKeyJson) as EncryptedData;
      const plainApiKey = await decrypt(encryptedApiKey, oldKey);
      const newEncryptedApiKey = await encrypt(plainApiKey, newKey);
      localStorage.setItem(API_KEY_STORAGE_KEY, JSON.stringify(newEncryptedApiKey));
    }

    // Update metadata with new salt and key hash
    const newMetadata: EncryptionMetadata = {
      ...metadata,
      salt: arrayBufferToBase64(newSalt.buffer as ArrayBuffer),
      keyHash: newKeyHash,
    };
    saveEncryptionMetadata(newMetadata);
    setSessionKey(newKey);

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during passphrase change',
    };
  }
}

// ============================================================================
// API Key Encryption
// ============================================================================

/**
 * Get the API key (decrypted if encryption is enabled)
 * @returns Plain API key or null
 */
export async function getDecryptedApiKey(): Promise<string | null> {
  if (!isEncryptionEnabled()) {
    return localStorage.getItem('bonsai:nanogpt:apiKey');
  }

  if (!isUnlocked()) {
    return null; // Can't get API key while locked
  }

  const encryptedJson = localStorage.getItem(API_KEY_STORAGE_KEY);
  if (!encryptedJson) {
    return null;
  }

  try {
    const encrypted = JSON.parse(encryptedJson) as EncryptedData;
    return await decrypt(encrypted, getSessionKey());
  } catch {
    return null;
  }
}

/**
 * Set the API key (encrypts if encryption is enabled)
 * @param apiKey - Plain API key to store
 */
export async function setEncryptedApiKey(apiKey: string): Promise<void> {
  if (!isEncryptionEnabled()) {
    localStorage.setItem('bonsai:nanogpt:apiKey', apiKey);
    return;
  }

  if (!isUnlocked()) {
    throw new Error('Cannot set API key while locked');
  }

  const encrypted = await encrypt(apiKey, getSessionKey());
  localStorage.setItem(API_KEY_STORAGE_KEY, JSON.stringify(encrypted));
}

/**
 * Clear the API key
 */
export function clearEncryptedApiKey(): void {
  localStorage.removeItem('bonsai:nanogpt:apiKey');
  localStorage.removeItem(API_KEY_STORAGE_KEY);
}

// ============================================================================
// Content Encryption Helpers (for repository layer)
// ============================================================================

/**
 * Encrypt message content for storage
 * Returns encrypted data if encryption is enabled and unlocked,
 * otherwise returns the plaintext unchanged.
 */
export async function encryptContent(content: string): Promise<{ content: string; contentEnc?: EncryptedData }> {
  if (!isEncryptionEnabled() || !isUnlocked()) {
    return { content };
  }
  
  const encrypted = await encrypt(content, getSessionKey());
  return { content: '', contentEnc: encrypted };
}

/**
 * Decrypt message content from storage
 * Returns decrypted content if encryption is enabled and unlocked,
 * otherwise returns the stored content unchanged.
 *
 * Performance: Uses in-memory cache to avoid repeated decryption
 */
export async function decryptContent(
  content: string,
  contentEnc?: EncryptedData | null
): Promise<string> {
  if (!contentEnc) {
    return content;
  }

  if (!isUnlocked()) {
    return '[Encrypted - unlock to view]';
  }

  // Check cache first
  const cacheKey = getCacheKey(contentEnc);
  const cached = decryptionCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const decrypted = await decrypt(contentEnc, getSessionKey());

    // Cache the result (with size limit)
    if (decryptionCache.size < MAX_CACHE_ENTRIES) {
      decryptionCache.set(cacheKey, decrypted);
    }

    return decrypted;
  } catch {
    return '[Decryption failed]';
  }
}

/**
 * Encrypt optional field (branchTitle, etc.)
 */
export async function encryptOptionalField(
  value: string | undefined
): Promise<{ value?: string; valueEnc?: EncryptedData }> {
  if (!value) {
    return {};
  }
  
  if (!isEncryptionEnabled() || !isUnlocked()) {
    return { value };
  }
  
  const encrypted = await encrypt(value, getSessionKey());
  return { valueEnc: encrypted };
}

/**
 * Decrypt optional field
 * Performance: Uses in-memory cache to avoid repeated decryption
 */
export async function decryptOptionalField(
  value?: string,
  valueEnc?: EncryptedData | null
): Promise<string | undefined> {
  if (!valueEnc) {
    return value;
  }

  if (!isUnlocked()) {
    return undefined;
  }

  // Check cache first
  const cacheKey = getCacheKey(valueEnc);
  const cached = decryptionCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const decrypted = await decrypt(valueEnc, getSessionKey());

    // Cache the result (with size limit)
    if (decryptionCache.size < MAX_CACHE_ENTRIES) {
      decryptionCache.set(cacheKey, decrypted);
    }

    return decrypted;
  } catch {
    return undefined;
  }
}
