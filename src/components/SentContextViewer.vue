<script setup lang="ts">
/**
 * SentContextViewer - Shows the resolved context for a past message
 *
 * Opens a modal displaying the context that was sent with a user message.
 * Read-only view for trust and debugging purposes.
 */

import { ref, watch } from 'vue'
import type { Message } from '@/db/types'
import { getPromptContextConfig } from '@/db/repositories'

const props = defineProps<{
  message: Message | null
  messageMap: Map<string, Message>
  isOpen: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

// State
const contextMessages = ref<Message[]>([])
const isLoading = ref(false)
const error = ref<string | null>(null)

// Load context when message changes
watch(
  () => [props.message, props.isOpen],
  async ([newMessage, isOpen]) => {
    if (!newMessage || !isOpen || (newMessage as Message).role !== 'user') {
      contextMessages.value = []
      return
    }

    isLoading.value = true
    error.value = null

    try {
      const config = await getPromptContextConfig((newMessage as Message).id)
      if (config?.resolvedContextMessageIds) {
        // Resolve message IDs to actual messages
        const messages: Message[] = []
        for (const id of config.resolvedContextMessageIds) {
          const msg = props.messageMap.get(id)
          if (msg) {
            messages.push(msg)
          }
        }
        contextMessages.value = messages
      } else {
        contextMessages.value = []
        error.value = 'No context snapshot available for this message'
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load context'
      contextMessages.value = []
    } finally {
      isLoading.value = false
    }
  },
  { immediate: true }
)

// Role display helpers
function getRoleIcon(role: string): string {
  switch (role) {
    case 'user':
      return '👤'
    case 'assistant':
      return '🤖'
    case 'system':
      return '⚙️'
    default:
      return '📝'
  }
}

function getRoleLabel(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1)
}

// Truncate long content for preview
function truncateContent(content: string, maxLength = 200): string {
  if (content.length <= maxLength) return content
  return content.slice(0, maxLength) + '...'
}
</script>

<template>
  <div
    v-if="isOpen"
    class="modal-overlay"
    data-testid="sent-context-viewer"
    @click.self="emit('close')"
  >
    <div class="modal-content">
      <div class="modal-header">
        <h2 class="modal-title">Sent Context</h2>
        <button
          class="close-btn"
          data-testid="close-context-viewer"
          @click="emit('close')"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="icon" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
          </svg>
        </button>
      </div>

      <p class="modal-description">
        This is the context that was sent to the AI when this message was submitted.
        The order shown reflects what the model received.
      </p>

      <!-- Loading state -->
      <div v-if="isLoading" class="loading-state">
        <div class="spinner"></div>
        <span>Loading context...</span>
      </div>

      <!-- Error state -->
      <div v-else-if="error" class="error-state" data-testid="context-error">
        {{ error }}
      </div>

      <!-- Empty state -->
      <div v-else-if="contextMessages.length === 0" class="empty-state">
        No messages were included in the context.
      </div>

      <!-- Context messages list -->
      <div v-else class="context-list" data-testid="context-messages">
        <div class="context-summary">
          {{ contextMessages.length }} message{{ contextMessages.length === 1 ? '' : 's' }} in context
        </div>

        <div
          v-for="(msg, index) in contextMessages"
          :key="msg.id"
          class="context-message"
          :data-testid="`context-message-${index}`"
        >
          <div class="message-header">
            <span class="role-badge" :class="msg.role">
              {{ getRoleIcon(msg.role) }} {{ getRoleLabel(msg.role) }}
            </span>
            <span v-if="msg.branchTitle" class="branch-title">
              {{ msg.branchTitle }}
            </span>
          </div>
          <div class="message-content">
            {{ truncateContent(msg.content) }}
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button
          class="btn btn-primary"
          @click="emit('close')"
        >
          Close
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 1rem;
}

.modal-content {
  background: var(--bg-card, #1e293b);
  border-radius: 0.75rem;
  max-width: 600px;
  width: 100%;
  max-height: 80vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid var(--border-color, #374151);
}

.modal-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary, #fff);
  margin: 0;
}

.close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: 0.375rem;
  background: transparent;
  border: none;
  color: var(--text-muted, #9ca3af);
  cursor: pointer;
  transition: all 0.2s;
}

.close-btn:hover {
  background: var(--bg-hover, #374151);
  color: var(--text-primary, #fff);
}

.close-btn .icon {
  width: 1.25rem;
  height: 1.25rem;
}

.modal-description {
  padding: 0.75rem 1.5rem;
  font-size: 0.875rem;
  color: var(--text-secondary, #9ca3af);
  margin: 0;
  background: var(--bg-secondary, #0f172a);
}

.loading-state,
.error-state,
.empty-state {
  padding: 2rem;
  text-align: center;
  color: var(--text-muted, #9ca3af);
}

.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
}

.spinner {
  width: 1.5rem;
  height: 1.5rem;
  border: 2px solid var(--border-color, #374151);
  border-top-color: var(--accent, #10b981);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.error-state {
  color: var(--error, #f87171);
}

.context-list {
  flex: 1;
  overflow-y: auto;
  padding: 1rem 1.5rem;
}

.context-summary {
  font-size: 0.75rem;
  color: var(--text-muted, #9ca3af);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 1rem;
}

.context-message {
  background: var(--bg-secondary, #0f172a);
  border-radius: 0.5rem;
  padding: 0.75rem;
  margin-bottom: 0.75rem;
}

.context-message:last-child {
  margin-bottom: 0;
}

.message-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.role-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.75rem;
  font-weight: 500;
  padding: 0.125rem 0.5rem;
  border-radius: 9999px;
}

.role-badge.user {
  background: rgba(16, 185, 129, 0.2);
  color: #10b981;
}

.role-badge.assistant {
  background: rgba(59, 130, 246, 0.2);
  color: #3b82f6;
}

.role-badge.system {
  background: rgba(156, 163, 175, 0.2);
  color: #9ca3af;
}

.branch-title {
  font-size: 0.75rem;
  color: var(--accent, #10b981);
  font-style: italic;
}

.message-content {
  font-size: 0.875rem;
  color: var(--text-secondary, #d1d5db);
  white-space: pre-wrap;
  word-break: break-word;
}

.modal-footer {
  padding: 1rem 1.5rem;
  border-top: 1px solid var(--border-color, #374151);
  display: flex;
  justify-content: flex-end;
}

.btn {
  padding: 0.5rem 1rem;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-primary {
  background: var(--accent, #10b981);
  color: var(--bg-primary);
  border: none;
}

.btn-primary:hover {
  background: var(--accent-hover, #059669);
}
</style>
