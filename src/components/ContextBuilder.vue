<script setup lang="ts">
/**
 * ContextBuilder - Hybrid context control panel
 * 
 * Allows users to configure what messages are included in the prompt context:
 * - Set a "Start context from here" anchor (truncate path)
 * - Exclude specific path messages
 * - Pin messages from anywhere in the conversation tree
 * - Preview the final resolved context
 * 
 * The resolved context follows PATH_THEN_PINS ordering:
 * 1. Path messages (after truncation/exclusions)
 * 2. Pinned messages (sorted by createdAt, then id)
 */

import { ref, computed, watch } from 'vue'
import type { Message } from '@/db/types'
import { resolveContext, searchMessages, type ContextResolverConfig, type ResolvedContext } from '@/db'

const props = defineProps<{
  /** Current path from root to active message */
  timeline: Message[]
  /** All messages in the conversation (for pinning from other branches) */
  messageMap: Map<string, Message>
  /** Currently active message ID (cursor position) */
  activeMessageId: string | null
}>()

const emit = defineEmits<{
  /** Emitted when context config changes - parent should store this */
  'update:config': [config: ContextResolverConfig]
}>()

// Context configuration state
const startFromMessageId = ref<string | null>(null)
const excludedMessageIds = ref<Set<string>>(new Set())
const pinnedMessageIds = ref<string[]>([])

// UI state
const isExpanded = ref(false)
const showPinSearch = ref(false)
const pinSearchQuery = ref('')
const activeTab = ref<'path' | 'pins' | 'preview'>('preview')

// Current config as ContextResolverConfig
const currentConfig = computed<ContextResolverConfig>(() => ({
  startFromMessageId: startFromMessageId.value,
  excludedMessageIds: Array.from(excludedMessageIds.value),
  pinnedMessageIds: pinnedMessageIds.value,
}))

// Resolve context whenever config or timeline changes
const resolvedContext = computed<ResolvedContext | null>(() => {
  if (!props.activeMessageId) return null
  return resolveContext(props.activeMessageId, props.messageMap, currentConfig.value)
})

// Search results for pin picker
const searchResults = computed(() => {
  if (!pinSearchQuery.value.trim()) return []
  return searchMessages(pinSearchQuery.value, props.messageMap, 10)
})

// Path messages with exclusion status
const pathWithStatus = computed(() => {
  return props.timeline.map(msg => ({
    message: msg,
    isExcluded: excludedMessageIds.value.has(msg.id),
    isAnchor: msg.id === startFromMessageId.value,
    isBeforeAnchor: startFromMessageId.value 
      ? props.timeline.findIndex(m => m.id === startFromMessageId.value) > props.timeline.findIndex(m => m.id === msg.id)
      : false,
  }))
})

// Get pinned messages with their data
const pinnedMessagesWithData = computed(() => {
  return pinnedMessageIds.value
    .map(id => props.messageMap.get(id))
    .filter((msg): msg is Message => msg !== undefined)
})

// Summary for collapsed state
const contextSummary = computed(() => {
  const resolved = resolvedContext.value
  if (!resolved) return 'No context'
  
  const pathCount = resolved.pathMessages.length
  const pinCount = resolved.pinnedMessages.length
  const warningCount = resolved.warnings.length
  
  let summary = `${pathCount} path`
  if (pinCount > 0) summary += `, ${pinCount} pinned`
  if (warningCount > 0) summary += ` (${warningCount} warning${warningCount > 1 ? 's' : ''})`
  
  return summary
})

// Emit config changes
watch(currentConfig, (config) => {
  emit('update:config', config)
}, { deep: true })

// Actions
function setAnchor(messageId: string) {
  if (startFromMessageId.value === messageId) {
    startFromMessageId.value = null
  } else {
    startFromMessageId.value = messageId
  }
}

function clearAnchor() {
  startFromMessageId.value = null
}

function toggleExclude(messageId: string) {
  if (excludedMessageIds.value.has(messageId)) {
    excludedMessageIds.value.delete(messageId)
  } else {
    excludedMessageIds.value.add(messageId)
  }
  // Trigger reactivity
  excludedMessageIds.value = new Set(excludedMessageIds.value)
}

