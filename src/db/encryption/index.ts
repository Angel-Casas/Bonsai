/**
 * Encryption module for Bonsai PWA
 * 
 * Provides optional passphrase-based encryption at rest.
 * 
 * THREAT MODEL (MVP):
 * - Protects data at rest against casual local inspection
 * - Does NOT protect against a fully compromised runtime environment
 * - Passphrase is never stored, logged, or sent anywhere
 * 
 * Algorithms:
 * - Key derivation: PBKDF2 with SHA-256 (100,000 iterations by default)
 * - Encryption: AES-GCM with random 12-byte IV per encryption
 */

// Re-export crypto utilities
export {
  ENCRYPTION_VERSION,
  DEFAULT_ITERATIONS,
  SALT_LENGTH,
  IV_LENGTH,
  KEY_LENGTH,
  arrayBufferToBase64,
  base64ToArrayBuffer,
  generateRandomBytes,
  generateSalt,
  generateIV,
  deriveKey,
  createKeyHash,
  verifyPassphrase,
  encrypt,
  decrypt,
  encryptOptional,
  decryptOptional,
  type EncryptionMetadata,
  type EncryptedData,
} from './crypto';

// Re-export encryption service
export {
  // State queries
  isEncryptionEnabled,
  isUnlocked,
  isLocked,
  getEncryptionMetadata,
  
  // Session management
  lock,
  unlock,
  getSessionKey,
  
  // Enable/disable encryption
  enableEncryption,
  disableEncryption,
  changePassphrase,
  
  // API key management
  getDecryptedApiKey,
  setEncryptedApiKey,
  clearEncryptedApiKey,
  
  // Content encryption helpers
  encryptContent,
  decryptContent,
  encryptOptionalField,
  decryptOptionalField,

  // Cache management (for diagnostics)
  clearDecryptionCache,
  getDecryptionCacheStats,
} from './encryptionService';
