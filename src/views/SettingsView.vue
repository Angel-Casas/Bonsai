<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { getApiKey, setApiKey, clearApiKey, maskApiKey } from '@/api/settings'
import { useEncryptionStore } from '@/stores/encryptionStore'
import { useThemeStore } from '@/stores/themeStore'
import TopNavBar from '@/components/TopNavBar.vue'
import GridBackground from '@/components/GridBackground.vue'
import { AVAILABLE_MODELS, DEFAULT_MODEL } from '@/api/nanogpt'
import { runIntegrityCheck, getSchemaVersion, getDatabaseName, type IntegrityCheckResult } from '@/db/integrityCheck'
import { deleteDatabase } from '@/db/database'
import {
  exportData,
  serializeExport,
  generateExportFilename,
  downloadFile,
  parseAndValidateImport,
  importData,
  readFileAsText,
  type ValidationResult,
  type ImportResult,
} from '@/db/exportImport'
import {
  isDevMode,
  generateDataset,
  persistDataset,
  PRESET_CONFIGS,
  type PresetName,
  type GeneratedDataset,
} from '@/utils/datasetGenerator'
import { getCacheStats as getSearchCacheStats } from '@/utils/searchCache'
import { getDecryptionCacheStats } from '@/db/encryption'

const router = useRouter()
const encryptionStore = useEncryptionStore()
const themeStore = useThemeStore()

// State
const apiKeyInput = ref('')
const isEditing = ref(false)
const showApiKey = ref(false)
const savedApiKey = ref<string | null>(null)
const saveStatus = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')

// Integrity check state
const integrityResult = ref<IntegrityCheckResult | null>(null)
const isCheckingIntegrity = ref(false)
const showIntegrityDetails = ref(false)

// Reset confirmation state
const showResetDialog = ref(false)
const resetConfirmText = ref('')
const isResetting = ref(false)
const resetSuccess = ref(false)

// Export/Import state
const isExporting = ref(false)
const exportSuccess = ref(false)
const isImporting = ref(false)
const importFileInput = ref<HTMLInputElement | null>(null)
const importValidation = ref<ValidationResult | null>(null)
const importResult = ref<ImportResult | null>(null)
const showImportDialog = ref(false)
const importFileContent = ref<string | null>(null)

// Encryption state
const showEncryptionDialog = ref(false)
const encryptionPassphrase = ref('')
const encryptionPassphraseConfirm = ref('')
const showEncryptionPassphrase = ref(false)
const encryptionError = ref('')
const encryptionSuccess = ref('')
const showDisableEncryptionDialog = ref(false)
const disablePassphrase = ref('')
const showChangePassphraseDialog = ref(false)
const currentPassphrase = ref('')
const newPassphrase = ref('')
const newPassphraseConfirm = ref('')

// Check if API key exists
const hasKey = computed(() => savedApiKey.value !== null && savedApiKey.value.length > 0)

// Masked API key for display
const maskedKey = computed(() => {
  if (!savedApiKey.value) return ''
  return maskApiKey(savedApiKey.value)
})

// Database info
const schemaVersion = computed(() => getSchemaVersion())
const databaseName = computed(() => getDatabaseName())

onMounted(() => {
  savedApiKey.value = getApiKey()
})

function startEditing() {
  isEditing.value = true
  apiKeyInput.value = ''
  showApiKey.value = false
}

function cancelEditing() {
  isEditing.value = false
  apiKeyInput.value = ''
  showApiKey.value = false
}

function saveApiKey() {
  if (!apiKeyInput.value.trim()) {
    return
  }

  saveStatus.value = 'saving'
  try {
    setApiKey(apiKeyInput.value.trim())
    savedApiKey.value = apiKeyInput.value.trim()
    isEditing.value = false
    apiKeyInput.value = ''
    saveStatus.value = 'saved'
    setTimeout(() => {
      saveStatus.value = 'idle'
    }, 2000)
  } catch {
    saveStatus.value = 'error'
  }
}

function removeApiKey() {
  if (confirm('Are you sure you want to remove your API key?')) {
    clearApiKey()
    savedApiKey.value = null
    isEditing.value = false
    apiKeyInput.value = ''
  }
}

// Integrity check
async function checkIntegrity() {
  isCheckingIntegrity.value = true
  try {
    integrityResult.value = await runIntegrityCheck()
  } finally {
    isCheckingIntegrity.value = false
  }
}

// Clear API key only
function clearApiKeyOnly() {
  if (confirm('Are you sure you want to remove your API key? You will need to re-enter it to send messages.')) {
    clearApiKey()
    savedApiKey.value = null
    isEditing.value = false
    apiKeyInput.value = ''
  }
}

// Open reset dialog
function openResetDialog() {
  showResetDialog.value = true
  resetConfirmText.value = ''
}

function closeResetDialog() {
  showResetDialog.value = false
  resetConfirmText.value = ''
}

// Full reset
async function performFullReset() {
  if (resetConfirmText.value !== 'RESET') return

  isResetting.value = true
  try {
    // Clear API key
    clearApiKey()

    // Delete IndexedDB database
    await deleteDatabase(databaseName.value)

    // Clear any other localStorage keys
    localStorage.removeItem('bonsai:nanogpt:apiKey')

    resetSuccess.value = true
    closeResetDialog()

    // Redirect to home after short delay
    setTimeout(() => {
      router.push('/')
      // Force reload to clear all state
      window.location.reload()
    }, 1500)
  } catch (error) {
    console.error('Reset failed:', error)
    alert('Failed to reset data. Please try again or clear browser data manually.')
  } finally {
    isResetting.value = false
  }
}

// Clear conversations only
async function clearConversationsOnly() {
  if (confirm('Are you sure you want to delete all conversations? This cannot be undone.')) {
    try {
      await deleteDatabase(databaseName.value)
      // Force reload to reinitialize database
      window.location.reload()
    } catch (error) {
      console.error('Clear conversations failed:', error)
      alert('Failed to clear conversations. Please try again.')
    }
  }
}

// Export all data
async function handleExportAll() {
  isExporting.value = true
  exportSuccess.value = false
  try {
    const data = await exportData({})
    const json = serializeExport(data)
    const filename = generateExportFilename()
    downloadFile(json, filename)
    exportSuccess.value = true
    setTimeout(() => { exportSuccess.value = false }, 3000)
  } catch (error) {
    console.error('Export failed:', error)
    alert('Export failed: ' + (error instanceof Error ? error.message : 'Unknown error'))
  } finally {
    isExporting.value = false
  }
}

// Trigger file picker
function triggerImportPicker() {
  importFileInput.value?.click()
}

