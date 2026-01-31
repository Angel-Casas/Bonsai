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

import { computed, ref, watch, nextTick } from 'vue'
import type { Message } from '@/db/types'
import VirtualScroller, { type VirtualScrollerItem } from './VirtualScroller.vue'

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
}>()

const emit = defineEmits<{
  select: [messageId: string]
  branch: [messageId: string]
  edit: [messageId: string]
  delete: [messageId: string]
}>()

// Virtual scroller ref
const virtualScrollerRef = ref<InstanceType<typeof VirtualScroller> | null>(null)

// Inline editing state
const editingMessageId = ref<string | null>(null)
const editContent = ref('')

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
      return 'bg-gray-700 text-gray-300'
    case 'user':
      return 'bg-blue-900/50 text-blue-200'
    case 'assistant':
      return 'bg-emerald-900/50 text-emerald-200'
    default:
      return 'bg-gray-700 text-gray-300'
  }
}

function hasOtherBranches(message: Message): boolean {
  if (!message.parentId) return false
  const siblings = props.childrenMap.get(message.parentId) ?? []
  return siblings.length > 1
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
  // Can edit user and assistant messages
  return message.role === 'user' || message.role === 'assistant'
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

function handleSelect(messageId: string) {
  emit('select', messageId)
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

// Scroll to bottom when streaming starts
watch(
  () => props.streamingMessageId,
  (newId) => {
    if (newId && virtualScrollerRef.value && shouldVirtualize.value) {
      nextTick(() => {
        virtualScrollerRef.value?.scrollToBottom()
      })
    }
  }
)

// Expose scroll methods for parent component
function scrollToMessage(messageId: string) {
  if (virtualScrollerRef.value) {
    virtualScrollerRef.value.scrollToItem(messageId)
  } else {
    // Fallback for non-virtualized: use native scroll
    const element = document.querySelector(`[data-testid="timeline-message-${messageId}"]`)
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
}

defineExpose({
  scrollToMessage,
  isVirtualized: shouldVirtualize,
  // Reserved for future inline editing UI
  _startInlineEdit,
  _saveInlineEdit,
})
</script>

<template>
  <div class="message-timeline" data-testid="message-timeline">
    <!-- Empty state -->
    <div
      v-if="!hasMessages"
      class="flex flex-col items-center justify-center py-16 text-gray-500"
    >
      <div class="mb-4 text-6xl">&#x1F4AC;</div>
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
      class="h-full"
    >
      <template #default="{ item }">
        <div
          :data-testid="`timeline-message-${asMessage(item).id}`"
          class="group relative mx-4 my-2 rounded-lg border p-4 transition-all duration-300"
          :class="[
            isHighlighted(asMessage(item).id)
              ? 'border-yellow-500 bg-yellow-500/10 ring-2 ring-yellow-500/50'
              : isActive(asMessage(item).id)
                ? 'border-emerald-500 bg-gray-800'
                : 'border-gray-700 bg-gray-800/50 hover:border-gray-600',
          ]"
        >
          <!-- Header -->
          <div class="mb-2 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <!-- Role badge -->
              <span
                class="rounded px-2 py-0.5 text-xs font-medium"
                :class="getRoleClasses(asMessage(item).role)"
              >
                {{ getRoleLabel(asMessage(item).role) }}
              </span>

              <!-- Branch title -->
              <span
                v-if="asMessage(item).branchTitle"
                class="rounded bg-purple-900/50 px-2 py-0.5 text-xs text-purple-300"
              >
                {{ asMessage(item).branchTitle }}
              </span>

              <!-- Variant indicator -->
              <span
                v-if="asMessage(item).variantOfMessageId"
                class="rounded bg-amber-900/50 px-2 py-0.5 text-xs text-amber-300"
                title="This is an edited variant"
              >
                Variant
              </span>

              <!-- Branch indicator -->
              <span
                v-if="hasOtherBranches(asMessage(item))"
                class="text-xs text-gray-500"
                :title="`${getSiblingCount(asMessage(item))} branches at this point`"
              >
                &#8627; 1/{{ getSiblingCount(asMessage(item)) }}
              </span>

              <!-- Streaming indicator -->
              <span
                v-if="isMessageCurrentlyStreaming(asMessage(item).id)"
                class="flex items-center gap-1 text-xs text-blue-400"
              >
                <span class="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-400"></span>
                Streaming...
              </span>
            </div>

            <!-- Actions -->
            <div class="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              <!-- Edit button -->
              <button
                v-if="canEditMessage(asMessage(item))"
                :data-testid="`edit-btn-${asMessage(item).id}`"
                class="rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-blue-400"
                title="Edit message"
                @click.stop="handleEdit(asMessage(item).id)"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                </svg>
              </button>

              <!-- Delete button -->
              <button
                v-if="canDeleteMessage(asMessage(item))"
                :data-testid="`delete-btn-${asMessage(item).id}`"
                class="rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-red-400"
                title="Delete message"
                @click.stop="handleDelete(asMessage(item).id)"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                </svg>
              </button>

              <!-- Branch button -->
              <button
                :data-testid="`branch-btn-${asMessage(item).id}`"
                class="rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-emerald-400"
                title="Branch from here"
                @click.stop="handleBranch(asMessage(item).id)"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M5 2a1 1 0 00-1 1v14a1 1 0 001 1h10a1 1 0 001-1V7.414l-4-4H5zm4 11a1 1 0 10-2 0v3a1 1 0 102 0v-3zm3-1a1 1 0 011 1v3a1 1 0 11-2 0v-3a1 1 0 011-1z" clip-rule="evenodd" />
                  <path d="M9 4v3a1 1 0 001 1h3" />
                </svg>
              </button>

              <!-- Select button -->
              <button
                :data-testid="`select-btn-${asMessage(item).id}`"
                class="rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-white"
                title="Select this message"
                @click.stop="handleSelect(asMessage(item).id)"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
                </svg>
              </button>
            </div>
          </div>

          <!-- Content -->
          <div
            class="whitespace-pre-wrap text-gray-200"
            @click="handleSelect(asMessage(item).id)"
          >
            {{ getDisplayContent(asMessage(item)) }}
          </div>

          <!-- Active indicator -->
          <div
            v-if="isActive(asMessage(item).id)"
            class="absolute -left-px top-0 h-full w-1 rounded-l bg-emerald-500"
          ></div>
        </div>
      </template>
    </VirtualScroller>

    <!-- Non-virtualized Messages (for small timelines) -->
    <div v-else class="space-y-4 p-4">
      <div
        v-for="message in timeline"
        :key="message.id"
        :data-testid="`timeline-message-${message.id}`"
        class="group relative rounded-lg border p-4 transition-all duration-300"
        :class="[
          isHighlighted(message.id)
            ? 'border-yellow-500 bg-yellow-500/10 ring-2 ring-yellow-500/50'
            : isActive(message.id)
              ? 'border-emerald-500 bg-gray-800'
              : 'border-gray-700 bg-gray-800/50 hover:border-gray-600',
        ]"
      >
        <!-- Header -->
        <div class="mb-2 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <!-- Role badge -->
            <span
              class="rounded px-2 py-0.5 text-xs font-medium"
              :class="getRoleClasses(message.role)"
            >
              {{ getRoleLabel(message.role) }}
            </span>

            <!-- Branch title -->
            <span
              v-if="message.branchTitle"
              class="rounded bg-purple-900/50 px-2 py-0.5 text-xs text-purple-300"
            >
              {{ message.branchTitle }}
            </span>

            <!-- Variant indicator -->
            <span
              v-if="message.variantOfMessageId"
              class="rounded bg-amber-900/50 px-2 py-0.5 text-xs text-amber-300"
              title="This is an edited variant"
            >
              Variant
            </span>

            <!-- Branch indicator -->
            <span
              v-if="hasOtherBranches(message)"
              class="text-xs text-gray-500"
              :title="`${getSiblingCount(message)} branches at this point`"
            >
              &#8627; 1/{{ getSiblingCount(message) }}
            </span>

            <!-- Streaming indicator -->
            <span
              v-if="isMessageCurrentlyStreaming(message.id)"
              class="flex items-center gap-1 text-xs text-blue-400"
            >
              <span class="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-400"></span>
              Streaming...
            </span>
          </div>

          <!-- Actions -->
          <div class="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <!-- Edit button -->
            <button
              v-if="canEditMessage(message)"
              :data-testid="`edit-btn-${message.id}`"
              class="rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-blue-400"
              title="Edit message"
              @click.stop="handleEdit(message.id)"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
              </svg>
            </button>

            <!-- Delete button -->
            <button
              v-if="canDeleteMessage(message)"
              :data-testid="`delete-btn-${message.id}`"
              class="rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-red-400"
              title="Delete message"
              @click.stop="handleDelete(message.id)"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
              </svg>
            </button>

            <!-- Branch button -->
            <button
              :data-testid="`branch-btn-${message.id}`"
              class="rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-emerald-400"
              title="Branch from here"
              @click.stop="handleBranch(message.id)"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M5 2a1 1 0 00-1 1v14a1 1 0 001 1h10a1 1 0 001-1V7.414l-4-4H5zm4 11a1 1 0 10-2 0v3a1 1 0 102 0v-3zm3-1a1 1 0 011 1v3a1 1 0 11-2 0v-3a1 1 0 011-1z" clip-rule="evenodd" />
                <path d="M9 4v3a1 1 0 001 1h3" />
              </svg>
            </button>

            <!-- Select button -->
            <button
              :data-testid="`select-btn-${message.id}`"
              class="rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-white"
              title="Select this message"
              @click.stop="handleSelect(message.id)"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
              </svg>
            </button>
          </div>
        </div>

        <!-- Content -->
        <div
          class="whitespace-pre-wrap text-gray-200"
          @click="handleSelect(message.id)"
        >
          {{ getDisplayContent(message) }}
        </div>

        <!-- Active indicator -->
        <div
          v-if="isActive(message.id)"
          class="absolute -left-px top-0 h-full w-1 rounded-l bg-emerald-500"
        ></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.message-timeline {
  height: 100%;
  overflow: hidden;
}
</style>
