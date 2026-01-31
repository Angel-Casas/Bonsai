<script setup lang="ts">
/**
 * SplitViewPane - A single pane in split view mode
 *
 * Contains:
 * - Pane header with focus indicator and model info
 * - Message timeline for this pane's path
 * - Path breadcrumbs
 * - Context Builder (shared context config approach - simpler for MVP)
 * - Message composer (disabled when other pane is streaming)
 *
 * Each pane has its own activeMessageId and timeline, but shares:
 * - The message tree (sidebar is shared)
 * - Context configuration (simplifies UX - both panes use same context settings)
 *
 * Streaming behavior:
 * - Only one pane can stream at a time
 * - When streaming in one pane, the other pane's send is disabled
 */

import { computed } from 'vue'
import type { Message } from '@/db/types'
import type { PaneId } from '@/stores/splitViewStore'
import type { SearchPreset } from '@/api/nanogpt'
import MessageTimeline from './MessageTimeline.vue'
import PathBreadcrumbs from './PathBreadcrumbs.vue'
import MessageComposer from './MessageComposer.vue'

const props = defineProps<{
  paneId: PaneId
  timeline: Message[]
  activeMessageId: string | null
  childrenMap: Map<string, Message[]>
  isFocused: boolean
  isStreaming: boolean
  streamingMessageId: string | null
  canSend: boolean
  conversationDefaultModel: string | null
  getMessageContent: (messageId: string) => string
  highlightedMessageId: string | null
}>()

const emit = defineEmits<{
  focus: []
  selectMessage: [messageId: string]
  branch: [messageId: string]
  edit: [messageId: string]
  delete: [messageId: string]
  send: [content: string, modelOverride: string | null, webSearchEnabled: boolean, searchPreset: SearchPreset]
  stopGeneration: []
}>()

// Pane display name
const paneLabel = computed(() => props.paneId === 'A' ? 'Pane A' : 'Pane B')

// Focus indicator color
const focusColorClass = computed(() => 
  props.isFocused 
    ? 'border-emerald-500 bg-emerald-500/10' 
    : 'border-gray-700 bg-gray-800/50 hover:border-gray-600'
)

// Header focus indicator
const headerClass = computed(() =>
  props.isFocused
    ? 'bg-emerald-900/30 border-emerald-500/50'
    : 'bg-gray-800 border-gray-700'
)

function handleFocus() {
  if (!props.isFocused) {
    emit('focus')
  }
}

function handleSelectMessage(messageId: string) {
  emit('selectMessage', messageId)
}

function handleBranch(messageId: string) {
  emit('branch', messageId)
}

function handleEdit(messageId: string) {
  emit('edit', messageId)
}

function handleDelete(messageId: string) {
  emit('delete', messageId)
}

function handleSend(content: string, modelOverride: string | null, webSearchEnabled: boolean, searchPreset: SearchPreset) {
  emit('send', content, modelOverride, webSearchEnabled, searchPreset)
}

function handleStopGeneration() {
  emit('stopGeneration')
}
</script>

<template>
  <div
    class="flex flex-col border-l first:border-l-0 transition-colors h-full"
    :class="focusColorClass"
    :data-testid="`split-pane-${paneId}`"
    @click="handleFocus"
  >
    <!-- Pane Header -->
    <div 
      class="flex items-center justify-between px-3 py-2 border-b"
      :class="headerClass"
    >
      <div class="flex items-center gap-2">
        <!-- Focus indicator dot -->
        <span 
          class="w-2 h-2 rounded-full"
          :class="isFocused ? 'bg-emerald-500' : 'bg-gray-600'"
        ></span>
        <span 
          class="text-sm font-medium"
          :class="isFocused ? 'text-emerald-300' : 'text-gray-400'"
        >
          {{ paneLabel }}
        </span>
        <span 
          v-if="isFocused" 
          class="text-xs text-emerald-400/70"
        >
          (focused)
        </span>
      </div>
      
      <!-- Model indicator -->
      <div class="flex items-center gap-2 text-xs text-gray-500">
        <span v-if="conversationDefaultModel" class="truncate max-w-32">
          🤖 {{ conversationDefaultModel }}
        </span>
        <span v-if="isStreaming" class="flex items-center gap-1 text-blue-400">
          <span class="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400"></span>
          streaming
        </span>
      </div>
    </div>

    <!-- Breadcrumbs -->
    <PathBreadcrumbs
      v-if="timeline.length > 0"
      :path="timeline"
      :active-message-id="activeMessageId"
      @select="handleSelectMessage"
    />

    <!-- Timeline -->
    <div class="flex-1 overflow-y-auto min-h-0">
      <MessageTimeline
        :timeline="timeline"
        :active-message-id="activeMessageId"
        :children-map="childrenMap"
        :is-streaming="isStreaming"
        :streaming-message-id="streamingMessageId"
        :get-message-content="getMessageContent"
        :highlighted-message-id="highlightedMessageId"
        @select="handleSelectMessage"
        @branch="handleBranch"
        @edit="handleEdit"
        @delete="handleDelete"
      />
    </div>

    <!-- Streaming indicator for this pane -->
    <div
      v-if="isStreaming"
      class="border-t border-blue-900 bg-blue-950 px-3 py-1.5"
    >
      <div class="flex items-center gap-2">
        <div class="h-3 w-3 animate-spin rounded-full border-2 border-blue-400 border-t-transparent"></div>
        <span class="text-xs text-blue-300">Generating...</span>
      </div>
    </div>

    <!-- Send disabled message when other pane is streaming -->
    <div
      v-if="!canSend && !isStreaming"
      class="border-t border-yellow-900/50 bg-yellow-950/30 px-3 py-1.5"
      :data-testid="`pane-${paneId}-send-disabled`"
    >
      <span class="text-xs text-yellow-400/80">
        ⚠️ Send disabled — other pane is streaming
      </span>
    </div>

    <!-- Composer -->
    <MessageComposer
      :disabled="!canSend"
      :is-streaming="isStreaming"
      :conversation-default-model="conversationDefaultModel"
      @send="handleSend"
      @stop-generation="handleStopGeneration"
    />
  </div>
</template>
