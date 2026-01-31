<script setup lang="ts">
/**
 * LockScreen Component
 * 
 * Displayed when encryption is enabled but the app is locked.
 * Provides passphrase input to unlock and option to reset data.
 */

import { ref } from 'vue';
import { useEncryptionStore } from '../stores/encryptionStore';
import { useRouter } from 'vue-router';

const encryptionStore = useEncryptionStore();
const router = useRouter();

const passphrase = ref('');
const showPassphrase = ref(false);
const errorMessage = ref('');
const isUnlocking = ref(false);

async function handleUnlock() {
  if (!passphrase.value) {
    errorMessage.value = 'Please enter your passphrase';
    return;
  }

  isUnlocking.value = true;
  errorMessage.value = '';

  try {
    const success = await encryptionStore.unlock(passphrase.value);
    if (success) {
      passphrase.value = '';
      // Navigate to home or stay on current page
      if (router.currentRoute.value.path === '/locked') {
        router.push('/');
      }
    } else {
      errorMessage.value = 'Incorrect passphrase. Please try again.';
      passphrase.value = '';
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Failed to unlock';
  } finally {
    isUnlocking.value = false;
  }
}

function goToSettings() {
  router.push('/settings');
}
</script>

<template>
  <div class="lock-screen">
    <div class="lock-container">
      <div class="lock-icon">🔐</div>
      
      <h1>Bonsai is Locked</h1>
      
      <p class="lock-description">
        Your data is encrypted. Enter your passphrase to unlock.
      </p>

      <form class="unlock-form" @submit.prevent="handleUnlock">
        <div class="input-group">
          <label for="passphrase" class="sr-only">Passphrase</label>
          <div class="password-input-wrapper">
            <input
              id="passphrase"
              v-model="passphrase"
              :type="showPassphrase ? 'text' : 'password'"
              placeholder="Enter passphrase"
              autocomplete="current-password"
              :disabled="isUnlocking"
              class="passphrase-input"
              data-testid="unlock-passphrase-input"
            />
            <button
              type="button"
              class="toggle-visibility"
              :aria-label="showPassphrase ? 'Hide passphrase' : 'Show passphrase'"
              @click="showPassphrase = !showPassphrase"
            >
              {{ showPassphrase ? '👁️' : '👁️‍🗨️' }}
            </button>
          </div>
        </div>

        <p v-if="errorMessage" class="error-message" role="alert">
          {{ errorMessage }}
        </p>

        <button
          type="submit"
          :disabled="isUnlocking || !passphrase"
          class="unlock-button"
          data-testid="unlock-button"
        >
          {{ isUnlocking ? 'Unlocking...' : 'Unlock' }}
        </button>
      </form>

      <div class="lock-footer">
        <p class="forgot-hint">
          Forgot your passphrase? You can reset all data in
          <button class="link-button" @click="goToSettings">Settings</button>.
        </p>
        
        <div class="security-note">
          <strong>🛡️ Security Note:</strong>
          Your passphrase is never stored. If you forget it, data cannot be recovered.
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lock-screen {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 1rem;
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
}

.lock-container {
  background: #2d2d44;
  border-radius: 1rem;
  padding: 2rem;
  max-width: 400px;
  width: 100%;
  text-align: center;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
}

.lock-icon {
  font-size: 4rem;
  margin-bottom: 1rem;
}

h1 {
  color: #fff;
  font-size: 1.5rem;
  margin-bottom: 0.5rem;
}

.lock-description {
  color: #b0b0c0;
  margin-bottom: 1.5rem;
}

.unlock-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.input-group {
  text-align: left;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
}

.password-input-wrapper {
  display: flex;
  gap: 0.5rem;
}

.passphrase-input {
  flex: 1;
  padding: 0.75rem 1rem;
  border: 1px solid #444;
  border-radius: 0.5rem;
  background: #1a1a2e;
  color: #fff;
  font-size: 1rem;
}

.passphrase-input:focus {
  outline: none;
  border-color: #64b5f6;
  box-shadow: 0 0 0 2px rgba(100, 181, 246, 0.2);
}

.passphrase-input:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.toggle-visibility {
  padding: 0.75rem;
  border: 1px solid #444;
  border-radius: 0.5rem;
  background: #1a1a2e;
  color: #fff;
  cursor: pointer;
}

.toggle-visibility:hover {
  background: #2d2d44;
}

.error-message {
  color: #ff6b6b;
  font-size: 0.875rem;
  margin: 0;
  text-align: left;
}

.unlock-button {
  padding: 0.875rem 1.5rem;
  border: none;
  border-radius: 0.5rem;
  background: #64b5f6;
  color: #1a1a2e;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
}

.unlock-button:hover:not(:disabled) {
  background: #42a5f5;
}

.unlock-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.lock-footer {
  margin-top: 2rem;
  padding-top: 1.5rem;
  border-top: 1px solid #444;
}

.forgot-hint {
  color: #888;
  font-size: 0.875rem;
  margin-bottom: 1rem;
}

.link-button {
  background: none;
  border: none;
  color: #64b5f6;
  cursor: pointer;
  font-size: inherit;
  padding: 0;
  text-decoration: underline;
}

.link-button:hover {
  color: #42a5f5;
}

.security-note {
  background: rgba(100, 181, 246, 0.1);
  border: 1px solid rgba(100, 181, 246, 0.2);
  border-radius: 0.5rem;
  padding: 0.75rem;
  font-size: 0.75rem;
  color: #b0b0c0;
  text-align: left;
}

.security-note strong {
  color: #64b5f6;
}
</style>
