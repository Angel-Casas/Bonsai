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

import { ref, computed, watch } from 'vue'
import { 
  AVAILABLE_MODELS, 
  DEFAULT_MODEL, 
  SEARCH_PRESETS,
  buildEffectiveModel,
  type SearchPreset,
} from '@/api/nanogpt'

const props = defineProps<{
  disabled?: boolean
  conversationDefaultModel?: string | null
  isStreaming?: boolean
}>()

const emit = defineEmits<{
  send: [content: string, modelOverride: string | null, webSearchEnabled: boolean, searchPreset: SearchPreset]
  stopGeneration: []
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
  const model = AVAILABLE_MODELS.find(m => m.id === effectiveBaseModel.value)
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

function selectModel(modelId: string | null) {
  modelOverride.value = modelId
  showModelDropdown.value = false
}

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

// Close dropdowns on click outside
function handleClickOutside(event: MouseEvent) {
  const target = event.target as HTMLElement
  if (!target.closest('[data-dropdown="model"]')) {
    showModelDropdown.value = false
  }
  if (!target.closest('[data-dropdown="search"]')) {
    showSearchPresetDropdown.value = false
  }
}

// Setup click outside listener
watch([showModelDropdown, showSearchPresetDropdown], ([model, search]) => {
  if (model || search) {
    document.addEventListener('click', handleClickOutside)
  } else {
    document.removeEventListener('click', handleClickOutside)
  }
})
</script>

<template>
  <div class="border-t border-gray-700 bg-gray-800 p-4" data-testid="message-composer">
    <!-- Model & Web Search Controls -->
    <div class="flex flex-wrap items-center gap-2 mb-3">
      <!-- Model Selector -->
      <div class="relative" data-dropdown="model">
        <button
          class="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full border transition-colors"
          :class="modelOverride 
            ? 'bg-blue-900/50 border-blue-500 text-blue-300' 
            : 'bg-gray-700 border-gray-600 text-gray-300 hover:border-gray-500'"
          data-testid="model-selector-btn"
          @click.stop="showModelDropdown = !showModelDropdown"
        >
          <span>🤖</span>
          <span>{{ effectiveModelDisplay }}</span>
          <span v-if="modelOverride" class="text-blue-400">(override)</span>
          <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        
        <!-- Dropdown -->
        <div
          v-if="showModelDropdown"
          class="absolute bottom-full left-0 mb-1 w-64 bg-gray-800 border border-gray-600 rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto"
          data-testid="model-dropdown"
        >
          <!-- Use conversation default option -->
          <button
            class="w-full px-3 py-2 text-left text-sm hover:bg-gray-700 flex items-center justify-between"
            :class="!modelOverride ? 'bg-gray-700' : ''"
            @click="selectModel(null)"
          >
            <span>Use conversation default</span>
            <span v-if="!modelOverride" class="text-emerald-400">✓</span>
          </button>
          <div class="border-t border-gray-700"></div>
          
          <!-- Model options -->
          <button
            v-for="model in AVAILABLE_MODELS"
            :key="model.id"
            class="w-full px-3 py-2 text-left text-sm hover:bg-gray-700 flex items-center justify-between"
            :class="modelOverride === model.id ? 'bg-gray-700' : ''"
            @click="selectModel(model.id)"
          >
            <div>
              <span class="font-medium">{{ model.name }}</span>
              <span class="text-gray-500 text-xs ml-2">{{ model.id }}</span>
            </div>
            <span v-if="modelOverride === model.id" class="text-emerald-400">✓</span>
          </button>
        </div>
      </div>

      <!-- Web Search Toggle -->
      <button
        class="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full border transition-colors"
        :class="webSearchEnabled 
          ? 'bg-blue-900/50 border-blue-500 text-blue-300' 
          : 'bg-gray-700 border-gray-600 text-gray-400 hover:border-gray-500 hover:text-gray-300'"
        data-testid="web-search-toggle"
        @click="toggleWebSearch"
      >
        <span>🔍</span>
        <span>{{ webSearchEnabled ? 'Web Search On' : 'Web Search' }}</span>
      </button>

      <!-- Search Preset Selector (only when web search is on) -->
      <div v-if="webSearchEnabled" class="relative" data-dropdown="search">
        <button
          class="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full bg-gray-700 border border-gray-600 text-gray-300 hover:border-gray-500 transition-colors"
          data-testid="search-preset-btn"
          @click.stop="showSearchPresetDropdown = !showSearchPresetDropdown"
        >
          <span>{{ SEARCH_PRESETS.find(p => p.id === searchPreset)?.name }}</span>
          <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        
        <div
          v-if="showSearchPresetDropdown"
          class="absolute bottom-full left-0 mb-1 w-48 bg-gray-800 border border-gray-600 rounded-lg shadow-lg z-50"
          data-testid="search-preset-dropdown"
        >
          <button
            v-for="preset in SEARCH_PRESETS"
            :key="preset.id"
            class="w-full px-3 py-2 text-left text-sm hover:bg-gray-700 flex items-center justify-between"
            :class="searchPreset === preset.id ? 'bg-gray-700' : ''"
            @click="selectSearchPreset(preset.id)"
          >
            <div>
              <span class="font-medium">{{ preset.name }}</span>
              <p class="text-gray-500 text-xs">{{ preset.description }}</p>
            </div>
            <span v-if="searchPreset === preset.id" class="text-emerald-400">✓</span>
          </button>
        </div>
      </div>

      <!-- Effective model display -->
      <span class="text-xs text-gray-500 ml-auto hidden sm:inline" data-testid="effective-model">
        Sending as: <code class="bg-gray-900 px-1 rounded">{{ effectiveModel }}</code>
      </span>
    </div>

    <!-- Input Area -->
    <div class="flex gap-2">
      <textarea
        ref="textareaRef"
        v-model="content"
        data-testid="composer-input"
        :disabled="disabled || isStreaming"
        rows="1"
        placeholder="Type a message... (Cmd+Enter to send)"
        class="flex-1 resize-none rounded-lg border border-gray-600 bg-gray-900 px-4 py-3 text-white placeholder-gray-500 focus:border-emerald-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        @keydown="handleKeydown"
        @input="autoResize"
      ></textarea>
      
      <!-- Stop Generation Button (when streaming) -->
      <button
        v-if="isStreaming"
        data-testid="stop-btn"
        class="self-end rounded-lg bg-red-600 px-4 py-3 font-medium text-white transition-colors hover:bg-red-700"
        @click="emit('stopGeneration')"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clip-rule="evenodd" />
        </svg>
      </button>
      
      <!-- Send Button -->
      <button
        v-else
        data-testid="send-btn"
        :disabled="disabled || !content.trim()"
        class="self-end rounded-lg bg-emerald-600 px-4 py-3 font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        @click="handleSend"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
          <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
        </svg>
      </button>
    </div>
    
    <p class="mt-2 text-xs text-gray-500">
      Press <kbd class="rounded bg-gray-700 px-1">⌘</kbd> + <kbd class="rounded bg-gray-700 px-1">Enter</kbd> to send
    </p>
  </div>
</template>