// Handle file selection
async function handleFileSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  try {
    const content = await readFileAsText(file)
    importFileContent.value = content
    const validation = parseAndValidateImport(content)
    importValidation.value = validation
    importResult.value = null
    showImportDialog.value = true
  } catch (error) {
    alert('Failed to read file: ' + (error instanceof Error ? error.message : 'Unknown error'))
  }
  // Reset input so same file can be selected again
  input.value = ''
}

// Perform import
async function performImport() {
  if (!importValidation.value?.isValid || !importValidation.value.data) return

  isImporting.value = true
  try {
    const result = await importData(importValidation.value.data, { mode: 'copy' })
    importResult.value = result
    if (result.success) {
      // Refresh integrity check to show new counts
      await checkIntegrity()
    }
  } catch (error) {
    importResult.value = {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      imported: { conversations: 0, messages: 0, configs: 0, revisions: 0 },
      skipped: { conversations: 0, messages: 0, configs: 0, revisions: 0 },
    }
  } finally {
    isImporting.value = false
  }
}

// Close import dialog
function closeImportDialog() {
  showImportDialog.value = false
  importValidation.value = null
  importResult.value = null
  importFileContent.value = null
}

// ============= Encryption Functions =============

function openEncryptionDialog() {
  showEncryptionDialog.value = true
  encryptionPassphrase.value = ''
  encryptionPassphraseConfirm.value = ''
  encryptionError.value = ''
  showEncryptionPassphrase.value = false
}

function closeEncryptionDialog() {
  showEncryptionDialog.value = false
  encryptionPassphrase.value = ''
  encryptionPassphraseConfirm.value = ''
  encryptionError.value = ''
}

async function handleEnableEncryption() {
  encryptionError.value = ''

  if (encryptionPassphrase.value.length < 8) {
    encryptionError.value = 'Passphrase must be at least 8 characters'
    return
  }

  if (encryptionPassphrase.value !== encryptionPassphraseConfirm.value) {
    encryptionError.value = 'Passphrases do not match'
    return
  }

  const result = await encryptionStore.enableEncryption(encryptionPassphrase.value)
  if (result.success) {
    encryptionSuccess.value = `Encryption enabled! ${result.migratedMessages} messages encrypted.`
    closeEncryptionDialog()
    setTimeout(() => { encryptionSuccess.value = '' }, 5000)
  } else {
    encryptionError.value = result.error || 'Failed to enable encryption'
  }
}

function openDisableEncryptionDialog() {
  showDisableEncryptionDialog.value = true
  disablePassphrase.value = ''
  encryptionError.value = ''
}

function closeDisableEncryptionDialog() {
  showDisableEncryptionDialog.value = false
  disablePassphrase.value = ''
  encryptionError.value = ''
}

async function handleDisableEncryption() {
  encryptionError.value = ''

  const result = await encryptionStore.disableEncryption(disablePassphrase.value)
  if (result.success) {
    encryptionSuccess.value = `Encryption disabled! ${result.migratedMessages} messages decrypted.`
    closeDisableEncryptionDialog()
    setTimeout(() => { encryptionSuccess.value = '' }, 5000)
  } else {
    encryptionError.value = result.error || 'Failed to disable encryption'
  }
}

function openChangePassphraseDialog() {
  showChangePassphraseDialog.value = true
  currentPassphrase.value = ''
  newPassphrase.value = ''
  newPassphraseConfirm.value = ''
  encryptionError.value = ''
}

function closeChangePassphraseDialog() {
  showChangePassphraseDialog.value = false
  currentPassphrase.value = ''
  newPassphrase.value = ''
  newPassphraseConfirm.value = ''
  encryptionError.value = ''
}

async function handleChangePassphrase() {
  encryptionError.value = ''

  if (newPassphrase.value.length < 8) {
    encryptionError.value = 'New passphrase must be at least 8 characters'
    return
  }

  if (newPassphrase.value !== newPassphraseConfirm.value) {
    encryptionError.value = 'New passphrases do not match'
    return
  }

  const result = await encryptionStore.changePassphrase(currentPassphrase.value, newPassphrase.value)
  if (result.success) {
    encryptionSuccess.value = 'Passphrase changed successfully!'
    closeChangePassphraseDialog()
    setTimeout(() => { encryptionSuccess.value = '' }, 5000)
  } else {
    encryptionError.value = result.error || 'Failed to change passphrase'
  }
}

function handleLock() {
  encryptionStore.lock()
  router.push('/')
}

// ============= Dev Tools Functions =============

const isDev = computed(() => isDevMode())
const selectedPreset = ref<PresetName>('medium')
const customMessageCount = ref(1000)
const customBranchingFactor = ref(0.05)
const useCustomConfig = ref(false)
const isGenerating = ref(false)
const generationResult = ref<{ conversationId: string; messageCount: number; stats: GeneratedDataset['stats'] } | null>(null)
const generationError = ref('')

async function handleGenerateDataset() {
  isGenerating.value = true
  generationResult.value = null
  generationError.value = ''

  try {
    const config = useCustomConfig.value
      ? {
          messageCount: customMessageCount.value,
          branchingFactor: customBranchingFactor.value,
          title: `Custom Test (${customMessageCount.value} messages)`,
        }
      : PRESET_CONFIGS[selectedPreset.value]

    const dataset = generateDataset(config)
    const result = await persistDataset(dataset)

    generationResult.value = {
      ...result,
      stats: dataset.stats,
    }
  } catch (error) {
    console.error('Dataset generation failed:', error)
    generationError.value = error instanceof Error ? error.message : 'Unknown error'
  } finally {
    isGenerating.value = false
  }
}

function goToGeneratedConversation() {
  if (generationResult.value) {
    router.push(`/conversation/${generationResult.value.conversationId}`)
  }
}

// ============= Performance Diagnostics =============

interface DiagnosticsData {
  searchCache: { enabled: boolean; populated: boolean; entryCount: number; conversationId: string | null };
  decryptionCache: { size: number; maxSize: number };
  memory: { usedJSHeapSize?: number; totalJSHeapSize?: number } | null;
  timestamp: string;
}

const diagnosticsData = ref<DiagnosticsData | null>(null)
const showDiagnostics = ref(false)

