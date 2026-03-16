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

import { computed, ref, onMounted } from 'vue'
import type { Message } from '@/db/types'
import type { PaneId } from '@/stores/splitViewStore'
import type { SearchPreset } from '@/api/nanogpt'
import MessageTimeline from './MessageTimeline.vue'
import PathBreadcrumbs from './PathBreadcrumbs.vue'
import MessageComposer from './MessageComposer.vue'
import { useThemeStore } from '@/stores/themeStore'

const themeStore = useThemeStore()

// Ref to MessageTimeline for scroll control
const timelineRef = ref<InstanceType<typeof MessageTimeline> | null>(null)

// Local highlight state for breadcrumb navigation (completely self-contained)
const localHighlightedMessageId = ref<string | null>(null)
let highlightTimeoutId: ReturnType<typeof setTimeout> | null = null

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
  paneModel: string | null // Per-pane model override
  getMessageContent: (messageId: string) => string
  highlightedMessageId: string | null
  /**
   * Initial scroll target:
   * - undefined/null: scroll to last user message (default)
   * - 'none': don't scroll at all
   * - string (message ID): scroll to that specific message
   */
  initialScrollTarget?: string | 'none' | null
  /** Initial scroll position in pixels (overrides initialScrollTarget if set) */
  initialScrollPosition?: number | null
  /** Branch color mapping from MessageTree for consistent colors */
  branchColorMap?: Map<string, string>
  /** Set of message IDs created during this session (for entrance animations) */
  newMessageIds?: Set<string>
}>()

// Restore scroll position on mount if provided
onMounted(() => {
  if (props.initialScrollPosition !== undefined && props.initialScrollPosition !== null) {
    // Use setTimeout to ensure the DOM is ready
    setTimeout(() => {
      timelineRef.value?.setScrollPosition(props.initialScrollPosition!)
    }, 50)
  }
})

// Expose methods for parent to access
function getScrollPosition(): number {
  return timelineRef.value?.getScrollPosition() ?? 0
}

function scrollToMessage(messageId: string): void {
  timelineRef.value?.scrollToMessage(messageId)
}

defineExpose({
  getScrollPosition,
  scrollToMessage,
})

const emit = defineEmits<{
  focus: []
  selectMessage: [messageId: string]
  branch: [messageId: string]
  edit: [messageId: string]
  delete: [messageId: string]
  resend: [messageId: string]
  toggleExclude: [messageId: string]
  send: [content: string, modelOverride: string | null, webSearchEnabled: boolean, searchPreset: SearchPreset]
  stopGeneration: []
  updatePaneModel: [paneId: PaneId, modelId: string]
  'animation-complete': [messageId: string]
}>()

// Pane display name
const paneLabel = computed(() => props.paneId === 'A' ? 'Pane A' : 'Pane B')

// Effective model for this pane (pane override > conversation default)
const effectiveModel = computed(() => props.paneModel || props.conversationDefaultModel)

function handleFocus() {
  if (!props.isFocused) {
    emit('focus')
  }
}

function handleSelectMessage(messageId: string) {
  emit('selectMessage', messageId)
}

