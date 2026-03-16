<script setup lang="ts">
/**
 * MessageTimeline - Linear view of messages in the current path
 *
 * Shows messages from root to active message with:
 * - Message content display
 * - Role indicators
 * - Branch indicators (when message has siblings)
 * - Branch-from-here action
 * - Edit and delete actions
 * - Virtual scrolling for large timelines (1000+ messages)
 */

import { computed, ref, watch, nextTick, onMounted } from 'vue'
import type { Message } from '@/db/types'
import { BRANCH_COLORS } from '@/utils/graphLayout'
import VirtualScroller, { type VirtualScrollerItem } from './VirtualScroller.vue'
import TextReveal from './TextReveal.vue'
import { useThemeStore } from '@/stores/themeStore'
import { useConversationStore } from '@/stores/conversationStore'
import { storeToRefs } from 'pinia'

const themeStore = useThemeStore()
const conversationStore = useConversationStore()
const { excludedMessageIds } = storeToRefs(conversationStore)

/** Threshold for enabling virtualization */
const VIRTUALIZATION_THRESHOLD = 50

const props = defineProps<{
  timeline: Message[]
  activeMessageId: string | null
  childrenMap: Map<string, Message[]>
  isStreaming?: boolean
  streamingMessageId?: string | null
  getMessageContent?: (messageId: string) => string
  highlightedMessageId?: string | null
  /** Force enable/disable virtualization (auto if undefined) */
  virtualizationEnabled?: boolean
  /**
   * Initial scroll behavior:
   * - undefined/null: scroll to last user message (default)
   * - 'none': don't scroll at all
   * - string (message ID): scroll to that specific message
   */
  initialScrollTarget?: string | 'none' | null
  /**
   * Branch color mapping from MessageTree.
   * Maps branchTitle -> color hex string (or 'accent' for main branch).
   * Used to ensure consistent colors between tree and timeline views.
   */
  branchColorMap?: Map<string, string>
  /**
   * Set of message IDs created during this session (for entrance animations).
   */
  newMessageIds?: Set<string>
  hasPendingBranch?: boolean
}>()

const emit = defineEmits<{
  select: [messageId: string]
  branch: [messageId: string]
  edit: [messageId: string]
  delete: [messageId: string]
  resend: [messageId: string]
  toggleExclude: [messageId: string]

  'animation-complete': [messageId: string]
}>()

// Virtual scroller ref
const virtualScrollerRef = ref<InstanceType<typeof VirtualScroller> | null>(null)

// Non-virtualized messages list ref for scrolling
const messagesListRef = ref<HTMLElement | null>(null)

// Inline editing state
const editingMessageId = ref<string | null>(null)
const editContent = ref('')

// Context-change flash animation tracking
const contextFlashIds = ref<Set<string>>(new Set())
let prevExcludedIds: Set<string> = new Set()

watch(excludedMessageIds, (newSet) => {
  const curr = newSet ?? new Set<string>()
  const changed = new Set<string>()
  // Detect newly excluded
  for (const id of curr) {
    if (!prevExcludedIds.has(id)) changed.add(id)
  }
  // Detect newly included
  for (const id of prevExcludedIds) {
    if (!curr.has(id)) changed.add(id)
  }
  prevExcludedIds = new Set(curr)
  if (changed.size === 0) return

  contextFlashIds.value = changed
  setTimeout(() => {
    contextFlashIds.value = new Set()
  }, 600)
}, { deep: true })

// Determine if virtualization should be enabled
const shouldVirtualize = computed(() => {
  if (props.virtualizationEnabled !== undefined) {
    return props.virtualizationEnabled
  }
  return props.timeline.length >= VIRTUALIZATION_THRESHOLD
})

function getRoleLabel(role: Message['role']): string {
  switch (role) {
    case 'system':
      return 'System'
    case 'user':
      return 'You'
    case 'assistant':
      return 'Assistant'
    default:
      return role
  }
}

