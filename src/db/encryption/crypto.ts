/**
 * Cryptographic utilities for Bonsai encryption-at-rest
 * 
 * Uses WebCrypto API with:
 * - Key derivation: PBKDF2 with SHA-256
 * - Encryption: AES-GCM with random 12-byte IV
 * 
 * THREAT MODEL (MVP):
 * - Protects data at rest against casual local inspection
 * - Does NOT protect against a fully compromised runtime environment
 * - Passphrase is never stored, logged, or sent anywhere
 */

// ============================================================================
// Constants
// ============================================================================

/** Current encryption metadata version */
export const ENCRYPTION_VERSION = 1;

/** Default PBKDF2 iterations (adjustable for future versions) */
export const DEFAULT_ITERATIONS = 100_000;

/** Salt length in bytes (recommended 16 bytes) */
export const SALT_LENGTH = 16;

/** IV length in bytes for AES-GCM (12 bytes recommended by NIST) */
export const IV_LENGTH = 12;

/** AES key length in bits */
export const KEY_LENGTH = 256;

// ============================================================================
// Types
// ============================================================================

/** Encryption metadata stored in localStorage */
export interface EncryptionMetadata {
  /** Version of the encryption scheme */
  version: number;
  /** Base64-encoded salt for key derivation */
  salt: string;
  /** Number of PBKDF2 iterations */
  iterations: number;
  /** When encryption was enabled (ISO timestamp) */
  enabledAt: string;
  /** Hash of derived key for passphrase verification (base64) */
  keyHash: string;
}

/** Encrypted data structure */
export interface EncryptedData {
  /** Base64-encoded ciphertext */
  ciphertext: string;
  /** Base64-encoded IV */
  iv: string;
}

// ============================================================================
// Encoding Utilities
// ============================================================================

/**
 * Convert ArrayBuffer or Uint8Array to base64 string
 */
export function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/**
 * Convert base64 string to ArrayBuffer
 */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Generate cryptographically secure random bytes
 */
export function generateRandomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

/**
 * Generate a random salt for PBKDF2
 */
export function generateSalt(): Uint8Array {
  return generateRandomBytes(SALT_LENGTH);
}

/**
 * Generate a random IV for AES-GCM
 */
export function generateIV(): Uint8Array {
  return generateRandomBytes(IV_LENGTH);
}

// ============================================================================
// Key Derivation
// ============================================================================

/**
 * Derive a CryptoKey from a passphrase using PBKDF2
 * 
 * @param passphrase - User passphrase (never stored)
 * @param salt - Salt bytes for PBKDF2
 * @param iterations - Number of PBKDF2 iterations
 * @returns CryptoKey for AES-GCM encryption
 */
export async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number = DEFAULT_ITERATIONS
): Promise<CryptoKey> {
  // Convert passphrase to key material
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );

  // Derive AES-GCM key using PBKDF2
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt.buffer as ArrayBuffer,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    {
      name: 'AES-GCM',
      length: KEY_LENGTH,
    },
    false, // Not extractable
    ['encrypt', 'decrypt']
  );
}

/**
 * Create a hash of the derived key for passphrase verification
 * This allows us to check if the entered passphrase is correct
 * without storing the passphrase itself.
 * 
 * @param key - The derived CryptoKey
 * @param salt - The salt used for key derivation
 * @returns Base64-encoded hash
 */
export async function createKeyHash(
  key: CryptoKey,
  salt: Uint8Array
): Promise<string> {
  // Use a known plaintext to verify the key
  const verificationPlaintext = 'BONSAI_KEY_VERIFICATION';
  const encoder = new TextEncoder();
  
  // Encrypt the verification plaintext
  const iv = salt.slice(0, IV_LENGTH).buffer as ArrayBuffer; // Use first 12 bytes of salt as IV for verification
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(verificationPlaintext)
  );
  
  // Hash the result for storage
  const hash = await crypto.subtle.digest('SHA-256', encrypted);
  return arrayBufferToBase64(hash);
}

/**
 * Verify a passphrase by comparing key hashes
 * 
 * @param passphrase - Passphrase to verify
 * @param metadata - Stored encryption metadata
 * @returns True if passphrase is correct
 */
export async function verifyPassphrase(
  passphrase: string,
  metadata: EncryptionMetadata
): Promise<boolean> {
  try {
    const salt = new Uint8Array(base64ToArrayBuffer(metadata.salt));
    const key = await deriveKey(passphrase, salt, metadata.iterations);
    const hash = await createKeyHash(key, salt);
    return hash === metadata.keyHash;
  } catch {
    return false;
  }
}

// ============================================================================
// Encryption / Decryption
// ============================================================================

/**
 * Encrypt a string using AES-GCM
 * 
 * @param plaintext - String to encrypt
 * @param key - CryptoKey for encryption
 * @returns EncryptedData with ciphertext and IV
 */
export async function encrypt(
  plaintext: string,
  key: CryptoKey
): Promise<EncryptedData> {
  const encoder = new TextEncoder();
  const iv = generateIV();
  
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer },
    key,
    encoder.encode(plaintext)
  );
  
  return {
    ciphertext: arrayBufferToBase64(ciphertext),
    iv: arrayBufferToBase64(iv),
  };
}

/**
 * Decrypt ciphertext using AES-GCM
 * 
 * @param encryptedData - Encrypted data with ciphertext and IV
 * @param key - CryptoKey for decryption
 * @returns Decrypted plaintext string
 * @throws Error if decryption fails (wrong key or tampered data)
 */
export async function decrypt(
  encryptedData: EncryptedData,
  key: CryptoKey
): Promise<string> {
  const decoder = new TextDecoder();
  const ciphertext = base64ToArrayBuffer(encryptedData.ciphertext);
  const iv = base64ToArrayBuffer(encryptedData.iv);
  
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );
  
  return decoder.decode(plaintext);
}

/**
 * Encrypt a string, returning null if input is empty or null/undefined
 * 
 * @param plaintext - String to encrypt (or null/undefined)
 * @param key - CryptoKey for encryption
 * @returns EncryptedData or null
 */
export async function encryptOptional(
  plaintext: string | null | undefined,
  key: CryptoKey
): Promise<EncryptedData | null> {
  if (!plaintext) {
    return null;
  }
  return encrypt(plaintext, key);
}

/**
 * Decrypt ciphertext, returning null if input is null/undefined
 * 
 * @param encryptedData - Encrypted data or null
 * @param key - CryptoKey for decryption
 * @returns Decrypted string or null
 */
export async function decryptOptional(
  encryptedData: EncryptedData | null | undefined,
  key: CryptoKey
): Promise<string | null> {
  if (!encryptedData) {
    return null;
  }
  return decrypt(encryptedData, key);
}