function pinMessage(messageId: string) {
  if (!pinnedMessageIds.value.includes(messageId)) {
    pinnedMessageIds.value = [...pinnedMessageIds.value, messageId]
  }
  pinSearchQuery.value = ''
  showPinSearch.value = false
}

function unpinMessage(messageId: string) {
  pinnedMessageIds.value = pinnedMessageIds.value.filter(id => id !== messageId)
}

function isMessagePinned(messageId: string): boolean {
  return pinnedMessageIds.value.includes(messageId)
}

function clearAllConfig() {
  startFromMessageId.value = null
  excludedMessageIds.value = new Set()
  pinnedMessageIds.value = []
}

function getRoleLabel(role: Message['role']): string {
  switch (role) {
    case 'system': return 'S'
    case 'user': return 'U'
    case 'assistant': return 'A'
    default: return '?'
  }
}

function getRoleClasses(role: Message['role']): string {
  switch (role) {
    case 'system': return 'bg-gray-600 text-gray-200'
    case 'user': return 'bg-blue-600 text-white'
    case 'assistant': return 'bg-emerald-600 text-white'
    default: return 'bg-gray-600 text-gray-200'
  }
}

function truncateContent(content: string, maxLen: number = 50): string {
  if (content.length <= maxLen) return content
  return content.slice(0, maxLen) + '...'
}
</script>