function handleNavigateToMessage(messageId: string) {
  // Clear any existing highlight timeout
  if (highlightTimeoutId) {
    clearTimeout(highlightTimeoutId)
  }

  // Highlight the message
  localHighlightedMessageId.value = messageId

  // Scroll to the message in this pane's timeline - fully internal, no parent involvement
  setTimeout(() => {
    timelineRef.value?.scrollToMessage(messageId)
  }, 50)

  // Clear highlight
  highlightTimeoutId = setTimeout(() => {
    localHighlightedMessageId.value = null
    highlightTimeoutId = null
  }, 1200)
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

function handleResend(messageId: string) {
  emit('resend', messageId)
}

function handleToggleExclude(messageId: string) {
  emit('toggleExclude', messageId)
}

function handleSend(content: string, modelOverride: string | null, webSearchEnabled: boolean, searchPreset: SearchPreset) {
  emit('send', content, modelOverride, webSearchEnabled, searchPreset)
}

function handleStopGeneration() {
  emit('stopGeneration')
}

function handleUpdatePaneModel(modelId: string) {
  emit('updatePaneModel', props.paneId, modelId)
}
</script>

<template>
  <div
    class="split-pane"
    :class="{ focused: isFocused, 'day-mode': themeStore.isDayMode }"
    :data-testid="`split-pane-${paneId}`"
    @click="handleFocus"
  >
    <!-- Pane Header -->
    <div class="pane-header" :class="{ focused: isFocused }">
      <div class="pane-info">
        <!-- Focus indicator dot -->
        <span class="focus-dot" :class="{ active: isFocused }"></span>
        <span class="pane-label" :class="{ focused: isFocused }">
          {{ paneLabel }}
        </span>
        <span v-if="isFocused" class="focus-badge">
          (focused)
        </span>
      </div>

      <!-- Model indicator -->
      <div class="pane-meta">
        <span v-if="effectiveModel" class="model-name" :title="paneModel ? 'Per-pane model' : 'Conversation default'">
          {{ effectiveModel }}
          <span v-if="paneModel" class="pane-model-indicator">*</span>
        </span>
        <span v-if="isStreaming" class="streaming-badge">
          <span class="streaming-dot"></span>
          streaming
        </span>
      </div>
    </div>

    <!-- Breadcrumbs -->
    <PathBreadcrumbs
      v-if="timeline.length > 0"
      :path="timeline"
      :active-message-id="activeMessageId"
      @navigate="handleNavigateToMessage"
    />

    <!-- Timeline -->
    <div class="timeline-container">
      <MessageTimeline
        ref="timelineRef"
        :timeline="timeline"
        :active-message-id="activeMessageId"
        :children-map="childrenMap"
        :is-streaming="isStreaming"
        :streaming-message-id="streamingMessageId"
        :get-message-content="getMessageContent"
        :highlighted-message-id="localHighlightedMessageId ?? highlightedMessageId"
        :initial-scroll-target="initialScrollPosition !== undefined && initialScrollPosition !== null ? 'none' : initialScrollTarget"
        :branch-color-map="branchColorMap"
        :new-message-ids="newMessageIds"
        @select="handleSelectMessage"
        @branch="handleBranch"
        @edit="handleEdit"
        @delete="handleDelete"
        @resend="handleResend"
        @toggle-exclude="handleToggleExclude"
        @animation-complete="emit('animation-complete', $event)"
      />
    </div>

    <!-- Streaming indicator for this pane -->
    <div v-if="isStreaming" class="streaming-indicator">
      <div class="spinner"></div>
      <span>Generating...</span>
    </div>

    <!-- Send disabled message when other pane is streaming -->
    <div
      v-if="!canSend && !isStreaming"
      class="send-disabled-banner"
      :data-testid="`pane-${paneId}-send-disabled`"
    >
      <span>Send disabled — other pane is streaming</span>
    </div>

    <!-- Composer -->
    <MessageComposer
      :disabled="!canSend"
      :is-streaming="isStreaming"
      :conversation-default-model="effectiveModel"
      @send="handleSend"
      @stop-generation="handleStopGeneration"
      @update-default-model="handleUpdatePaneModel"
    />
  </div>
</template>

<style scoped>
.split-pane {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: transparent;
  transition: background var(--transition-normal);
}

.split-pane.focused {
  background: rgba(var(--accent-rgb), 0.02);
}

/* Pane Header */
.pane-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--glass-border);
  background: var(--glass-bg);
  backdrop-filter: blur(8px);
  transition: all var(--transition-normal);
}

.pane-header.focused {
  background: rgba(var(--accent-rgb), 0.15);
  border-bottom-color: rgba(var(--accent-rgb), 0.3);
}

.split-pane.day-mode .pane-header {
  background: rgba(255, 255, 255, 0.85);
}

.split-pane.day-mode .pane-header.focused {
  background: rgba(255, 255, 255, 0.9);
  border-bottom-color: rgba(var(--accent-rgb), 0.3);
}

.pane-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.focus-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: var(--text-muted);
  transition: background var(--transition-fast);
}

.focus-dot.active {
  background: var(--accent);
}

.pane-label {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-secondary);
  transition: color var(--transition-fast);
}

.pane-label.focused {
  color: var(--accent);
}

.focus-badge {
  font-size: 0.75rem;
  color: var(--accent);
  opacity: 0.7;
}

.pane-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.model-name {
  max-width: 8rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pane-model-indicator {
  color: var(--accent);
  font-weight: 600;
  margin-left: 0.125rem;
}

.streaming-badge {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  color: var(--branch-blue);
}

.streaming-dot {
  width: 0.375rem;
  height: 0.375rem;
  border-radius: 50%;
  background: var(--branch-blue);
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

/* Timeline Container */
.timeline-container {
  flex: 1;
  min-height: 0;
  overflow: hidden; /* MessageTimeline handles its own scrolling */
}

/* Streaming Indicator */
.streaming-indicator {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-top: 1px solid rgba(var(--accent-rgb), 0.2);
  background: rgba(var(--accent-rgb), 0.05);
  font-size: 0.75rem;
  color: var(--accent);
}

.spinner {
  width: 0.75rem;
  height: 0.75rem;
  border: 2px solid rgba(var(--accent-rgb), 0.3);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Send Disabled Banner */
.send-disabled-banner {
  padding: 0.375rem 0.75rem;
  border-top: 1px solid rgba(251, 191, 36, 0.2);
  background: rgba(251, 191, 36, 0.1);
  font-size: 0.75rem;
  color: var(--warning);
}
</style>