function getRoleClasses(role: Message['role']): string {
  switch (role) {
    case 'system':
      return 'role-system'
    case 'user':
      return 'role-user'
    case 'assistant':
      return 'role-assistant'
    default:
      return 'role-system'
  }
}

function hasOtherBranches(message: Message): boolean {
  if (!message.parentId) return false
  const siblings = props.childrenMap.get(message.parentId) ?? []
  if (siblings.length <= 1) return false
  // Only show indicator for branch starts (messages with a branchTitle).
  // Main trunk continuations don't have branchTitle and shouldn't show the indicator.
  return !!message.branchTitle
}

function getSiblingCount(message: Message): number {
  if (!message.parentId) return 0
  const siblings = props.childrenMap.get(message.parentId) ?? []
  return siblings.length
}

function isActive(messageId: string): boolean {
  return props.activeMessageId === messageId
}

function isHighlighted(messageId: string): boolean {
  return props.highlightedMessageId === messageId
}

function isMessageCurrentlyStreaming(messageId: string): boolean {
  return props.isStreaming === true && props.streamingMessageId === messageId
}

function isNewMessage(messageId: string): boolean {
  return props.newMessageIds?.has(messageId) ?? false
}

function handleEntranceEnd(messageId: string) {
  emit('animation-complete', messageId)
}

function getDisplayContent(message: Message): string {
  // Use streaming content if available
  if (props.getMessageContent) {
    return props.getMessageContent(message.id)
  }
  return message.content
}

function canEditMessage(message: Message): boolean {
  // Can't edit while streaming
  if (props.isStreaming) return false
  // Can't edit the currently streaming message
  if (isMessageCurrentlyStreaming(message.id)) return false
  // Can only edit user messages
  return message.role === 'user'
}

/**
 * Check if a message is excluded from context
 */
function isMessageExcluded(messageId: string): boolean {
  return excludedMessageIds.value.has(messageId)
}

/**
 * Toggle a message's exclusion from context
 */
function handleToggleExclude(messageId: string): void {
  emit('toggleExclude', messageId)
}

/**
 * Compute branch colors for each message in the timeline.
 * Messages in the main branch (before any branchTitle) use accent color.
 * Messages in named branches use colors from the palette.
 *
 * If branchColorMap prop is provided (from MessageTree), use those colors
 * to ensure consistency between tree and timeline views.
 */
const messageBranchColors = computed(() => {
  const colorMap = new Map<string, string>()
  let currentColor = 'accent' // Start with main branch color (accent)

  // Use the passed branchColorMap if available for consistency with tree view
  const titleColors = props.branchColorMap

  // Fallback: compute colors locally if no map provided
  const localTitleToColor = new Map<string, string>()
  let colorIndex = 0

  for (const message of props.timeline) {
    if (message.branchTitle) {
      // This message starts or continues a named branch
      let branchColor: string | undefined

      if (titleColors) {
        // Use the color from the tree view
        branchColor = titleColors.get(message.branchTitle)
      }

      if (!branchColor) {
        // Fallback: check local map or assign new color
        branchColor = localTitleToColor.get(message.branchTitle)
        if (!branchColor) {
          branchColor = BRANCH_COLORS[colorIndex % BRANCH_COLORS.length]!
          localTitleToColor.set(message.branchTitle, branchColor)
          colorIndex++
        }
      }

      currentColor = branchColor
    }
    // All messages get the current color (either accent or branch color)
    colorMap.set(message.id, currentColor)
  }

  return colorMap
})

/**
 * Get the style for a message based on its branch color.
 * Uses a colored left border instead of background tinting for a cleaner look.
 */
function getBranchBackgroundStyle(messageId: string): Record<string, string> {
  const color = messageBranchColors.value.get(messageId)
  if (!color || color === 'accent') {
    // Main branch - use accent color for left border
    return {
      borderLeftColor: 'var(--accent)',
    }
  }
  // Named branch - use the branch color for left border
  return {
    borderLeftColor: color,
  }
}

function canDeleteMessage(_message: Message): boolean {
  // Can't delete while streaming
  if (props.isStreaming) return false
  // Can delete any message
  return true
}