<template>
  <div class="context-builder border-t border-gray-700 bg-gray-800" data-testid="context-builder">
    <!-- Collapsed Header -->
    <button
      class="flex w-full items-center justify-between px-4 py-2 text-left hover:bg-gray-750"
      data-testid="context-builder-toggle"
      @click="isExpanded = !isExpanded"
    >
      <div class="flex items-center gap-2">
        <svg 
          xmlns="http://www.w3.org/2000/svg" 
          class="h-4 w-4 text-gray-400 transition-transform" 
          :class="{ 'rotate-90': isExpanded }"
          viewBox="0 0 20 20" 
          fill="currentColor"
        >
          <path fill-rule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clip-rule="evenodd" />
        </svg>
        <span class="text-sm font-medium text-gray-300">Context</span>
        <span class="text-xs text-gray-500">{{ contextSummary }}</span>
      </div>
      
      <!-- Warning indicator -->
      <span
        v-if="resolvedContext?.warnings.length"
        class="rounded-full bg-yellow-600 px-2 py-0.5 text-xs text-yellow-100"
        :title="resolvedContext.warnings.map(w => w.message).join('\n')"
      >
        {{ resolvedContext.warnings.length }} ⚠
      </span>
    </button>

    <!-- Expanded Panel -->
    <div v-if="isExpanded" class="border-t border-gray-700 p-4" data-testid="context-builder-panel">
      <!-- Tabs -->
      <div class="mb-4 flex gap-1 rounded-lg bg-gray-900 p-1">
        <button
          v-for="tab in (['preview', 'path', 'pins'] as const)"
          :key="tab"
          class="flex-1 rounded px-3 py-1.5 text-sm font-medium transition-colors"
          :class="activeTab === tab ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'"
          :data-testid="`context-tab-${tab}`"
          @click="activeTab = tab"
        >
          {{ tab === 'preview' ? 'Preview' : tab === 'path' ? 'Path' : 'Pins' }}
        </button>
      </div>

      <!-- Preview Tab -->
      <div v-if="activeTab === 'preview'" class="space-y-3" data-testid="context-preview">
        <!-- Warnings -->
        <div v-if="resolvedContext?.warnings.length" class="space-y-1">
          <div
            v-for="(warning, idx) in resolvedContext.warnings"
            :key="idx"
            class="flex items-start gap-2 rounded bg-yellow-900/30 px-3 py-2 text-sm text-yellow-200"
          >
            <span class="mt-0.5">⚠️</span>
            <span>{{ warning.message }}</span>
          </div>
        </div>

        <!-- Path Messages Section -->
        <div v-if="resolvedContext?.pathMessages.length">
          <h4 class="mb-2 text-xs font-medium uppercase text-gray-500">Path Messages</h4>
          <div class="space-y-1">
            <div
              v-for="msg in resolvedContext.pathMessages"
              :key="msg.id"
              class="flex items-center gap-2 rounded bg-gray-700/50 px-2 py-1 text-sm"
              :data-testid="`preview-path-${msg.id}`"
            >
              <span class="h-5 w-5 rounded text-center text-xs leading-5" :class="getRoleClasses(msg.role)">
                {{ getRoleLabel(msg.role) }}
              </span>
              <span class="flex-1 truncate text-gray-300">{{ truncateContent(msg.content) }}</span>
            </div>
          </div>
        </div>

        <!-- Pinned Messages Section -->
        <div v-if="resolvedContext?.pinnedMessages.length">
          <h4 class="mb-2 text-xs font-medium uppercase text-gray-500">Pinned Messages</h4>
          <div class="space-y-1">
            <div
              v-for="msg in resolvedContext.pinnedMessages"
              :key="msg.id"
              class="flex items-center gap-2 rounded bg-purple-900/30 px-2 py-1 text-sm"
              :data-testid="`preview-pin-${msg.id}`"
            >
              <span class="h-5 w-5 rounded text-center text-xs leading-5" :class="getRoleClasses(msg.role)">
                {{ getRoleLabel(msg.role) }}
              </span>
              <span class="flex-1 truncate text-gray-300">{{ truncateContent(msg.content) }}</span>
              <span class="text-xs text-purple-400">📌</span>
            </div>
          </div>
        </div>

        <!-- Empty State -->
        <div v-if="!resolvedContext?.resolvedMessages.length" class="py-4 text-center text-sm text-gray-500">
          No messages in context
        </div>

        <!-- Total Count -->
        <div v-if="resolvedContext?.resolvedMessages.length" class="pt-2 text-right text-xs text-gray-500">
          Total: {{ resolvedContext.resolvedMessages.length }} messages
        </div>
      </div>

      <!-- Path Tab -->
      <div v-if="activeTab === 'path'" class="space-y-2" data-testid="context-path-config">
        <p class="text-xs text-gray-500 mb-3">
          Configure which path messages are included. Set an anchor to truncate history, or exclude specific messages.
        </p>

        <!-- Current Anchor -->
        <div v-if="startFromMessageId" class="flex items-center gap-2 rounded bg-blue-900/30 px-3 py-2 mb-3">
          <span class="text-blue-300">📍 Anchor set:</span>
          <span class="text-sm text-gray-300">{{ truncateContent(messageMap.get(startFromMessageId)?.content ?? '', 30) }}</span>
          <button
            class="ml-auto text-xs text-blue-400 hover:text-blue-300"
            data-testid="clear-anchor-btn"
            @click="clearAnchor"
          >
            Clear
          </button>
        </div>

        <!-- Path Messages -->
        <div class="space-y-1 max-h-48 overflow-y-auto">
          <div
            v-for="item in pathWithStatus"
            :key="item.message.id"
            class="flex items-center gap-2 rounded px-2 py-1.5 text-sm"
            :class="[
              item.isBeforeAnchor ? 'opacity-40' : '',
              item.isExcluded ? 'bg-red-900/20 line-through' : 'bg-gray-700/50',
            ]"
            :data-testid="`path-item-${item.message.id}`"
          >
            <span class="h-5 w-5 rounded text-center text-xs leading-5" :class="getRoleClasses(item.message.role)">
              {{ getRoleLabel(item.message.role) }}
            </span>
            <span class="flex-1 truncate text-gray-300">{{ truncateContent(item.message.content, 40) }}</span>
            
            <!-- Anchor indicator -->
            <span v-if="item.isAnchor" class="text-xs text-blue-400">📍</span>
            
            <!-- Actions -->
            <div class="flex gap-1">
              <button
                class="rounded p-1 text-xs hover:bg-gray-600"
                :class="item.isAnchor ? 'text-blue-400' : 'text-gray-500'"
                :title="item.isAnchor ? 'Clear anchor' : 'Set as context start'"
                :data-testid="`anchor-btn-${item.message.id}`"
                @click="setAnchor(item.message.id)"
              >
                📍
              </button>
              <button
                class="rounded p-1 text-xs hover:bg-gray-600"
                :class="item.isExcluded ? 'text-red-400' : 'text-gray-500'"
                :title="item.isExcluded ? 'Include in context' : 'Exclude from context'"
                :data-testid="`exclude-btn-${item.message.id}`"
                @click="toggleExclude(item.message.id)"
              >
                {{ item.isExcluded ? '✓' : '✗' }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Pins Tab -->
      <div v-if="activeTab === 'pins'" class="space-y-3" data-testid="context-pins-config">
        <p class="text-xs text-gray-500">
          Pin messages from anywhere in the conversation tree. Pinned messages are added after path messages.
        </p>

        <!-- Search to pin -->
        <div class="relative">
          <input
            v-model="pinSearchQuery"
            type="text"
            placeholder="Search messages to pin..."
            class="w-full rounded border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-emerald-500 focus:outline-none"
            data-testid="pin-search-input"
            @focus="showPinSearch = true"
          />
          
          <!-- Search results dropdown -->
          <div
            v-if="showPinSearch && searchResults.length > 0"
            class="absolute left-0 right-0 top-full z-10 mt-1 max-h-48 overflow-y-auto rounded border border-gray-600 bg-gray-800 shadow-lg"
          >
            <button
              v-for="msg in searchResults"
              :key="msg.id"
              class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-700"
              :class="{ 'opacity-50': isMessagePinned(msg.id) }"
              :disabled="isMessagePinned(msg.id)"
              :data-testid="`pin-result-${msg.id}`"
              @click="pinMessage(msg.id)"
            >
              <span class="h-5 w-5 rounded text-center text-xs leading-5" :class="getRoleClasses(msg.role)">
                {{ getRoleLabel(msg.role) }}
              </span>
              <span class="flex-1 truncate text-gray-300">{{ truncateContent(msg.content, 50) }}</span>
              <span v-if="isMessagePinned(msg.id)" class="text-xs text-purple-400">📌</span>
            </button>
          </div>
        </div>

        <!-- Click outside to close -->
        <div
          v-if="showPinSearch"
          class="fixed inset-0 z-0"
          @click="showPinSearch = false"
        ></div>

        <!-- Pinned messages list -->
        <div v-if="pinnedMessagesWithData.length" class="space-y-1">
          <h4 class="text-xs font-medium uppercase text-gray-500">Pinned</h4>
          <div
            v-for="msg in pinnedMessagesWithData"
            :key="msg.id"
            class="flex items-center gap-2 rounded bg-purple-900/30 px-2 py-1.5 text-sm"
            :data-testid="`pinned-item-${msg.id}`"
          >
            <span class="h-5 w-5 rounded text-center text-xs leading-5" :class="getRoleClasses(msg.role)">
              {{ getRoleLabel(msg.role) }}
            </span>
            <span class="flex-1 truncate text-gray-300">{{ truncateContent(msg.content, 40) }}</span>
            <button
              class="rounded p-1 text-xs text-purple-400 hover:bg-gray-600 hover:text-purple-300"
              title="Unpin"
              :data-testid="`unpin-btn-${msg.id}`"
              @click="unpinMessage(msg.id)"
            >
              ✗
            </button>
          </div>
        </div>

        <!-- Empty pins state -->
        <div v-else class="py-4 text-center text-sm text-gray-500">
          No pinned messages. Search above to add pins.
        </div>
      </div>

      <!-- Footer Actions -->
      <div class="mt-4 flex justify-between border-t border-gray-700 pt-3">
        <button
          class="text-xs text-gray-500 hover:text-gray-300"
          data-testid="clear-config-btn"
          @click="clearAllConfig"
        >
          Reset to defaults
        </button>
        <span class="text-xs text-gray-600">
          Config affects next message
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hover\:bg-gray-750:hover {
  background-color: rgb(40, 42, 50);
}
</style>
