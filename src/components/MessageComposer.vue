<script setup lang="ts">
/**
 * MessageComposer - Input area for new messages
 *
 * Features:
 * - Textarea for message input
 * - Send button
 * - Keyboard shortcuts (Cmd/Ctrl + Enter)
 * - Model selection (override for next message)
 * - Web search toggle with presets
 * - Stop generation button when streaming
 */

import { ref, computed, onMounted, onUnmounted } from 'vue'
import {
  DEFAULT_MODEL,
  SEARCH_PRESETS,
  buildEffectiveModel,
  type SearchPreset,
} from '@/api/nanogpt'
import { useModelsStore } from '@/stores/modelsStore'
import { useSettingsPanel } from '@/composables/useSettingsPanel'
import ModelSelector from '@/components/ModelSelector.vue'

const modelsStore = useModelsStore()
const { openSettings } = useSettingsPanel()

const props = defineProps<{
  disabled?: boolean
  conversationDefaultModel?: string | null
  isStreaming?: boolean
  hasApiKey?: boolean
  isOnline?: boolean
}>()

const emit = defineEmits<{
  send: [content: string, modelOverride: string | null, webSearchEnabled: boolean, searchPreset: SearchPreset]
  stopGeneration: []
  updateDefaultModel: [modelId: string]
}>()

// Input state
const content = ref('')
const textareaRef = ref<HTMLTextAreaElement | null>(null)

// Model override state (null = use conversation default)
const modelOverride = ref<string | null>(null)
const showModelDropdown = ref(false)

// Web search state
const webSearchEnabled = ref(false)
const searchPreset = ref<SearchPreset>('standard')
const showSearchPresetDropdown = ref(false)

// Computed effective model
const effectiveBaseModel = computed(() => {
  return modelOverride.value ?? props.conversationDefaultModel ?? DEFAULT_MODEL
})

const effectiveModel = computed(() => {
  return buildEffectiveModel(effectiveBaseModel.value, webSearchEnabled.value, searchPreset.value)
})

const effectiveModelDisplay = computed(() => {
  const model = modelsStore.availableModels.find(m => m.id === effectiveBaseModel.value)
  let name = model?.name ?? effectiveBaseModel.value
  if (webSearchEnabled.value) {
    const preset = SEARCH_PRESETS.find(p => p.id === searchPreset.value)
    name += ` + ${preset?.name ?? 'Web'}`
  }
  return name
})

// Reset override after send
function handleSend() {
  const trimmed = content.value.trim()
  if (!trimmed) return

  emit('send', trimmed, modelOverride.value, webSearchEnabled.value, searchPreset.value)
  content.value = ''
  
  // Reset overrides after send
  modelOverride.value = null
  webSearchEnabled.value = false
  searchPreset.value = 'standard'

  // Reset textarea height
  if (textareaRef.value) {
    textareaRef.value.style.height = 'auto'
  }
  
  // Close dropdowns
  showModelDropdown.value = false
  showSearchPresetDropdown.value = false
}

function handleKeydown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault()
    handleSend()
  }
}