// Helper to cast VirtualScrollerItem to Message
function asMessage(item: VirtualScrollerItem): Message {
  return item as unknown as Message
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

function canResendMessage(message: Message): boolean {
  if (props.isStreaming) return false
  return message.role === 'user' || message.role === 'assistant'
}

function handleResend(messageId: string) {
  emit('resend', messageId)
}

// Inline editing functions (reserved for future inline edit UI)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _startInlineEdit(message: Message) {
  editingMessageId.value = message.id
  editContent.value = message.content
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _cancelInlineEdit() {
  editingMessageId.value = null
  editContent.value = ''
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _saveInlineEdit() {
  if (editingMessageId.value && editContent.value.trim()) {
    // Emit edit event - parent will handle the Option A/B logic
    emit('edit', editingMessageId.value)
  }
  _cancelInlineEdit()
}

const hasMessages = computed(() => props.timeline.length > 0)

// Track if we've done the initial scroll on page load
const hasInitialScrolled = ref(false)

// Track the previous timeline's last message ID to detect branch switches
const previousTimelineEndId = ref<string | null>(null)

// Find the last user message in the timeline
function findLastUserMessageId(): string | null {
  for (let i = props.timeline.length - 1; i >= 0; i--) {
    const msg = props.timeline[i]!
    if (msg.role === 'user') {
      return msg.id
    }
  }
  return null
}

// Scroll to last user message
function scrollToLastUserMessage() {
  const lastUserMsgId = findLastUserMessageId()
  if (lastUserMsgId) {
    setTimeout(() => {
      scrollMessageToTop(lastUserMsgId)
    }, 100)
  }
}

// On mount, if timeline already has messages, scroll based on initialScrollTarget
onMounted(() => {
  if (props.timeline.length > 0 && !hasInitialScrolled.value) {
    hasInitialScrolled.value = true
    previousTimelineEndId.value = props.timeline[props.timeline.length - 1]?.id ?? null

    // Handle initial scroll based on prop
    if (props.initialScrollTarget === 'none') {
      // Don't scroll at all
    } else if (props.initialScrollTarget) {
      // Scroll to specific message
      setTimeout(() => {
        scrollMessageToTop(props.initialScrollTarget as string)
      }, 50)
    } else {
      // Default: scroll to last user message
      scrollToLastUserMessage()
    }
  }
})

// Watch for timeline changes - handle initial load and branch switches
watch(
  () => props.timeline,
  (newTimeline, oldTimeline) => {
    if (newTimeline.length === 0) return

    const newEndId = newTimeline[newTimeline.length - 1]?.id ?? null
    const oldEndId = oldTimeline?.[oldTimeline.length - 1]?.id ?? null

    // Initial load
    if (!hasInitialScrolled.value) {
      hasInitialScrolled.value = true
      previousTimelineEndId.value = newEndId

      // Handle initial scroll based on prop
      if (props.initialScrollTarget === 'none') {
        // Don't scroll at all
      } else if (props.initialScrollTarget) {
        // Scroll to specific message
        setTimeout(() => {
          scrollMessageToTop(props.initialScrollTarget as string)
        }, 50)
      } else {
        // Default: scroll to last user message
        scrollToLastUserMessage()
      }
      return
    }

    // Detect branch switch: timeline end changed but not by adding just one message
    // (If user sent a message, length increases by 1 and we handle that separately)
    // Skip scroll when timeline shrinks (deletion) — user is already viewing the right area
    const isBranchSwitch = newEndId !== oldEndId &&
      newEndId !== previousTimelineEndId.value &&
      newTimeline.length >= (oldTimeline?.length ?? 0) &&
      !(newTimeline.length === (oldTimeline?.length ?? 0) + 1 && newTimeline[newTimeline.length - 1]?.role === 'user')

    if (isBranchSwitch) {
      previousTimelineEndId.value = newEndId
      // Scroll the last message to the top of the viewport
      const lastMsg = newTimeline[newTimeline.length - 1]
      if (lastMsg) {
        setTimeout(() => {
          scrollMessageToTop(lastMsg.id)
        }, 100)
      }
    }
  },
  { immediate: true, deep: false }
)

// Scroll to highlighted message when it changes
watch(
  () => props.highlightedMessageId,
  (newId) => {
    if (newId && virtualScrollerRef.value && shouldVirtualize.value) {
      nextTick(() => {
        virtualScrollerRef.value?.scrollToItem(newId)
      })
    }
  }
)

// When a new message arrives (user or assistant), scroll it to top of view
watch(
  () => props.timeline.length,
  (newLength, oldLength) => {
    if (newLength > oldLength) {
      const lastMessage = props.timeline[props.timeline.length - 1]
      // Update tracking
      previousTimelineEndId.value = lastMessage?.id ?? null

      if (lastMessage) {
        setTimeout(() => {
          scrollMessageToTop(lastMessage.id)
        }, 50)
      }
    }
  }
)

/**
 * Scroll so that a specific message is at the top of the view
 */
function scrollMessageToTop(messageId: string) {
  if (shouldVirtualize.value && virtualScrollerRef.value) {
    virtualScrollerRef.value.scrollToItem(messageId)
  } else if (messagesListRef.value) {
    const element = messagesListRef.value.querySelector(
      `[data-testid="timeline-message-${messageId}"]`
    ) as HTMLElement
    if (element) {
      // Use scrollIntoView with 'start' alignment to put message at top
      element.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }
}

/**
 * Scroll to the bottom of the messages list
 */
function scrollToBottom() {
  if (shouldVirtualize.value && virtualScrollerRef.value) {
    virtualScrollerRef.value.scrollToBottom()
  } else if (messagesListRef.value) {
    messagesListRef.value.scrollTop = messagesListRef.value.scrollHeight
  }
}

// Expose scroll methods for parent component
function scrollToMessage(messageId: string) {
  if (virtualScrollerRef.value) {
    virtualScrollerRef.value.scrollToItem(messageId)
  } else if (messagesListRef.value) {
    // Scoped query to only find elements within THIS component's container
    // This prevents cross-pane scrolling in split view
    const element = messagesListRef.value.querySelector(`[data-testid="timeline-message-${messageId}"]`)
    element?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

/**
 * Get the current scroll position
 */
function getScrollPosition(): number {
  if (messagesListRef.value) {
    return messagesListRef.value.scrollTop
  }
  return 0
}

/**
 * Set the scroll position directly
 */
function setScrollPosition(position: number) {
  if (messagesListRef.value) {
    messagesListRef.value.scrollTop = position
  }
}

defineExpose({
  scrollToMessage,
  scrollMessageToTop,
  scrollToBottom,
  getScrollPosition,
  setScrollPosition,
  isVirtualized: shouldVirtualize,
  // Reserved for future inline editing UI
  _startInlineEdit,
  _saveInlineEdit,
})
</script>

<template>
  <div class="message-timeline" data-testid="message-timeline">
    <!-- Empty state -->
    <div v-if="!hasMessages" class="empty-state">
      <div class="empty-icon">&#x1F4AC;</div>
      <p>No messages yet. Start a conversation!</p>
    </div>

    <!-- Virtualized Messages -->
    <VirtualScroller
      v-else-if="shouldVirtualize"
      ref="virtualScrollerRef"
      :items="(timeline as unknown as VirtualScrollerItem[])"
      :estimated-item-height="150"
      :buffer-size="5"
      :enabled="true"
      item-key="id"
      class="scroller"
    >
      <template #default="{ item }">
        <div
          :data-testid="`timeline-message-${asMessage(item).id}`"
          class="message-card"
          :class="{
            'message-card--highlighted': isHighlighted(asMessage(item).id),
            'message-card--active': isActive(asMessage(item).id),
            'message-card--excluded': isMessageExcluded(asMessage(item).id),
            'message-card--context-flash': contextFlashIds.has(asMessage(item).id),
          }"
          :style="getBranchBackgroundStyle(asMessage(item).id)"
        >
          <!-- Header -->
          <div class="message-header">
            <div class="message-meta">
              <span class="role-badge" :class="getRoleClasses(asMessage(item).role)">
                {{ getRoleLabel(asMessage(item).role) }}
              </span>

              <span v-if="asMessage(item).branchTitle" class="branch-badge">
                {{ asMessage(item).branchTitle }}
              </span>

              <span v-if="asMessage(item).variantOfMessageId" class="variant-badge" title="This is an edited variant">
                Variant
              </span>

              <span v-if="hasOtherBranches(asMessage(item))" class="branch-indicator" :title="`${getSiblingCount(asMessage(item))} branches at this point`">
                &#8627; 1/{{ getSiblingCount(asMessage(item)) }}
              </span>

              <span v-if="isMessageCurrentlyStreaming(asMessage(item).id)" class="streaming-badge">
                <span class="streaming-dot"></span>
                Streaming...
              </span>

              <span v-if="isMessageExcluded(asMessage(item).id)" class="excluded-badge" title="Excluded from context">
                <svg xmlns="http://www.w3.org/2000/svg" class="excluded-badge-icon" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" clip-rule="evenodd" />
                  <path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.065 7 9.542 7 .847 0 1.669-.105 2.454-.303z" />
                </svg>
                Excluded
              </span>
            </div>

            <div class="message-actions">
              <button v-if="canEditMessage(asMessage(item))" :data-testid="`edit-btn-${asMessage(item).id}`" class="action-btn action-btn--edit" title="Edit message" @click.stop="handleEdit(asMessage(item).id)">
                <svg xmlns="http://www.w3.org/2000/svg" class="action-icon" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                </svg>
              </button>

              <button v-if="canDeleteMessage(asMessage(item))" :data-testid="`delete-btn-${asMessage(item).id}`" class="action-btn action-btn--delete" title="Delete message" @click.stop="handleDelete(asMessage(item).id)">
                <svg xmlns="http://www.w3.org/2000/svg" class="action-icon" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                </svg>
              </button>

              <button :data-testid="`branch-btn-${asMessage(item).id}`" class="action-btn action-btn--branch" title="Branch from here" @click.stop="handleBranch(asMessage(item).id)">
                <svg xmlns="http://www.w3.org/2000/svg" class="action-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M10 18v-8" />
                  <path d="M10 10L5 3" />
                  <path d="M10 10l5-7" />
                  <path d="M3 5l2-2 2 2" />
                  <path d="M13 5l2-2 2 2" />
                </svg>
              </button>

              <button
                :data-testid="`exclude-btn-${asMessage(item).id}`"
                class="action-btn action-btn--exclude"
                :class="{ 'action-btn--excluded': isMessageExcluded(asMessage(item).id) }"
                :title="isMessageExcluded(asMessage(item).id) ? 'Include in context' : 'Exclude from context'"
                @click.stop="handleToggleExclude(asMessage(item).id)"
              >
                <!-- Eye-off icon when excluded -->
                <svg v-if="isMessageExcluded(asMessage(item).id)" xmlns="http://www.w3.org/2000/svg" class="action-icon" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" clip-rule="evenodd" />
                  <path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.065 7 9.542 7 .847 0 1.669-.105 2.454-.303z" />
                </svg>
                <!-- Eye icon when included -->
                <svg v-else xmlns="http://www.w3.org/2000/svg" class="action-icon" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                  <path fill-rule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clip-rule="evenodd" />
                </svg>
              </button>

              <button v-if="canResendMessage(asMessage(item))" :data-testid="`resend-btn-${asMessage(item).id}`" class="action-btn action-btn--resend" title="Resend message" @click.stop="handleResend(asMessage(item).id)">
                <svg xmlns="http://www.w3.org/2000/svg" class="action-icon" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd" />
                </svg>
              </button>

            </div>
          </div>

          <div class="message-content">
            {{ getDisplayContent(asMessage(item)) }}
          </div>

                  </div>
      </template>
    </VirtualScroller>

    <!-- Non-virtualized Messages -->
    <div v-else ref="messagesListRef" class="messages-list" :class="{ 'day-mode': themeStore.isDayMode }">
      <div
        v-for="message in timeline"
        :key="message.id"
        :data-testid="`timeline-message-${message.id}`"
        class="message-card"
        :class="{
          'message-card--highlighted': isHighlighted(message.id),
          'message-card--active': isActive(message.id),
          'message-card--excluded': isMessageExcluded(message.id),
          'message-card--entering': isNewMessage(message.id),
          'message-card--context-flash': contextFlashIds.has(message.id),
        }"
        :style="getBranchBackgroundStyle(message.id)"
      >
        <div class="message-header">
          <div class="message-meta">
            <span class="role-badge" :class="getRoleClasses(message.role)">
              {{ getRoleLabel(message.role) }}
            </span>

            <span v-if="message.branchTitle" class="branch-badge">
              {{ message.branchTitle }}
            </span>

            <span v-if="message.variantOfMessageId" class="variant-badge" title="This is an edited variant">
              Variant
            </span>

            <span v-if="hasOtherBranches(message)" class="branch-indicator" :title="`${getSiblingCount(message)} branches at this point`">
              &#8627; 1/{{ getSiblingCount(message) }}
            </span>

            <span v-if="isMessageCurrentlyStreaming(message.id)" class="streaming-badge">
              <span class="streaming-dot"></span>
              Streaming...
            </span>

            <span v-if="isMessageExcluded(message.id)" class="excluded-badge" title="Excluded from context">
              <svg xmlns="http://www.w3.org/2000/svg" class="excluded-badge-icon" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" clip-rule="evenodd" />
                <path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.065 7 9.542 7 .847 0 1.669-.105 2.454-.303z" />
              </svg>
              Excluded
            </span>
          </div>

          <div class="message-actions">
            <button v-if="canEditMessage(message)" :data-testid="`edit-btn-${message.id}`" class="action-btn action-btn--edit" title="Edit message" @click.stop="handleEdit(message.id)">
              <svg xmlns="http://www.w3.org/2000/svg" class="action-icon" viewBox="0 0 20 20" fill="currentColor">
                <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
              </svg>
            </button>

            <button v-if="canDeleteMessage(message)" :data-testid="`delete-btn-${message.id}`" class="action-btn action-btn--delete" title="Delete message" @click.stop="handleDelete(message.id)">
              <svg xmlns="http://www.w3.org/2000/svg" class="action-icon" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
              </svg>
            </button>

            <button :data-testid="`branch-btn-${message.id}`" class="action-btn action-btn--branch" title="Branch from here" @click.stop="handleBranch(message.id)">
              <svg xmlns="http://www.w3.org/2000/svg" class="action-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M10 18v-8" />
                <path d="M10 10L5 3" />
                <path d="M10 10l5-7" />
                <path d="M3 5l2-2 2 2" />
                <path d="M13 5l2-2 2 2" />
              </svg>
            </button>

            <button
              :data-testid="`exclude-btn-${message.id}`"
              class="action-btn action-btn--exclude"
              :class="{ 'action-btn--excluded': isMessageExcluded(message.id) }"
              :title="isMessageExcluded(message.id) ? 'Include in context' : 'Exclude from context'"
              @click.stop="handleToggleExclude(message.id)"
            >
              <!-- Eye-off icon when excluded -->
              <svg v-if="isMessageExcluded(message.id)" xmlns="http://www.w3.org/2000/svg" class="action-icon" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" clip-rule="evenodd" />
                <path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.065 7 9.542 7 .847 0 1.669-.105 2.454-.303z" />
              </svg>
              <!-- Eye icon when included -->
              <svg v-else xmlns="http://www.w3.org/2000/svg" class="action-icon" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                <path fill-rule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clip-rule="evenodd" />
              </svg>
            </button>

            <button v-if="canResendMessage(message)" :data-testid="`resend-btn-${message.id}`" class="action-btn action-btn--resend" title="Resend message" @click.stop="handleResend(message.id)">
              <svg xmlns="http://www.w3.org/2000/svg" class="action-icon" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd" />
              </svg>
            </button>

          </div>
        </div>

        <div class="message-content" :class="{ 'message-content--streaming': isMessageCurrentlyStreaming(message.id) }">
          <TextReveal
            v-if="isNewMessage(message.id) && !isMessageCurrentlyStreaming(message.id)"
            :text="getDisplayContent(message)"
            :animate="true"
            @complete="handleEntranceEnd(message.id)"
          />
          <template v-else>
            {{ getDisplayContent(message) }}
          </template>
        </div>

      </div>

      <!-- New branch button after last message -->
      <button
        v-if="timeline.length > 0"
        class="new-branch-btn"
        :disabled="hasPendingBranch || isStreaming"
        @click="emit('branch', timeline[timeline.length - 1]!.id)"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M6 3v12" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 01-9 9" />
        </svg>
        New branch
      </button>
    </div>
  </div>
</template>

<style scoped>
.message-timeline {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.scroller {
  height: 100%;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 4rem 1rem;
  color: var(--text-muted);
}

.empty-icon {
  font-size: 3.5rem;
  margin-bottom: 1rem;
}

.messages-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem;
  /* Large bottom padding to allow last message to scroll to top */
  padding-bottom: 70vh;
  background: rgba(0, 0, 0, 0.2);
  backdrop-filter: blur(8px);
}

.messages-list.day-mode {
  background: rgba(255, 255, 255, 0.2);
}

/* Message Card */
.message-card {
  padding: 1rem;
  padding-left: 1.25rem;
  background: var(--glass-bg);
  backdrop-filter: blur(8px);
  border: 1px solid var(--glass-border);
  border-left: 3px solid var(--accent);
  border-radius: var(--radius-lg);
  transition: all var(--transition-normal);
}

.message-card:hover {
  border-color: var(--glass-border);
  border-left-color: inherit;
  background: var(--glass-bg-solid);
}

.message-card--active {
  border-color: rgba(var(--accent-rgb), 0.3);
  border-left-width: 4px;
}

.message-card--highlighted {
  border-color: var(--warning);
  background: var(--warning-bg);
  box-shadow: 0 0 0 2px var(--warning);
}

.message-card--excluded {
  opacity: 0.5;
  border-left-color: var(--warning) !important;
}

.message-card--excluded .message-content {
  text-decoration: line-through;
  text-decoration-color: var(--text-muted);
}

/* Context state change flash animation */
.message-card--context-flash {
  animation: context-flash 0.6s ease-out;
}

@keyframes context-flash {
  0% {
    box-shadow: 0 0 0 0 rgba(var(--accent-rgb), 0.5);
  }
  30% {
    box-shadow: 0 0 0 4px rgba(var(--accent-rgb), 0.3);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(var(--accent-rgb), 0);
  }
}

/* When excluded, flash with warning color instead */
.message-card--excluded.message-card--context-flash {
  animation: context-flash-exclude 0.6s ease-out;
}

@keyframes context-flash-exclude {
  0% {
    box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.5);
  }
  30% {
    box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.3);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(245, 158, 11, 0);
  }
}

/* Message Header */
.message-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}

