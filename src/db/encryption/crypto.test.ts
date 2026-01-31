/**
 * Unit tests for crypto utilities
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  arrayBufferToBase64,
  base64ToArrayBuffer,
  generateSalt,
  generateIV,
  deriveKey,
  createKeyHash,
  verifyPassphrase,
  encrypt,
  decrypt,
  encryptOptional,
  decryptOptional,
  SALT_LENGTH,
  IV_LENGTH,
  DEFAULT_ITERATIONS,
  ENCRYPTION_VERSION,
  type EncryptionMetadata,
} from './crypto';

describe('Encoding utilities', () => {
  it('arrayBufferToBase64 and base64ToArrayBuffer are inverse operations', () => {
    const original = new Uint8Array([1, 2, 3, 4, 5, 255, 0, 128]);
    const base64 = arrayBufferToBase64(original.buffer);
    const recovered = new Uint8Array(base64ToArrayBuffer(base64));
    
    expect(recovered).toEqual(original);
  });

  it('handles empty buffer', () => {
    const empty = new Uint8Array([]);
    const base64 = arrayBufferToBase64(empty.buffer);
    const recovered = new Uint8Array(base64ToArrayBuffer(base64));
    
    expect(recovered.length).toBe(0);
  });

  it('generates valid base64 strings', () => {
    const data = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const base64 = arrayBufferToBase64(data.buffer);
    
    // Base64 should only contain valid characters
    expect(base64).toMatch(/^[A-Za-z0-9+/]*=*$/);
  });
});

describe('Random byte generation', () => {
  it('generateSalt creates bytes of correct length', () => {
    const salt = generateSalt();
    expect(salt.length).toBe(SALT_LENGTH);
  });

  it('generateIV creates bytes of correct length', () => {
    const iv = generateIV();
    expect(iv.length).toBe(IV_LENGTH);
  });

  it('generates different values each time', () => {
    const salt1 = generateSalt();
    const salt2 = generateSalt();
    
    // Extremely unlikely to be equal
    expect(arrayBufferToBase64(salt1.buffer as ArrayBuffer)).not.toBe(arrayBufferToBase64(salt2.buffer as ArrayBuffer));
  });
});

describe('Key derivation', () => {
  it('derives a CryptoKey from passphrase', async () => {
    const salt = generateSalt();
    const key = await deriveKey('test-passphrase', salt);
    
    expect(key).toBeInstanceOf(CryptoKey);
    expect(key.algorithm.name).toBe('AES-GCM');
    expect(key.usages).toContain('encrypt');
    expect(key.usages).toContain('decrypt');
  });

  it('same passphrase and salt produce same key', async () => {
    const salt = generateSalt();
    const key1 = await deriveKey('same-passphrase', salt);
    const key2 = await deriveKey('same-passphrase', salt);
    
    // Encrypt with one, decrypt with other - should work
    const plaintext = 'test message';
    const encrypted = await encrypt(plaintext, key1);
    const decrypted = await decrypt(encrypted, key2);
    
    expect(decrypted).toBe(plaintext);
  });

  it('different passphrases produce different keys', async () => {
    const salt = generateSalt();
    const key1 = await deriveKey('passphrase-1', salt);
    const key2 = await deriveKey('passphrase-2', salt);
    
    const plaintext = 'test message';
    const encrypted = await encrypt(plaintext, key1);
    
    // Decrypt with wrong key should fail
    await expect(decrypt(encrypted, key2)).rejects.toThrow();
  });

  it('different salts produce different keys', async () => {
    const salt1 = generateSalt();
    const salt2 = generateSalt();
    const key1 = await deriveKey('same-passphrase', salt1);
    const key2 = await deriveKey('same-passphrase', salt2);
    
    const plaintext = 'test message';
    const encrypted = await encrypt(plaintext, key1);
    
    // Decrypt with key from different salt should fail
    await expect(decrypt(encrypted, key2)).rejects.toThrow();
  });
});

describe('Key hash and verification', () => {
  it('createKeyHash returns a base64 string', async () => {
    const salt = generateSalt();
    const key = await deriveKey('test-passphrase', salt);
    const hash = await createKeyHash(key, salt);
    
    expect(hash).toMatch(/^[A-Za-z0-9+/]*=*$/);
    expect(hash.length).toBeGreaterThan(0);
  });

  it('verifyPassphrase returns true for correct passphrase', async () => {
    const salt = generateSalt();
    const passphrase = 'correct-passphrase';
    const key = await deriveKey(passphrase, salt);
    const keyHash = await createKeyHash(key, salt);
    
    const metadata: EncryptionMetadata = {
      version: ENCRYPTION_VERSION,
      salt: arrayBufferToBase64(salt.buffer as ArrayBuffer),
      iterations: DEFAULT_ITERATIONS,
      enabledAt: new Date().toISOString(),
      keyHash,
    };
    
    const isValid = await verifyPassphrase(passphrase, metadata);
    expect(isValid).toBe(true);
  });

  it('verifyPassphrase returns false for incorrect passphrase', async () => {
    const salt = generateSalt();
    const correctPassphrase = 'correct-passphrase';
    const key = await deriveKey(correctPassphrase, salt);
    const keyHash = await createKeyHash(key, salt);
    
    const metadata: EncryptionMetadata = {
      version: ENCRYPTION_VERSION,
      salt: arrayBufferToBase64(salt.buffer as ArrayBuffer),
      iterations: DEFAULT_ITERATIONS,
      enabledAt: new Date().toISOString(),
      keyHash,
    };
    
    const isValid = await verifyPassphrase('wrong-passphrase', metadata);
    expect(isValid).toBe(false);
  });
});

describe('Encryption and decryption', () => {
  let key: CryptoKey;

  beforeEach(async () => {
    const salt = generateSalt();
    key = await deriveKey('test-passphrase', salt);
  });

  it('encrypt returns ciphertext and iv', async () => {
    const encrypted = await encrypt('hello world', key);
    
    expect(encrypted).toHaveProperty('ciphertext');
    expect(encrypted).toHaveProperty('iv');
    expect(encrypted.ciphertext.length).toBeGreaterThan(0);
    expect(encrypted.iv.length).toBeGreaterThan(0);
  });

  it('decrypt returns original plaintext', async () => {
    const plaintext = 'Hello, 世界! 🌍';
    const encrypted = await encrypt(plaintext, key);
    const decrypted = await decrypt(encrypted, key);
    
    expect(decrypted).toBe(plaintext);
  });

  it('roundtrip preserves various content types', async () => {
    const testCases = [
      'Simple text',
      'Unicode: 日本語 한국어 العربية',
      'Emoji: 🎉🚀💻🌟',
      'Code: const x = () => { return 42; }',
      'Multi\nline\ntext\nwith\nnewlines',
      'Special chars: <>&"\'\\/`~!@#$%^*()[]{}',
      'Long text: ' + 'a'.repeat(10000),
      '',  // Empty string
      ' ', // Single space
    ];
    
    for (const plaintext of testCases) {
      const encrypted = await encrypt(plaintext, key);
      const decrypted = await decrypt(encrypted, key);
      expect(decrypted).toBe(plaintext);
    }
  });

  it('each encryption produces different ciphertext (random IV)', async () => {
    const plaintext = 'same message';
    const encrypted1 = await encrypt(plaintext, key);
    const encrypted2 = await encrypt(plaintext, key);
    
    // IVs should be different
    expect(encrypted1.iv).not.toBe(encrypted2.iv);
    // Ciphertexts should be different
    expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext);
    
    // But both should decrypt to the same plaintext
    expect(await decrypt(encrypted1, key)).toBe(plaintext);
    expect(await decrypt(encrypted2, key)).toBe(plaintext);
  });

  it('decrypt fails with wrong key', async () => {
    const plaintext = 'secret message';
    const encrypted = await encrypt(plaintext, key);
    
    // Create a different key
    const wrongKey = await deriveKey('wrong-passphrase', generateSalt());
    
    await expect(decrypt(encrypted, wrongKey)).rejects.toThrow();
  });

  it('decrypt fails with tampered ciphertext', async () => {
    const encrypted = await encrypt('test', key);
    
    // Tamper with ciphertext
    const tampered = {
      ...encrypted,
      ciphertext: encrypted.ciphertext.slice(0, -4) + 'XXXX',
    };
    
    await expect(decrypt(tampered, key)).rejects.toThrow();
  });

  it('decrypt fails with tampered IV', async () => {
    const encrypted = await encrypt('test', key);
    
    // Tamper with IV
    const tampered = {
      ...encrypted,
      iv: encrypted.iv.slice(0, -2) + 'XX',
    };
    
    await expect(decrypt(tampered, key)).rejects.toThrow();
  });
});

describe('Optional encryption helpers', () => {
  let key: CryptoKey;

  beforeEach(async () => {
    const salt = generateSalt();
    key = await deriveKey('test-passphrase', salt);
  });

  it('encryptOptional returns null for null input', async () => {
    expect(await encryptOptional(null, key)).toBeNull();
    expect(await encryptOptional(undefined, key)).toBeNull();
    expect(await encryptOptional('', key)).toBeNull();
  });

  it('encryptOptional encrypts non-empty strings', async () => {
    const encrypted = await encryptOptional('hello', key);
    expect(encrypted).not.toBeNull();
    expect(encrypted?.ciphertext).toBeDefined();
  });

  it('decryptOptional returns null for null input', async () => {
    expect(await decryptOptional(null, key)).toBeNull();
    expect(await decryptOptional(undefined, key)).toBeNull();
  });

  it('decryptOptional decrypts valid encrypted data', async () => {
    const encrypted = await encryptOptional('hello', key);
    const decrypted = await decryptOptional(encrypted, key);
    expect(decrypted).toBe('hello');
  });
});