function autoResize(event: Event) {
  const textarea = event.target as HTMLTextAreaElement
  textarea.style.height = 'auto'
  textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`
}

function handleModelSelect(modelId: string | null) {
  modelOverride.value = modelId
  showModelDropdown.value = false

  // If a specific model was selected (not "use default"), save it as the new default
  if (modelId !== null) {
    emit('updateDefaultModel', modelId)
  }
}

function toggleModelDropdown() {
  showModelDropdown.value = !showModelDropdown.value
}

function closeModelDropdown() {
  showModelDropdown.value = false
}

// Mobile detection for teleporting the model dropdown
const isMobile = ref(window.innerWidth <= 560)
function checkMobile() { isMobile.value = window.innerWidth <= 560 }

// Close dropdown when clicking outside
function handleClickOutside(event: MouseEvent) {
  const target = event.target as HTMLElement
  if (!target.closest('[data-dropdown="model"]') && !target.closest('.mobile-dropdown-overlay')) {
    showModelDropdown.value = false
  }
  if (!target.closest('[data-dropdown="search"]')) {
    showSearchPresetDropdown.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
  window.addEventListener('resize', checkMobile)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
  window.removeEventListener('resize', checkMobile)
})

function selectSearchPreset(preset: SearchPreset) {
  searchPreset.value = preset
  showSearchPresetDropdown.value = false
}

function toggleWebSearch() {
  webSearchEnabled.value = !webSearchEnabled.value
  if (!webSearchEnabled.value) {
    searchPreset.value = 'standard'
    showSearchPresetDropdown.value = false
  }
}

// Computed: can send message?
const canSend = computed(() => {
  if (props.disabled) return false
  if (props.isStreaming) return false
  if (props.hasApiKey === false) return false
  if (props.isOnline === false) return false
  if (!content.value.trim()) return false
  return true
})

// Computed: send button tooltip
const sendButtonTooltip = computed(() => {
  if (props.hasApiKey === false) {
    return 'API key required — add one in Settings'
  }
  if (props.isOnline === false) {
    return 'You are offline'
  }
  if (!content.value.trim()) {
    return 'Enter a message to send'
  }
  return 'Send message (⌘+Enter)'
})

// Computed: is deep search enabled?
const isDeepSearch = computed(() => {
  return webSearchEnabled.value && searchPreset.value === 'deep'
})

</script>

<template>
  <div class="composer" data-testid="message-composer">
    <!-- Model & Web Search Controls -->
    <div class="composer-controls">
      <!-- Model Selector -->
      <div class="relative" data-dropdown="model">
        <button
          class="control-btn"
          :class="{ 'control-btn--override': modelOverride }"
          data-testid="model-selector-btn"
          @click.stop="toggleModelDropdown"
        >
          <span class="control-icon">◐</span>
          <span class="control-label">{{ effectiveModelDisplay }}</span>
          <span v-if="modelOverride" class="override-badge">(override)</span>
          <svg class="chevron" :class="{ 'chevron--open': showModelDropdown }" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        <!-- Enhanced Model Selector Dropdown -->
        <!-- Desktop: inline absolute dropdown. Mobile: teleported full-screen overlay -->
        <Teleport to="body" :disabled="!isMobile">
          <Transition name="dropdown">
            <div
              v-if="showModelDropdown"
              :class="isMobile ? 'mobile-dropdown-overlay' : 'dropdown-container'"
              data-testid="model-dropdown"
              @click.stop="isMobile ? closeModelDropdown() : undefined"
            >
              <div v-if="isMobile" class="mobile-dropdown-panel" @click.stop>
                <ModelSelector
                  :model-value="modelOverride"
                  :conversation-default="props.conversationDefaultModel ?? DEFAULT_MODEL"
                  @update:model-value="handleModelSelect"
                  @close="closeModelDropdown"
                />
              </div>
              <ModelSelector
                v-else
                :model-value="modelOverride"
                :conversation-default="props.conversationDefaultModel ?? DEFAULT_MODEL"
                @update:model-value="handleModelSelect"
                @close="closeModelDropdown"
              />
            </div>
          </Transition>
        </Teleport>
      </div>

      <!-- Web Search Toggle -->
      <button
        class="control-btn"
        :class="{ 'control-btn--active': webSearchEnabled }"
        data-testid="web-search-toggle"
        @click="toggleWebSearch"
      >
        <span class="control-icon">🔍</span>
        <span class="control-label">{{ webSearchEnabled ? 'Web Search On' : 'Web Search' }}</span>
      </button>

      <!-- Search Preset Selector (only when web search is on) -->
      <div v-if="webSearchEnabled" class="relative" data-dropdown="search">
        <button
          class="control-btn"
          data-testid="search-preset-btn"
          @click.stop="showSearchPresetDropdown = !showSearchPresetDropdown"
        >
          <span class="control-label">{{ SEARCH_PRESETS.find(p => p.id === searchPreset)?.name }}</span>
          <svg class="chevron" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        <div
          v-if="showSearchPresetDropdown"
          class="preset-dropdown"
          data-testid="search-preset-dropdown"
        >
          <button
            v-for="preset in SEARCH_PRESETS"
            :key="preset.id"
            class="preset-option"
            :class="{ 'preset-option--selected': searchPreset === preset.id }"
            @click="selectSearchPreset(preset.id)"
          >
            <div class="preset-info">
              <span class="preset-name">{{ preset.name }}</span>
              <span class="preset-desc">{{ preset.description }}</span>
            </div>
            <span v-if="searchPreset === preset.id" class="check-icon">✓</span>
          </button>
        </div>
      </div>

      <!-- Effective model display -->
      <span class="effective-model" data-testid="effective-model">
        Sending as: <code class="model-code">{{ effectiveModel }}</code>
      </span>
    </div>

    <!-- Deep Search Warning -->
    <div
      v-if="isDeepSearch"
      class="warning-banner"
      data-testid="deep-search-warning"
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="warning-icon" viewBox="0 0 20 20" fill="currentColor">
        <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
      </svg>
      <span>Deep search is slower and more expensive than standard search</span>
    </div>

    <!-- Input Area -->
    <div class="input-area">
      <textarea
        ref="textareaRef"
        v-model="content"
        data-testid="composer-input"
        :disabled="disabled || isStreaming"
        rows="1"
        placeholder="Type a message... (Cmd+Enter to send)"
        class="composer-input"
        @keydown="handleKeydown"
        @input="autoResize"
      ></textarea>

      <!-- Stop Generation Button (when streaming) -->
      <button
        v-if="isStreaming"
        data-testid="stop-btn"
        class="action-btn action-btn--stop"
        @click="emit('stopGeneration')"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="action-icon" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clip-rule="evenodd" />
        </svg>
      </button>

      <!-- Send Button -->
      <button
        v-else
        data-testid="send-btn"
        :disabled="!canSend"
        :title="sendButtonTooltip"
        class="action-btn action-btn--send"
        @click="handleSend"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="action-icon" viewBox="0 0 20 20" fill="currentColor">
          <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
        </svg>
      </button>
    </div>

    <!-- Status indicators -->
    <p
      v-if="isOnline === false"
      class="status-warning"
      data-testid="offline-status"
    >
      You are offline
    </p>
    <p
      v-else-if="hasApiKey === false"
      class="status-warning"
      data-testid="no-api-key-status"
    >
      API key not set — add one in <a class="settings-link" @click.prevent="openSettings">Settings</a> to send messages
    </p>

    <p class="shortcut-hint">
      Press <kbd class="kbd">⌘</kbd> + <kbd class="kbd">Enter</kbd> to send
    </p>
  </div>
</template>

<style scoped>
.composer {
  border-top: 1px solid var(--glass-border);
  background: var(--glass-bg);
  backdrop-filter: blur(var(--glass-blur));
  padding: 1rem;
}

/* Controls Row */
.composer-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.control-btn {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.625rem;
  font-size: 0.75rem;
  font-family: var(--font-sans);
  border-radius: var(--radius-pill);
  border: 1px solid var(--border-subtle);
  background: rgba(var(--accent-rgb), 0.05);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition-normal);
}

.control-btn:hover {
  border-color: var(--border-color);
  background: rgba(var(--accent-rgb), 0.1);
  color: var(--text-primary);
}

.control-btn--override {
  background: rgba(var(--accent-rgb), 0.15);
  border-color: rgba(var(--accent-rgb), 0.4);
  color: var(--accent);
}

.control-btn--override:hover {
  border-color: var(--accent);
}

.control-btn--active {
  background: rgba(var(--branch-blue-rgb), 0.15);
  border-color: rgba(var(--branch-blue-rgb), 0.4);
  color: var(--branch-blue);
}

.control-icon {
  font-size: 0.875rem;
}

.control-label {
  font-weight: 500;
}

.override-badge {
  font-size: 0.625rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--accent);
}

.chevron {
  width: 0.75rem;
  height: 0.75rem;
  transition: transform var(--transition-fast);
}

.chevron--open {
  transform: rotate(180deg);
}

.dropdown-container {
  position: absolute;
  bottom: 100%;
  left: 0;
  margin-bottom: 0.5rem;
  z-index: 50;
}

/* Mobile: full-screen overlay (teleported to body, escapes all clipping ancestors) */
.mobile-dropdown-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  padding: 12px;
  padding-top: max(12px, env(safe-area-inset-top));
  padding-bottom: max(12px, env(safe-area-inset-bottom));
}

.mobile-dropdown-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  max-height: 100%;
}

/* Preset Dropdown */
.preset-dropdown {
  position: absolute;
  bottom: 100%;
  left: 0;
  margin-bottom: 0.25rem;
  width: 12rem;
  background: var(--glass-bg-solid);
  backdrop-filter: blur(16px);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  z-index: 50;
  overflow: hidden;
}

.preset-option {
  width: 100%;
  padding: 0.625rem 0.75rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-family: var(--font-sans);
  font-size: 0.875rem;
  background: transparent;
  border: none;
  color: var(--text-primary);
  cursor: pointer;
  text-align: left;
  transition: background var(--transition-fast);
}

.preset-option:hover {
  background: rgba(var(--accent-rgb), 0.1);
}

.preset-option--selected {
  background: rgba(var(--accent-rgb), 0.1);
}

.preset-info {
  display: flex;
  flex-direction: column;
}

.preset-name {
  font-weight: 500;
}

.preset-desc {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.check-icon {
  color: var(--accent);
  font-weight: 600;
}

/* Effective Model */
.effective-model {
  margin-left: auto;
  font-size: 0.75rem;
  color: var(--text-muted);
  display: none;
}

@media (min-width: 640px) {
  .effective-model {
    display: inline;
  }
}

.model-code {
  background: var(--bg-primary);
  padding: 0.125rem 0.375rem;
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
}

/* Warning Banner */
.warning-banner {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: var(--warning-bg);
  border: 1px solid var(--warning);
  border-radius: var(--radius-lg);
  font-size: 0.75rem;
  color: var(--warning);
}

.warning-icon {
  width: 1rem;
  height: 1rem;
  flex-shrink: 0;
}

/* Input Area */
.input-area {
  display: flex;
  gap: 0.5rem;
}

.composer-input {
  flex: 1;
  resize: none;
  padding: 0.75rem 1rem;
  font-family: var(--font-sans);
  font-size: 0.875rem;
  color: var(--text-primary);
  background: transparent;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  transition: all var(--transition-normal);
}

.composer-input::placeholder {
  color: var(--text-muted);
}

.composer-input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(var(--accent-rgb), 0.1);
}

.composer-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Action Buttons */
.action-btn {
  align-self: flex-end;
  padding: 0.75rem;
  border: none;
  border-radius: var(--radius-lg);
  font-weight: 500;
  color: var(--bg-primary);
  cursor: pointer;
  transition: all var(--transition-normal);
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.action-btn--send {
  background: linear-gradient(135deg, rgba(var(--accent-rgb), 0.95) 0%, rgba(var(--accent-rgb), 0.8) 100%);
}

.action-btn--send:hover:not(:disabled) {
  background: linear-gradient(135deg, rgba(var(--accent-rgb), 1) 0%, rgba(var(--accent-rgb), 0.9) 100%);
  transform: translateY(-1px);
  box-shadow: var(--shadow-accent);
}

.action-btn--stop {
  background: var(--error);
}

.action-btn--stop:hover {
  background: var(--error);
}

.action-icon {
  width: 1.25rem;
  height: 1.25rem;
}

/* Status Warning */
.status-warning {
  margin-top: 0.5rem;
  font-size: 0.75rem;
  color: var(--warning);
}

.settings-link {
  color: var(--accent);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}

/* Shortcut Hint */
.shortcut-hint {
  margin-top: 0.5rem;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.kbd {
  display: inline-block;
  padding: 0.125rem 0.375rem;
  background: var(--bg-card-hover);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
}

/* Dropdown Transitions */
.dropdown-enter-active,
.dropdown-leave-active {
  transition: all 0.2s ease;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.95);
}

.dropdown-enter-to,
.dropdown-leave-from {
  opacity: 1;
  transform: translateY(0) scale(1);
}
</style>