.message-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

/* Role Badges */
.role-badge {
  padding: 0.125rem 0.5rem;
  font-size: 0.75rem;
  font-weight: 500;
  border-radius: var(--radius-sm);
}

.role-system {
  background: var(--border-muted);
  color: var(--text-secondary);
}

.role-user {
  background: rgba(var(--branch-blue-rgb), 0.15);
  color: var(--branch-blue);
}

.role-assistant {
  background: rgba(var(--accent-rgb), 0.15);
  color: var(--accent);
}

/* Other Badges */
.branch-badge {
  padding: 0.125rem 0.5rem;
  font-size: 0.75rem;
  background: rgba(var(--branch-pink-rgb), 0.15);
  color: var(--branch-pink);
  border-radius: var(--radius-sm);
}

.variant-badge {
  padding: 0.125rem 0.5rem;
  font-size: 0.75rem;
  background: var(--warning-bg);
  color: var(--warning);
  border-radius: var(--radius-sm);
}

.branch-indicator {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.streaming-badge {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.75rem;
  color: var(--branch-blue);
}

.streaming-dot {
  width: 0.5rem;
  height: 0.5rem;
  background: var(--branch-blue);
  border-radius: 50%;
  animation: pulse 1.5s ease-in-out infinite;
}

.excluded-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.125rem 0.375rem;
  background: var(--warning-bg);
  color: var(--warning);
  border-radius: var(--radius-sm);
  font-size: 0.6875rem;
  font-weight: 500;
}