function refreshDiagnostics() {
  const searchCache = getSearchCacheStats()
  const decryptionCache = getDecryptionCacheStats()

  // Memory info (if available in performance API)
  let memory: DiagnosticsData['memory'] = null
  if (typeof performance !== 'undefined' && 'memory' in performance) {
    const perfMemory = (performance as { memory: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory
    memory = {
      usedJSHeapSize: perfMemory.usedJSHeapSize,
      totalJSHeapSize: perfMemory.totalJSHeapSize,
    }
  }

  diagnosticsData.value = {
    searchCache,
    decryptionCache,
    memory,
    timestamp: new Date().toISOString(),
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
</script>

<template>
  <div class="settings-page" :class="{ 'day-mode': themeStore.isDayMode }">
    <!-- Grid Background -->
    <GridBackground />

    <!-- Top Navigation Bar -->
    <TopNavBar />

    <!-- Content -->
    <main class="settings-content">
      <!-- Page Title -->
      <h1 class="page-title">Settings</h1>

      <!-- Success Toast -->
      <div
        v-if="resetSuccess"
        class="success-toast"
        data-testid="reset-success-toast"
      >
        <div class="toast-content">
          <svg xmlns="http://www.w3.org/2000/svg" class="icon" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
          </svg>
          <span>All data has been reset successfully!</span>
        </div>
      </div>

      <!-- API Key Section -->
      <section class="settings-card" data-testid="api-key-section">
        <h2 class="card-title">NanoGPT API Key</h2>
        <p class="card-description">
          Your API key is stored locally in your browser and is never sent to any server except NanoGPT.
          Get your API key from <a href="https://nano-gpt.com" target="_blank" rel="noopener" class="link">nano-gpt.com</a>.
        </p>

        <!-- Existing Key Display -->
        <div v-if="hasKey && !isEditing" class="key-display">
          <div class="status-indicator success">
            <span>✓</span>
            <span>API key configured</span>
          </div>
          <div class="key-value">
            <span data-testid="masked-api-key">{{ showApiKey ? savedApiKey : maskedKey }}</span>
            <button
              class="toggle-visibility"
              @click="showApiKey = !showApiKey"
            >
              {{ showApiKey ? 'Hide' : 'Show' }}
            </button>
          </div>
          <div class="button-group">
            <button
              class="btn btn-secondary"
              data-testid="change-api-key-btn"
              @click="startEditing"
            >
              Change
            </button>
            <button
              class="btn btn-danger-ghost"
              data-testid="remove-api-key-btn"
              @click="removeApiKey"
            >
              Remove
            </button>
          </div>
        </div>

        <!-- No Key / Editing State -->
        <div v-else class="key-edit">
          <div v-if="!hasKey && !isEditing" class="status-indicator warning">
            <span>⚠</span>
            <span>No API key configured</span>
          </div>

          <div v-if="isEditing || !hasKey" class="input-group">
            <label class="input-label">Enter your NanoGPT API key</label>
            <input
              v-model="apiKeyInput"
              type="password"
              placeholder="nano-..."
              class="input"
              data-testid="api-key-input"
              @keyup.enter="saveApiKey"
            />
          </div>

          <div class="button-group">
            <button
              :disabled="!apiKeyInput.trim()"
              class="btn btn-primary"
              data-testid="save-api-key-btn"
              @click="saveApiKey"
            >
              {{ saveStatus === 'saving' ? 'Saving...' : 'Save' }}
            </button>
            <button
              v-if="isEditing"
              class="btn btn-ghost"
              @click="cancelEditing"
            >
              Cancel
            </button>
          </div>

          <div v-if="saveStatus === 'saved'" class="status-message success">
            ✓ API key saved
          </div>
          <div v-if="saveStatus === 'error'" class="status-message error">
            ✗ Failed to save API key
          </div>
        </div>
      </section>

      <!-- Encryption Section -->
      <section class="settings-card" data-testid="encryption-section">
        <h2 class="card-title">Encryption</h2>
        <p class="card-description">
          Encrypt your data at rest with a passphrase. Your passphrase is never stored.
        </p>

        <!-- Success message -->
        <div v-if="encryptionSuccess" class="alert alert-success">
          ✓ {{ encryptionSuccess }}
        </div>

        <!-- Encryption disabled state -->
        <div v-if="!encryptionStore.encryptionEnabled" class="encryption-status">
          <div class="status-indicator muted">
            <span>🔓</span>
            <span>Encryption is not enabled</span>
          </div>
          <button
            class="btn btn-primary"
            data-testid="enable-encryption-btn"
            @click="openEncryptionDialog"
          >
            Enable Encryption
          </button>
          <p class="security-note">
            ⚠️ <strong>Security note:</strong> Protects data at rest against casual inspection.
            Does not protect against a fully compromised runtime environment.
          </p>
        </div>

        <!-- Encryption enabled state -->
        <div v-else class="encryption-status">
          <div class="status-indicator success">
            <span>🔒</span>
            <span>Encryption is enabled</span>
            <span v-if="encryptionStore.unlocked" class="status-badge">(unlocked)</span>
            <span v-else class="status-badge warning">(locked)</span>
          </div>

          <div class="button-group wrap">
            <button
              v-if="encryptionStore.unlocked"
              class="btn btn-secondary"
              data-testid="lock-btn"
              @click="handleLock"
            >
              🔒 Lock Now
            </button>
            <button
              v-if="encryptionStore.unlocked"
              class="btn btn-secondary"
              @click="openChangePassphraseDialog"
            >
              Change Passphrase
            </button>
            <button
              v-if="encryptionStore.unlocked"
              class="btn btn-danger-outline"
              data-testid="disable-encryption-btn"
              @click="openDisableEncryptionDialog"
            >
              Disable Encryption
            </button>
          </div>
        </div>
      </section>

      <!-- Model Information -->
      <section class="settings-card">
        <h2 class="card-title">Available Models</h2>
        <p class="card-description">
          These models are available through NanoGPT. The default model for new conversations is <strong>{{ DEFAULT_MODEL }}</strong>.
        </p>
        <div class="model-list">
          <div
            v-for="model in AVAILABLE_MODELS"
            :key="model.id"
            class="model-item"
          >
            <div class="model-info">
              <span class="model-name">{{ model.name }}</span>
              <span class="model-id">{{ model.id }}</span>
            </div>
            <span v-if="model.supportsWebSearch" class="model-badge">🔍 Web search</span>
          </div>
        </div>
      </section>

      <!-- Data & Storage Section -->
      <section class="settings-card" data-testid="data-storage-section">
        <h2 class="card-title">Data & Storage</h2>
        <p class="card-description">
          All your data is stored locally in your browser using IndexedDB.
        </p>

        <!-- Database Info -->
        <div class="info-box">
          <div class="info-row">
            <span class="info-label">Database Name:</span>
            <code class="info-value" data-testid="db-name">{{ databaseName }}</code>
          </div>
          <div class="info-row">
            <span class="info-label">Schema Version:</span>
            <code class="info-value" data-testid="schema-version">{{ schemaVersion }}</code>
          </div>
        </div>

        <!-- Export/Import -->
        <div class="section-group">
          <h3 class="section-title">Export & Import</h3>

          <!-- Export Button -->
          <div class="action-row">
            <button
              class="btn btn-primary"
              :disabled="isExporting"
              data-testid="export-all-btn"
              @click="handleExportAll"
            >
              <span v-if="isExporting" class="spinner">⏳</span>
              <span v-else>📤</span>
              {{ isExporting ? 'Exporting...' : 'Export All Data' }}
            </button>
            <span v-if="exportSuccess" class="status-message success">✓ Downloaded</span>
          </div>

          <!-- Import Button -->
          <div class="action-row">
            <input
              ref="importFileInput"
              type="file"
              accept=".json,application/json"
              class="hidden"
              data-testid="import-file-input"
              @change="handleFileSelected"
            />
            <button
              class="btn btn-secondary"
              data-testid="import-btn"
              @click="triggerImportPicker"
            >
              📥 Import from File
            </button>
            <p class="action-hint">
              Import will create copies of conversations with new IDs (safe merge).
            </p>
          </div>
        </div>

        <!-- Integrity Check -->
        <div class="section-group">
          <button
            class="btn btn-secondary"
            :disabled="isCheckingIntegrity"
            data-testid="check-integrity-btn"
            @click="checkIntegrity"
          >
            <span v-if="isCheckingIntegrity" class="spinner">⏳</span>
            <span v-else>🔍</span>
            {{ isCheckingIntegrity ? 'Checking...' : 'Check Data Integrity' }}
          </button>

          <!-- Integrity Results -->
          <div v-if="integrityResult" class="integrity-result" data-testid="integrity-result">
            <div class="result-header">
              <span v-if="integrityResult.isHealthy" class="result-icon success">✓</span>
              <span v-else class="result-icon warning">⚠</span>
              <span class="result-text">
                {{ integrityResult.isHealthy ? 'Database is healthy' : `Found ${integrityResult.issues.length} issue(s)` }}
              </span>
            </div>

            <!-- Stats -->
            <div class="stats-grid">
              <div>Conversations: {{ integrityResult.stats.totalConversations }}</div>
              <div>Messages: {{ integrityResult.stats.totalMessages }}</div>
              <div>Configs: {{ integrityResult.stats.totalConfigs }}</div>
              <div>Revisions: {{ integrityResult.stats.totalRevisions }}</div>
            </div>

            <!-- Issues -->
            <div v-if="!integrityResult.isHealthy" class="issues-section">
              <button
                class="toggle-link"
                @click="showIntegrityDetails = !showIntegrityDetails"
              >
                {{ showIntegrityDetails ? 'Hide details' : 'Show details' }}
              </button>
              <div v-if="showIntegrityDetails" class="issues-list">
                <div
                  v-for="(issue, index) in integrityResult.issues"
                  :key="index"
                  class="issue-item"
                  :class="issue.severity"
                >
                  <div>{{ issue.description }}</div>
                  <div class="issue-id">ID: {{ issue.entityId }}</div>
                </div>
              </div>
              <p class="issues-hint">
                If issues persist, consider using "Reset All Data" below to restore a clean state.
              </p>
            </div>
          </div>
        </div>
      </section>

      <!-- Danger Zone -->
      <section class="settings-card danger-zone" data-testid="danger-zone-section">
        <h2 class="card-title danger">⚠️ Danger Zone</h2>
        <p class="card-description">
          These actions are irreversible. Your data cannot be recovered after deletion.
        </p>

        <div class="danger-actions">
          <!-- Clear API Key Only -->
          <div class="danger-action">
            <div class="action-info">
              <div class="action-title">Clear API Key</div>
              <div class="action-description">Remove your NanoGPT API key only</div>
            </div>
            <button
              class="btn btn-danger-outline"
              data-testid="clear-api-key-btn"
              @click="clearApiKeyOnly"
            >
              Clear Key
            </button>
          </div>

          <!-- Clear Conversations Only -->
          <div class="danger-action">
            <div class="action-info">
              <div class="action-title">Clear Conversations</div>
              <div class="action-description">Delete all conversations and messages</div>
            </div>
            <button
              class="btn btn-danger-outline"
              data-testid="clear-conversations-btn"
              @click="clearConversationsOnly"
            >
              Clear Data
            </button>
          </div>

          <!-- Full Reset -->
          <div class="danger-action critical">
            <div class="action-info">
              <div class="action-title danger">Reset All Data</div>
              <div class="action-description">Delete everything: API key, conversations, all local data</div>
            </div>
            <button
              class="btn btn-danger"
              data-testid="reset-all-btn"
              @click="openResetDialog"
            >
              Reset All
            </button>
          </div>
        </div>
      </section>

      <!-- Dev Tools (only in development) -->
      <section v-if="isDev" class="settings-card dev-tools-section" data-testid="dev-tools-section">
        <h2 class="card-title">Developer Tools</h2>
        <p class="card-description">
          Tools for testing and development. Only visible in development mode.
        </p>

        <!-- Dataset Generator -->
        <div class="section-group">
          <h3 class="section-title">Large Dataset Generator</h3>
          <p class="action-hint" style="margin-bottom: 0.75rem">
            Generate test conversations with many messages for performance testing.
          </p>

          <!-- Preset Selection -->
          <div class="config-group">
            <label class="checkbox-label">
              <input
                v-model="useCustomConfig"
                type="checkbox"
              />
              Use custom configuration
            </label>

            <div v-if="!useCustomConfig" class="preset-selector">
              <label class="input-label">Preset</label>
              <select v-model="selectedPreset" class="input select-input">
                <option value="small">Small (100 messages)</option>
                <option value="medium">Medium (1,000 messages)</option>
                <option value="large">Large (5,000 messages)</option>
                <option value="stress">Stress Test (10,000 messages)</option>
              </select>
            </div>

            <div v-else class="custom-config">
              <div class="input-row">
                <div class="input-group">
                  <label class="input-label">Message Count</label>
                  <input
                    v-model.number="customMessageCount"
                    type="number"
                    min="10"
                    max="50000"
                    step="100"
                    class="input"
                  />
                </div>
                <div class="input-group">
                  <label class="input-label">Branching Factor (0-1)</label>
                  <input
                    v-model.number="customBranchingFactor"
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    class="input"
                  />
                </div>
              </div>
            </div>
          </div>

          <!-- Generate Button -->
          <div class="action-row">
            <button
              class="btn btn-secondary"
              :disabled="isGenerating"
              data-testid="generate-dataset-btn"
              @click="handleGenerateDataset"
            >
              <span v-if="isGenerating" class="spinner">&#10227;</span>
              <span v-else>&#128202;</span>
              {{ isGenerating ? 'Generating...' : 'Generate Dataset' }}
            </button>
          </div>

          <!-- Result -->
          <div v-if="generationResult" class="generation-result success">
            <div class="result-header">
              <span class="result-icon">&#10003;</span>
              <span>Dataset generated successfully!</span>
            </div>
            <div class="stats-grid">
              <div>Total: {{ generationResult.stats.totalMessages }} messages</div>
              <div>User: {{ generationResult.stats.userMessages }}</div>
              <div>Assistant: {{ generationResult.stats.assistantMessages }}</div>
              <div>System: {{ generationResult.stats.systemMessages }}</div>
              <div>Branches: {{ generationResult.stats.branchCount }}</div>
              <div>Max Depth: {{ generationResult.stats.maxDepth }}</div>
            </div>
            <button
              class="btn btn-primary"
              data-testid="go-to-conversation-btn"
              @click="goToGeneratedConversation"
            >
              Open Conversation
            </button>
          </div>

          <!-- Error -->
          <div v-if="generationError" class="generation-result error">
            <div class="result-header">
              <span class="result-icon error">&#10007;</span>
              <span>Generation failed: {{ generationError }}</span>
            </div>
          </div>
        </div>

        <!-- Performance Diagnostics -->
        <div class="section-group">
          <h3 class="section-title">Performance Diagnostics</h3>
          <p class="action-hint" style="margin-bottom: 0.75rem">
            View cache statistics and memory usage for performance monitoring.
          </p>

          <div class="action-row">
            <button
              class="btn btn-secondary"
              data-testid="refresh-diagnostics-btn"
              @click="refreshDiagnostics(); showDiagnostics = true"
            >
              &#128202; Refresh Diagnostics
            </button>
            <button
              v-if="showDiagnostics"
              class="btn btn-ghost"
              @click="showDiagnostics = false"
            >
              Hide
            </button>
          </div>

          <!-- Diagnostics Data -->
          <div v-if="showDiagnostics && diagnosticsData" class="diagnostics-panel" data-testid="diagnostics-panel">
            <div class="diagnostics-section">
              <h4 class="diagnostics-title">Search Cache</h4>
              <div class="diagnostics-grid">
                <div>
                  <span class="diagnostics-label">Status:</span>
                  <span :class="diagnosticsData.searchCache.enabled ? 'text-success' : 'text-muted'">
                    {{ diagnosticsData.searchCache.enabled ? 'Enabled' : 'Disabled' }}
                  </span>
                </div>
                <div>
                  <span class="diagnostics-label">Populated:</span>
                  <span>{{ diagnosticsData.searchCache.populated ? 'Yes' : 'No' }}</span>
                </div>
                <div>
                  <span class="diagnostics-label">Entries:</span>
                  <span>{{ diagnosticsData.searchCache.entryCount }}</span>
                </div>
                <div v-if="diagnosticsData.searchCache.conversationId">
                  <span class="diagnostics-label">Conversation:</span>
                  <code class="text-xs">{{ diagnosticsData.searchCache.conversationId.slice(0, 8) }}...</code>
                </div>
              </div>
            </div>

            <div class="diagnostics-section">
              <h4 class="diagnostics-title">Decryption Cache</h4>
              <div class="diagnostics-grid">
                <div>
                  <span class="diagnostics-label">Entries:</span>
                  <span>{{ diagnosticsData.decryptionCache.size }} / {{ diagnosticsData.decryptionCache.maxSize }}</span>
                </div>
                <div>
                  <span class="diagnostics-label">Usage:</span>
                  <span>{{ ((diagnosticsData.decryptionCache.size / diagnosticsData.decryptionCache.maxSize) * 100).toFixed(1) }}%</span>
                </div>
              </div>
            </div>

            <div v-if="diagnosticsData.memory" class="diagnostics-section">
              <h4 class="diagnostics-title">Memory (JS Heap)</h4>
              <div class="diagnostics-grid">
                <div>
                  <span class="diagnostics-label">Used:</span>
                  <span>{{ formatBytes(diagnosticsData.memory.usedJSHeapSize!) }}</span>
                </div>
                <div>
                  <span class="diagnostics-label">Total:</span>
                  <span>{{ formatBytes(diagnosticsData.memory.totalJSHeapSize!) }}</span>
                </div>
              </div>
            </div>

            <div class="diagnostics-footer">
              <span class="text-muted text-xs">Last updated: {{ new Date(diagnosticsData.timestamp).toLocaleTimeString() }}</span>
            </div>
          </div>
        </div>
      </section>

      <!-- About -->
      <section class="settings-card">
        <h2 class="card-title">About Bonsai</h2>
        <p class="card-description">
          Bonsai is a local-first PWA for branching conversations with hybrid context control.
          All your data is stored locally in your browser using IndexedDB.
        </p>
        <p class="version-text">
          Version: 1.0.0 (MVP)
        </p>
      </section>
    </main>

    <!-- Reset Confirmation Dialog -->
    <div
      v-if="showResetDialog"
      class="dialog-overlay"
      data-testid="reset-dialog"
      @click.self="closeResetDialog"
    >
      <div class="dialog-content">
        <h2 class="dialog-title danger">⚠️ Confirm Reset</h2>
        <p class="dialog-text">
          This will permanently delete:
        </p>
        <ul class="dialog-list">
          <li>Your NanoGPT API key</li>
          <li>All conversations and messages</li>
          <li>All message revisions and context configurations</li>
        </ul>
        <p class="dialog-text">
          Type <strong>RESET</strong> to confirm:
        </p>
        <input
          v-model="resetConfirmText"
          type="text"
          placeholder="Type RESET"
          class="input danger"
          data-testid="reset-confirm-input"
        />
        <div class="dialog-actions">
          <button
            class="btn btn-ghost"
            @click="closeResetDialog"
          >
            Cancel
          </button>
          <button
            :disabled="resetConfirmText !== 'RESET' || isResetting"
            class="btn btn-danger"
            data-testid="confirm-reset-btn"
            @click="performFullReset"
          >
            {{ isResetting ? 'Resetting...' : 'Reset All Data' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Import Dialog -->
    <div
      v-if="showImportDialog"
      class="dialog-overlay"
      data-testid="import-dialog"
      @click.self="closeImportDialog"
    >
      <div class="dialog-content">
        <h2 class="dialog-title">📥 Import Data</h2>

        <!-- Validation Results -->
        <div v-if="importValidation && !importResult">
          <!-- Valid file -->
          <div v-if="importValidation.isValid && importValidation.summary" class="import-valid">
            <div class="status-indicator success">
              <span>✓</span>
              <span>File is valid</span>
            </div>
            <div class="info-box">
              <div class="info-row">
                <span class="info-label">Conversations:</span>
                <span>{{ importValidation.summary.conversationCount }}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Messages:</span>
                <span>{{ importValidation.summary.messageCount }}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Context Configs:</span>
                <span>{{ importValidation.summary.configCount }}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Revisions:</span>
                <span>{{ importValidation.summary.revisionCount }}</span>
              </div>
              <div class="info-row muted">
                <span>Exported:</span>
                <span>{{ new Date(importValidation.summary.exportedAt).toLocaleString() }}</span>
              </div>
            </div>
            <p class="import-hint">
              Data will be imported as copies with new IDs. Existing data will not be affected.
            </p>
          </div>

          <!-- Invalid file -->
          <div v-else class="import-invalid">
            <div class="status-indicator error">
              <span>✗</span>
              <span>Invalid file</span>
            </div>
            <div class="error-list">
              <div v-for="(error, index) in importValidation.errors" :key="index">
                {{ error }}
              </div>
            </div>
          </div>
        </div>

        <!-- Import Result -->
        <div v-if="importResult">
          <div v-if="importResult.success" class="import-success">
            <div class="status-indicator success">
              <span>✓</span>
              <span>Import successful!</span>
            </div>
            <div class="info-box">
              <div class="info-row">
                <span class="info-label">Conversations imported:</span>
                <span>{{ importResult.imported.conversations }}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Messages imported:</span>
                <span>{{ importResult.imported.messages }}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Configs imported:</span>
                <span>{{ importResult.imported.configs }}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Revisions imported:</span>
                <span>{{ importResult.imported.revisions }}</span>
              </div>
            </div>
          </div>
          <div v-else class="import-failed">
            <div class="status-indicator error">
              <span>✗</span>
              <span>Import failed</span>
            </div>
            <div class="error-box">
              {{ importResult.error }}
            </div>
          </div>
        </div>

        <!-- Actions -->
        <div class="dialog-actions">
          <button
            class="btn btn-ghost"
            @click="closeImportDialog"
          >
            {{ importResult ? 'Close' : 'Cancel' }}
          </button>
          <button
            v-if="importValidation?.isValid && !importResult"
            :disabled="isImporting"
            class="btn btn-primary"
            data-testid="confirm-import-btn"
            @click="performImport"
          >
            {{ isImporting ? 'Importing...' : 'Import Data' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Enable Encryption Dialog -->
    <div
      v-if="showEncryptionDialog"
      class="dialog-overlay"
      data-testid="encryption-dialog"
      @click.self="closeEncryptionDialog"
    >
      <div class="dialog-content">
        <h2 class="dialog-title">🔐 Enable Encryption</h2>
        <p class="dialog-text">
          Create a passphrase to encrypt your data. This passphrase will be required to unlock Bonsai.
        </p>
        <div class="alert alert-warning">
          ⚠️ <strong>Important:</strong> Your passphrase is never stored. If you forget it, your data cannot be recovered.
        </div>
        <div class="form-group">
          <div class="input-group">
            <label class="input-label">Passphrase (min. 8 characters)</label>
            <input
              v-model="encryptionPassphrase"
              :type="showEncryptionPassphrase ? 'text' : 'password'"
              placeholder="Enter passphrase"
              class="input"
              data-testid="encryption-passphrase-input"
            />
          </div>
          <div class="input-group">
            <label class="input-label">Confirm Passphrase</label>
            <input
              v-model="encryptionPassphraseConfirm"
              :type="showEncryptionPassphrase ? 'text' : 'password'"
              placeholder="Confirm passphrase"
              class="input"
              data-testid="encryption-passphrase-confirm-input"
            />
          </div>
          <label class="checkbox-label">
            <input
              v-model="showEncryptionPassphrase"
              type="checkbox"
            />
            Show passphrase
          </label>
        </div>
        <div v-if="encryptionError" class="alert alert-error">
          {{ encryptionError }}
        </div>
        <div class="dialog-actions">
          <button
            class="btn btn-ghost"
            @click="closeEncryptionDialog"
          >
            Cancel
          </button>
          <button
            :disabled="encryptionStore.isProcessing || encryptionPassphrase.length < 8"
            class="btn btn-primary"
            data-testid="confirm-enable-encryption-btn"
            @click="handleEnableEncryption"
          >
            {{ encryptionStore.isProcessing ? 'Encrypting...' : 'Enable Encryption' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Disable Encryption Dialog -->
    <div
      v-if="showDisableEncryptionDialog"
      class="dialog-overlay"
      data-testid="disable-encryption-dialog"
      @click.self="closeDisableEncryptionDialog"
    >
      <div class="dialog-content">
        <h2 class="dialog-title danger">⚠️ Disable Encryption</h2>
        <p class="dialog-text">
          This will decrypt all your data and remove encryption. Enter your passphrase to confirm.
        </p>
        <div class="input-group">
          <label class="input-label">Current Passphrase</label>
          <input
            v-model="disablePassphrase"
            type="password"
            placeholder="Enter passphrase"
            class="input danger"
            data-testid="disable-encryption-passphrase-input"
          />
        </div>
        <div v-if="encryptionError" class="alert alert-error">
          {{ encryptionError }}
        </div>
        <div class="dialog-actions">
          <button
            class="btn btn-ghost"
            @click="closeDisableEncryptionDialog"
          >
            Cancel
          </button>
          <button
            :disabled="encryptionStore.isProcessing || !disablePassphrase"
            class="btn btn-danger"
            data-testid="confirm-disable-encryption-btn"
            @click="handleDisableEncryption"
          >
            {{ encryptionStore.isProcessing ? 'Decrypting...' : 'Disable Encryption' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Change Passphrase Dialog -->
    <div
      v-if="showChangePassphraseDialog"
      class="dialog-overlay"
      @click.self="closeChangePassphraseDialog"
    >
      <div class="dialog-content">
        <h2 class="dialog-title">🔑 Change Passphrase</h2>
        <p class="dialog-text">
          Enter your current passphrase and choose a new one.
        </p>
        <div class="form-group">
          <div class="input-group">
            <label class="input-label">Current Passphrase</label>
            <input
              v-model="currentPassphrase"
              type="password"
              placeholder="Current passphrase"
              class="input"
            />
          </div>
          <div class="input-group">
            <label class="input-label">New Passphrase (min. 8 characters)</label>
            <input
              v-model="newPassphrase"
              type="password"
              placeholder="New passphrase"
              class="input"
            />
          </div>
          <div class="input-group">
            <label class="input-label">Confirm New Passphrase</label>
            <input
              v-model="newPassphraseConfirm"
              type="password"
              placeholder="Confirm new passphrase"
              class="input"
            />
          </div>
        </div>
        <div v-if="encryptionError" class="alert alert-error">
          {{ encryptionError }}
        </div>
        <div class="dialog-actions">
          <button
            class="btn btn-ghost"
            @click="closeChangePassphraseDialog"
          >
            Cancel
          </button>
          <button
            :disabled="encryptionStore.isProcessing || !currentPassphrase || newPassphrase.length < 8"
            class="btn btn-primary"
            @click="handleChangePassphrase"
          >
            {{ encryptionStore.isProcessing ? 'Changing...' : 'Change Passphrase' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-page {
  min-height: 100vh;
  padding-top: 60px; /* Account for fixed navbar */
  background: var(--bg-primary);
  color: var(--text-primary);
  transition: background 0.4s ease, color 0.4s ease;
}

/* Page Title */
.page-title {
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 1.5rem;
}

/* Content */
.settings-content {
  max-width: 42rem;
  margin: 0 auto;
  padding: 1.5rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  position: relative;
  z-index: 1;
}

/* Cards */
.settings-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  padding: 1.25rem;
}

.card-title {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 0.5rem;
}

.card-title.danger {
  color: var(--error);
}

.card-description {
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin-bottom: 1rem;
  line-height: 1.5;
}

/* Links */
.link {
  color: var(--accent);
  text-decoration: none;
  transition: opacity var(--transition-fast);
}

.link:hover {
  opacity: 0.8;
  text-decoration: underline;
}

/* Status Indicators */
.status-indicator {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  margin-bottom: 0.75rem;
}

.status-indicator.success {
  color: var(--success);
}

.status-indicator.warning {
  color: var(--warning);
}

.status-indicator.error {
  color: var(--error);
}

.status-indicator.muted {
  color: var(--text-secondary);
}

.status-badge {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.status-badge.warning {
  color: var(--warning);
}

/* Key Display */
.key-display,
.key-edit {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.key-value {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: var(--bg-primary);
  border-radius: var(--radius-md);
  padding: 0.5rem 0.75rem;
  font-family: var(--font-mono);
  font-size: 0.875rem;
}

.toggle-visibility {
  margin-left: auto;
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 0.75rem;
  cursor: pointer;
  transition: color var(--transition-fast);
}

.toggle-visibility:hover {
  color: var(--text-primary);
}

/* Buttons */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  font-family: var(--font-sans);
  font-size: 0.875rem;
  font-weight: 500;
  border-radius: var(--radius-md);
  border: 1px solid transparent;
  cursor: pointer;
  transition: all var(--transition-normal);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: linear-gradient(135deg, rgba(var(--accent-rgb), 0.95) 0%, rgba(var(--accent-rgb), 0.8) 100%);
  color: var(--bg-primary);
  border-color: transparent;
}

.btn-primary:hover:not(:disabled) {
  background: linear-gradient(135deg, rgba(var(--accent-rgb), 1) 0%, rgba(var(--accent-rgb), 0.9) 100%);
  transform: translateY(-1px);
}

.btn-secondary {
  background: var(--bg-primary);
  color: var(--text-primary);
  border-color: var(--border-subtle);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--bg-card-hover);
  border-color: var(--border-color);
}

.btn-ghost {
  background: transparent;
  color: var(--text-secondary);
}

.btn-ghost:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-primary);
}

.btn-danger {
  background: var(--error);
  color: white;
}

.btn-danger:hover:not(:disabled) {
  background: #ef5350;
}

.btn-danger-outline {
  background: transparent;
  color: var(--error);
  border-color: rgba(248, 113, 113, 0.4);
}

.btn-danger-outline:hover:not(:disabled) {
  background: var(--error-bg);
  border-color: var(--error);
}

.btn-danger-ghost {
  background: transparent;
  color: var(--error);
}

.btn-danger-ghost:hover:not(:disabled) {
  background: var(--error-bg);
}

.button-group {
  display: flex;
  gap: 0.5rem;
}

.button-group.wrap {
  flex-wrap: wrap;
}

/* Inputs */
.input-group {
  margin-bottom: 0.75rem;
}

.input-label {
  display: block;
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin-bottom: 0.375rem;
}

.input {
  width: 100%;
  padding: 0.625rem 0.875rem;
  font-family: var(--font-sans);
  font-size: 0.875rem;
  color: var(--text-primary);
  background: var(--bg-primary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  transition: all var(--transition-normal);
}

.input::placeholder {
  color: var(--text-muted);
}

.input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(var(--accent-rgb), 0.1);
}

.input.danger:focus {
  border-color: var(--error);
  box-shadow: 0 0 0 3px rgba(248, 113, 113, 0.1);
}

/* Form */
.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  color: var(--text-secondary);
  cursor: pointer;
}

/* Status Messages */
.status-message {
  font-size: 0.875rem;
}

.status-message.success {
  color: var(--success);
}

.status-message.error {
  color: var(--error);
}

/* Alerts */
.alert {
  padding: 0.75rem 1rem;
  border-radius: var(--radius-md);
  font-size: 0.875rem;
  margin-bottom: 1rem;
}

.alert-success {
  background: var(--success-bg);
  border: 1px solid rgba(74, 222, 128, 0.3);
  color: var(--success);
}

.alert-warning {
  background: var(--warning-bg);
  border: 1px solid rgba(251, 191, 36, 0.3);
  color: var(--warning);
}

.alert-error {
  background: var(--error-bg);
  border: 1px solid rgba(248, 113, 113, 0.3);
  color: var(--error);
}

/* Encryption Status */
.encryption-status {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.security-note {
  font-size: 0.75rem;
  color: var(--text-muted);
}

/* Model List */
.model-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.model-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--bg-primary);
  border-radius: var(--radius-md);
  padding: 0.625rem 0.875rem;
}

.model-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.model-name {
  font-weight: 500;
  color: var(--text-primary);
}

.model-id {
  font-size: 0.75rem;
  font-family: var(--font-mono);
  color: var(--text-muted);
}

.model-badge {
  font-size: 0.75rem;
  color: var(--accent);
}

/* Info Box */
.info-box {
  background: var(--bg-primary);
  border-radius: var(--radius-md);
  padding: 0.75rem;
  margin-bottom: 1rem;
}

.info-row {
  display: flex;
  justify-content: space-between;
  font-size: 0.875rem;
  padding: 0.25rem 0;
}

.info-row.muted {
  font-size: 0.75rem;
  color: var(--text-muted);
  padding-top: 0.5rem;
  margin-top: 0.5rem;
  border-top: 1px solid var(--border-subtle);
}

.info-label {
  color: var(--text-secondary);
}

.info-value {
  color: var(--text-primary);
  font-family: var(--font-mono);
}

/* Section Groups */
.section-group {
  margin-bottom: 1rem;
}

.section-title {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 0.75rem;
}

/* Action Rows */
.action-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin-bottom: 0.75rem;
}

.action-hint {
  font-size: 0.75rem;
  color: var(--text-muted);
  margin-top: 0.25rem;
  width: 100%;
}

/* Integrity Result */
.integrity-result {
  margin-top: 0.75rem;
  background: var(--bg-primary);
  border-radius: var(--radius-md);
  padding: 0.75rem;
}

.result-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.result-icon {
  font-size: 1rem;
}

.result-icon.success {
  color: var(--success);
}

.result-icon.warning {
  color: var(--warning);
}

.result-text {
  font-weight: 500;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.25rem 1rem;
  font-size: 0.75rem;
  color: var(--text-secondary);
  margin-bottom: 0.5rem;
}

.issues-section {
  margin-top: 0.5rem;
}

.toggle-link {
  background: none;
  border: none;
  color: var(--accent);
  font-size: 0.75rem;
  cursor: pointer;
  padding: 0;
}

.toggle-link:hover {
  text-decoration: underline;
}

.issues-list {
  margin-top: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.issue-item {
  font-size: 0.75rem;
  padding: 0.5rem;
  border-radius: var(--radius-sm);
}

.issue-item.error {
  background: var(--error-bg);
  color: #fca5a5;
}

.issue-item.warning {
  background: var(--warning-bg);
  color: #fcd34d;
}

.issue-id {
  color: var(--text-muted);
}

.issues-hint {
  margin-top: 0.5rem;
  font-size: 0.75rem;
  color: var(--text-muted);
}

/* Danger Zone */
.danger-zone {
  border-color: rgba(248, 113, 113, 0.3);
}

.danger-actions {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.danger-action {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem;
  background: var(--bg-primary);
  border-radius: var(--radius-md);
}

.danger-action.critical {
  border: 1px solid rgba(248, 113, 113, 0.3);
}

.action-info {
  flex: 1;
}

.action-title {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-primary);
}

.action-title.danger {
  color: var(--error);
}

.action-description {
  font-size: 0.75rem;
  color: var(--text-muted);
}

/* Version Text */
.version-text {
  font-size: 0.75rem;
  color: var(--text-muted);
  margin-top: 0.5rem;
}

/* Success Toast */
.success-toast {
  position: fixed;
  top: 1rem;
  right: 1rem;
  background: var(--success);
  color: white;
  padding: 0.75rem 1rem;
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  z-index: 50;
}

.toast-content {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

/* Dialog */
.dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
  padding: 1rem;
}

.dialog-content {
  width: 100%;
  max-width: 28rem;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xl);
  padding: 1.5rem;
  box-shadow: var(--shadow-lg);
}

.dialog-title {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 0.5rem;
}

.dialog-title.danger {
  color: var(--error);
}

.dialog-text {
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin-bottom: 1rem;
}

.dialog-list {
  list-style: disc;
  list-style-position: inside;
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin-bottom: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 1rem;
}

/* Import Dialog */
.import-valid,
.import-invalid,
.import-success,
.import-failed {
  margin-bottom: 1rem;
}

.import-hint {
  font-size: 0.75rem;
  color: var(--text-muted);
  margin-top: 0.5rem;
}

.error-list {
  background: var(--error-bg);
  border-radius: var(--radius-md);
  padding: 0.75rem;
  font-size: 0.875rem;
  color: #fca5a5;
  max-height: 10rem;
  overflow-y: auto;
}

.error-box {
  background: var(--error-bg);
  border-radius: var(--radius-md);
  padding: 0.75rem;
  font-size: 0.875rem;
  color: #fca5a5;
}

/* Utilities */
.icon {
  width: 1.25rem;
  height: 1.25rem;
}

.spinner {
  animation: spin 1s linear infinite;
  display: inline-block;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.hidden {
  display: none;
}

/* Dev Tools Section */
.dev-tools-section {
  border-color: rgba(139, 92, 246, 0.3);
}

.config-group {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.preset-selector,
.custom-config {
  margin-top: 0.5rem;
}

.select-input {
  cursor: pointer;
}

.input-row {
  display: flex;
  gap: 1rem;
}

.input-row .input-group {
  flex: 1;
  margin-bottom: 0;
}

.generation-result {
  margin-top: 0.75rem;
  padding: 0.75rem;
  border-radius: var(--radius-md);
}

.generation-result.success {
  background: var(--success-bg);
  border: 1px solid rgba(74, 222, 128, 0.3);
}

.generation-result.error {
  background: var(--error-bg);
  border: 1px solid rgba(248, 113, 113, 0.3);
}

.generation-result .result-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
  font-weight: 500;
}

.generation-result .result-icon {
  color: var(--success);
}

.generation-result .result-icon.error {
  color: var(--error);
}

.generation-result .stats-grid {
  margin-bottom: 0.75rem;
}

.generation-result .btn {
  margin-top: 0.5rem;
}

/* Performance Diagnostics */
.diagnostics-panel {
  margin-top: 0.75rem;
  background: var(--bg-primary);
  border-radius: var(--radius-md);
  padding: 0.75rem;
  border: 1px solid var(--border-subtle);
}

.diagnostics-section {
  margin-bottom: 0.75rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid var(--border-subtle);
}

.diagnostics-section:last-of-type {
  margin-bottom: 0.5rem;
  padding-bottom: 0.5rem;
}

.diagnostics-title {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 0.5rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.diagnostics-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.25rem 1rem;
  font-size: 0.8rem;
}

.diagnostics-label {
  color: var(--text-muted);
  margin-right: 0.25rem;
}

.diagnostics-footer {
  padding-top: 0.5rem;
  border-top: 1px solid var(--border-subtle);
}

.text-success {
  color: var(--success);
}

.text-muted {
  color: var(--text-muted);
}

.text-xs {
  font-size: 0.7rem;
}

/* ============================================================================= */
/* DAY MODE */
/* ============================================================================= */
.day-mode {
  --bg-primary: #fff8f0;
  --bg-secondary: rgba(255, 248, 240, 0.85);
  --bg-card: #fff;
  --bg-card-hover: #fef7ed;
  --text-primary: #2d2a26;
  --text-secondary: #6b6560;
  --text-muted: rgba(45, 42, 38, 0.6);
  --accent: #c4956a;
  --accent-rgb: 196, 149, 106;
  --accent-hover: #b8865c;
  --border-color: rgba(196, 149, 106, 0.5);
  --border-subtle: rgba(196, 149, 106, 0.25);
  --border-muted: rgba(0, 0, 0, 0.08);
  --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.08);
  --shadow-md: 0 4px 16px rgba(0, 0, 0, 0.1);
  --shadow-lg: 0 8px 32px rgba(0, 0, 0, 0.12);
}
</style>
