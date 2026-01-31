/**
 * Encryption Store - Vue reactive state for encryption
 * 
 * Provides reactive state for the encryption status,
 * allowing components to respond to lock/unlock events.
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import {
  isEncryptionEnabled as checkEncryptionEnabled,
  isUnlocked as checkUnlocked,
  lock as lockService,
  unlock as unlockService,
  enableEncryption as enableEncryptionService,
  disableEncryption as disableEncryptionService,
  changePassphrase as changePassphraseService,
  getDecryptedApiKey,
  setEncryptedApiKey,
  getEncryptionMetadata,
} from '../db/encryption';
import { clearSearchCache } from '../utils/searchCache';

export const useEncryptionStore = defineStore('encryption', () => {
  // Reactive state
  const encryptionEnabled = ref(checkEncryptionEnabled());
  const unlocked = ref(checkUnlocked());
  const isProcessing = ref(false);
  const lastError = ref<string | null>(null);

  // Computed
  const locked = computed(() => encryptionEnabled.value && !unlocked.value);
  
  /**
   * Refresh state from the encryption service
   */
  function refreshState() {
    encryptionEnabled.value = checkEncryptionEnabled();
    unlocked.value = checkUnlocked();
  }

  /**
   * Unlock the app with a passphrase
   */
  async function unlock(passphrase: string): Promise<boolean> {
    isProcessing.value = true;
    lastError.value = null;
    
    try {
      const success = await unlockService(passphrase);
      if (success) {
        refreshState();
        return true;
      } else {
        lastError.value = 'Incorrect passphrase';
        return false;
      }
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : 'Unlock failed';
      return false;
    } finally {
      isProcessing.value = false;
    }
  }

  /**
   * Lock the app
   * Security: Clears all decrypted caches from memory
   */
  function lock() {
    lockService();
    // Clear search cache (contains decrypted content)
    clearSearchCache();
    refreshState();
  }

  /**
   * Enable encryption with a new passphrase
   */
  async function enableEncryption(passphrase: string): Promise<{ success: boolean; error?: string; migratedMessages: number }> {
    isProcessing.value = true;
    lastError.value = null;
    
    try {
      const result = await enableEncryptionService(passphrase);
      if (result.success) {
        refreshState();
      } else {
        lastError.value = result.error || 'Enable encryption failed';
      }
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Enable encryption failed';
      lastError.value = errorMessage;
      return { success: false, error: errorMessage, migratedMessages: 0 };
    } finally {
      isProcessing.value = false;
    }
  }

  /**
   * Disable encryption
   */
  async function disableEncryption(passphrase: string): Promise<{ success: boolean; error?: string; migratedMessages: number }> {
    isProcessing.value = true;
    lastError.value = null;
    
    try {
      const result = await disableEncryptionService(passphrase);
      if (result.success) {
        refreshState();
      } else {
        lastError.value = result.error || 'Disable encryption failed';
      }
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Disable encryption failed';
      lastError.value = errorMessage;
      return { success: false, error: errorMessage, migratedMessages: 0 };
    } finally {
      isProcessing.value = false;
    }
  }

  /**
   * Change passphrase
   */
  async function changePassphrase(currentPassphrase: string, newPassphrase: string): Promise<{ success: boolean; error?: string }> {
    isProcessing.value = true;
    lastError.value = null;
    
    try {
      const result = await changePassphraseService(currentPassphrase, newPassphrase);
      if (!result.success) {
        lastError.value = result.error || 'Change passphrase failed';
      }
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Change passphrase failed';
      lastError.value = errorMessage;
      return { success: false, error: errorMessage };
    } finally {
      isProcessing.value = false;
    }
  }

  /**
   * Get the API key (handles decryption if needed)
   */
  async function getApiKey(): Promise<string | null> {
    return getDecryptedApiKey();
  }

  /**
   * Set the API key (handles encryption if needed)
   */
  async function setApiKey(apiKey: string): Promise<void> {
    await setEncryptedApiKey(apiKey);
  }

  /**
   * Get encryption metadata (for display)
   */
  function getMetadata() {
    return getEncryptionMetadata();
  }

  return {
    // State
    encryptionEnabled,
    unlocked,
    locked,
    isProcessing,
    lastError,
    
    // Actions
    refreshState,
    unlock,
    lock,
    enableEncryption,
    disableEncryption,
    changePassphrase,
    getApiKey,
    setApiKey,
    getMetadata,
  };
});