.excluded-badge-icon {
  width: 0.75rem;
  height: 0.75rem;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

/* Message Actions */
.message-actions {
  display: flex;
  gap: 0.25rem;
  opacity: 0;
  transition: opacity var(--transition-fast);
}

.message-card:hover .message-actions {
  opacity: 1;
}

.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.25rem;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.action-btn:hover {
  background: var(--border-muted);
}

.action-btn--edit:hover {
  color: var(--branch-blue);
}

.action-btn--delete:hover {
  color: var(--error);
}

.action-btn--branch:hover {
  color: var(--accent);
}

.action-btn--resend:hover {
  color: var(--branch-blue);
}

.action-btn--exclude {
  color: var(--text-secondary);
}

.action-btn--exclude:hover {
  color: var(--text-primary);
}

.action-btn--excluded {
  color: var(--warning);
  opacity: 1;
}

.action-btn--excluded:hover {
  color: var(--warning);
  opacity: 0.8;
}

.action-icon {
  width: 1rem;
  height: 1rem;
}

/* Always show message actions on mobile (no hover) */
@media (max-width: 768px) {
  .message-actions {
    opacity: 0.6;
  }

  .action-btn:active {
    opacity: 1;
  }

  .action-btn--edit:active {
    color: var(--branch-blue);
  }

  .action-btn--delete:active {
    color: var(--error);
  }

  .action-btn--branch:active {
    color: var(--accent);
  }

  .action-btn--resend:active {
    color: var(--branch-blue);
  }

  .action-btn--exclude:active {
    color: var(--text-primary);
  }

  .action-btn--excluded {
    opacity: 1;
  }

  .action-btn--excluded:active {
    color: var(--warning);
    opacity: 0.8;
  }

}

/* Message Content */
.message-content {
  white-space: pre-wrap;
  color: var(--text-primary);
  font-size: 0.9375rem;
  line-height: 1.6;
  cursor: pointer;
}

/* Message entrance animation */
.message-card--entering {
  animation: messageEntrance 0.9s cubic-bezier(0.16, 1, 0.3, 1) both;
  will-change: transform, opacity;
}

@keyframes messageEntrance {
  from {
    opacity: 0;
    transform: translateY(16px) scale(0.96);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

/* Streaming cursor */
.message-content--streaming::after {
  content: '';
  display: inline-block;
  width: 2px;
  height: 1.1em;
  background: var(--accent);
  margin-left: 2px;
  vertical-align: text-bottom;
  border-radius: 1px;
  animation: cursorBlink 0.8s step-end infinite;
}

@keyframes cursorBlink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}

/* New branch button */
.new-branch-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  width: 100%;
  padding: 0.5rem;
  margin-top: 0.25rem;
  font-size: 0.75rem;
  font-weight: 500;
  font-family: var(--font-sans);
  color: var(--text-muted);
  background: transparent;
  border: 1px dashed var(--border-subtle);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.new-branch-btn:hover {
  color: var(--accent);
  border-color: rgba(var(--accent-rgb), 0.4);
  background: rgba(var(--accent-rgb), 0.05);
}

.new-branch-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
  pointer-events: none;
}

.new-branch-btn svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

</style>
