<script setup lang="ts">
/**
 * HomeView - Conversation List
 *
 * Displays list of conversations with:
 * - Create new conversation
 * - Rename conversation
 * - Delete conversation (with confirmation)
 */

import { ref, onMounted, computed, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useConversationStore } from '@/stores/conversationStore'
import { useThemeStore } from '@/stores/themeStore'
import { useTutorial } from '@/composables/useTutorial'
import TopNavBar from '@/components/TopNavBar.vue'
import HalftoneBackground from '@/components/HalftoneBackground.vue'

const router = useRouter()
const store = useConversationStore()
const themeStore = useThemeStore()
const tutorial = useTutorial()

// Local state
const newConversationTitle = ref('')
const showNewConversationInput = ref(false)
const isCreating = ref(false)
const editingConversationId = ref<string | null>(null)
const editingTitle = ref('')
const deletingConversationId = ref<string | null>(null)

// Computed
const sortedConversations = computed(() => store.conversations)

// Actions
onMounted(async () => {
  await store.loadConversations()

  // Auto-trigger Quick Setup for first-time users
  nextTick(() => {
    if (tutorial.shouldAutoTriggerQuickSetup()) {
      tutorial.startTutorial('quick-setup')
    }
  })
})

async function createConversation() {
  if (isCreating.value) return
  isCreating.value = true

  try {
    const title = newConversationTitle.value.trim() || 'New Conversation'
    const conversation = await store.createNewConversation(title)
    newConversationTitle.value = ''
    showNewConversationInput.value = false
    router.push({ name: 'conversation', params: { id: conversation.id } })
  } catch (error) {
    console.error('Failed to create conversation:', error)
  } finally {
    isCreating.value = false
  }
}

function startEditing(id: string, currentTitle: string) {
  editingConversationId.value = id
  editingTitle.value = currentTitle
}

async function saveEdit() {
  if (editingConversationId.value && editingTitle.value.trim()) {
    await store.renameConversation(editingConversationId.value, editingTitle.value.trim())
  }
  cancelEdit()
}

function cancelEdit() {
  editingConversationId.value = null
  editingTitle.value = ''
}

function confirmDelete(id: string) {
  deletingConversationId.value = id
}

async function executeDelete() {
  if (deletingConversationId.value) {
    await store.removeConversation(deletingConversationId.value)
  }
  cancelDelete()
}

function cancelDelete() {
  deletingConversationId.value = null
}

function openConversation(id: string) {
  router.push({ name: 'conversation', params: { id } })
}

function formatDate(isoString: string): string {
  const date = new Date(isoString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) {
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  } else if (diffDays === 1) {
    return 'Yesterday'
  } else if (diffDays < 7) {
    return date.toLocaleDateString(undefined, { weekday: 'long' })
  } else {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }
}
</script>

<template>
  <div class="home-page" :class="{ 'day-mode': themeStore.isDayMode }">
    <!-- Halftone Background -->
    <HalftoneBackground />

    <!-- Top Navigation Bar -->
    <TopNavBar />

    <!-- Main Content -->
    <main class="home-main">
      <div class="content-container">
        <!-- New Conversation Section -->
        <div class="new-conversation-section">
          <div v-if="!showNewConversationInput">
            <button
              data-testid="new-conversation-btn"
              class="new-conversation-btn"
              @click="showNewConversationInput = true"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="icon" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clip-rule="evenodd" />
              </svg>
              New Conversation
            </button>
          </div>
          <div v-else class="new-conversation-form">
            <input
              v-model="newConversationTitle"
              data-testid="new-conversation-input"
              type="text"
              inputmode="text"
              enterkeyhint="done"
              autocomplete="off"
              placeholder="Conversation title..."
              class="conversation-input"
              @keydown.enter.prevent="createConversation"
              @keyup.escape="showNewConversationInput = false"
            />
            <button
              data-testid="create-conversation-btn"
              type="button"
              class="action-btn primary"
              :disabled="isCreating"
              @click="createConversation"
            >
              {{ isCreating ? 'Creating...' : 'Create' }}
            </button>
            <button
              type="button"
              class="action-btn secondary"
              @click="showNewConversationInput = false"
            >
              Cancel
            </button>
          </div>
        </div>

        <!-- Loading State -->
        <div v-if="store.isLoadingConversations" class="loading-state">
          <div class="spinner"></div>
        </div>

        <!-- Empty State -->
        <div
          v-else-if="sortedConversations.length === 0"
          class="empty-state"
          data-testid="empty-state"
        >
          <div class="empty-icon">🌱</div>
          <h2 class="empty-title">Start Your First Conversation</h2>
          <p class="empty-description">
            Create a conversation to begin exploring branching dialogue with focused context control.
          </p>
        </div>

        <!-- Conversation List -->
        <div v-else class="conversation-list" data-testid="conversation-list">
          <div
            v-for="conversation in sortedConversations"
            :key="conversation.id"
            :data-testid="`conversation-item-${conversation.id}`"
            class="conversation-card"
            @click="openConversation(conversation.id)"
          >
            <!-- Delete Confirmation Overlay -->
            <div
              v-if="deletingConversationId === conversation.id"
              class="delete-overlay"
              @click.stop
            >
              <div class="delete-content">
                <p class="delete-message">Delete this conversation?</p>
                <div class="delete-actions">
                  <button
                    data-testid="confirm-delete-btn"
                    class="delete-confirm-btn"
                    @click="executeDelete"
                  >
                    Delete
                  </button>
                  <button
                    data-testid="cancel-delete-btn"
                    class="delete-cancel-btn"
                    @click="cancelDelete"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>

            <!-- Edit Mode -->
            <div v-if="editingConversationId === conversation.id" class="edit-form" @click.stop>
              <input
                v-model="editingTitle"
                data-testid="edit-title-input"
                type="text"
                class="edit-input"
                @keyup.enter="saveEdit"
                @keyup.escape="cancelEdit"
              />
              <button
                data-testid="save-edit-btn"
                class="action-btn primary small"
                @click="saveEdit"
              >
                Save
              </button>
              <button
                class="action-btn secondary small"
                @click="cancelEdit"
              >
                Cancel
              </button>
            </div>

            <!-- Normal View -->
            <div v-else class="conversation-content">
              <div class="conversation-info">
                <div class="title-row">
                  <h3 class="conversation-title">{{ conversation.title }}</h3>
                  <button
                    :data-testid="`edit-btn-${conversation.id}`"
                    class="title-edit-btn"
                    title="Rename"
                    @click.stop="startEditing(conversation.id, conversation.title)"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" class="icon-xs" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                    </svg>
                  </button>
                </div>
                <p class="conversation-date">{{ formatDate(conversation.updatedAt) }}</p>
              </div>

              <!-- Delete Button -->
              <button
                :data-testid="`delete-btn-${conversation.id}`"
                class="icon-action-btn danger"
                title="Delete"
                @click.stop="confirmDelete(conversation.id)"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="icon-sm" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
.home-page {
  min-height: 100vh;
  padding-top: 60px; /* Account for fixed navbar */
  background: transparent;
  color: var(--text-primary);
  transition: color 0.4s ease;
}

/* Main Content */
.home-main {
  padding: 2rem 1.5rem;
  position: relative;
  z-index: 1;
}

.content-container {
  max-width: 48rem;
  margin: 0 auto;
}

/* New Conversation Section */
.new-conversation-section {
  margin-bottom: 2rem;
}

.new-conversation-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1.25rem;
  font-family: var(--font-sans);
  font-size: 0.95rem;
  font-weight: 500;
  color: var(--bg-primary);
  background: linear-gradient(135deg, rgba(var(--accent-rgb), 0.95) 0%, rgba(var(--accent-rgb), 0.8) 100%);
  border: none;
  border-radius: var(--radius-lg);
  cursor: pointer;
  transition: all var(--transition-normal);
}

.new-conversation-btn:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-accent);
}

.new-conversation-form {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

/* Mobile responsive styles */
@media (max-width: 480px) {
  .new-conversation-form .conversation-input {
    flex: 1 1 100%;
    margin-bottom: 0.5rem;
  }

  .new-conversation-form .action-btn {
    flex: 1;
    min-height: 44px; /* Minimum touch target size */
  }
}

.conversation-input {
  flex: 1;
  padding: 0.75rem 1rem;
  font-family: var(--font-sans);
  font-size: 0.95rem;
  color: var(--text-primary);
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  transition: all var(--transition-normal);
}

.conversation-input::placeholder {
  color: var(--text-muted);
}

.conversation-input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(var(--accent-rgb), 0.15);
}

/* Action Buttons */
.action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.75rem 1.25rem;
  font-family: var(--font-sans);
  font-size: 0.9rem;
  font-weight: 500;
  border-radius: var(--radius-lg);
  cursor: pointer;
  transition: all var(--transition-normal);
}

.action-btn.primary {
  background: linear-gradient(135deg, rgba(var(--accent-rgb), 0.95) 0%, rgba(var(--accent-rgb), 0.8) 100%);
  color: var(--bg-primary);
  border: none;
}

.action-btn.primary:hover:not(:disabled) {
  box-shadow: var(--shadow-accent);
}

.action-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.action-btn.secondary {
  background: var(--bg-card);
  color: var(--text-secondary);
  border: 1px solid var(--border-subtle);
}

.action-btn.secondary:hover {
  background: var(--bg-card-hover);
  color: var(--text-primary);
}

.action-btn.small {
  padding: 0.5rem 1rem;
  font-size: 0.85rem;
}

/* Loading State */
.loading-state {
  display: flex;
  justify-content: center;
  padding: 4rem 0;
}

.spinner {
  width: 2.5rem;
  height: 2.5rem;
  border: 3px solid var(--border-subtle);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Empty State */
.empty-state {
  text-align: center;
  padding: 4rem 2rem;
}

.empty-icon {
  font-size: 4rem;
  margin-bottom: 1rem;
}

.empty-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 0.5rem 0;
}

.empty-description {
  font-size: 0.95rem;
  color: var(--text-secondary);
  max-width: 24rem;
  margin: 0 auto;
}

/* Conversation List */
.conversation-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.conversation-card {
  position: relative;
  background: var(--glass-bg);
  backdrop-filter: blur(8px);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  padding: 1rem 1.25rem;
  transition: all var(--transition-normal);
  cursor: pointer;
}

.conversation-card:hover {
  border-color: var(--border-color);
  background: var(--glass-bg-solid);
}

.conversation-card:active {
  transform: scale(0.995);
}

/* Delete Overlay */
.delete-overlay {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--glass-bg-solid);
  border-radius: var(--radius-lg);
}

.delete-content {
  text-align: center;
}

.delete-message {
  color: var(--text-secondary);
  margin: 0 0 1rem 0;
}

.delete-actions {
  display: flex;
  justify-content: center;
  gap: 0.5rem;
}

.delete-confirm-btn {
  padding: 0.5rem 1rem;
  font-size: 0.85rem;
  font-weight: 500;
  color: white;
  background: var(--error);
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-normal);
}

.delete-confirm-btn:hover {
  filter: brightness(1.1);
}

.delete-cancel-btn {
  padding: 0.5rem 1rem;
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--text-secondary);
  background: var(--bg-card-hover);
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-normal);
}

.delete-cancel-btn:hover {
  color: var(--text-primary);
}

/* Edit Form */
.edit-form {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.edit-input {
  flex: 1;
  padding: 0.5rem 0.75rem;
  font-family: var(--font-sans);
  font-size: 0.9rem;
  color: var(--text-primary);
  background: var(--bg-primary);
  border: 1px solid var(--accent);
  border-radius: var(--radius-md);
}

.edit-input:focus {
  outline: none;
}

/* Conversation Content */
.conversation-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.conversation-info {
  flex: 1;
  min-width: 0;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.conversation-title {
  font-family: var(--font-sans);
  font-size: 1rem;
  font-weight: 500;
  color: var(--text-primary);
  margin: 0;
  transition: color var(--transition-normal);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conversation-card:hover .conversation-title {
  color: var(--accent);
}

.title-edit-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: var(--radius-sm);
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  opacity: 0;
  transition: all var(--transition-normal);
  flex-shrink: 0;
}

.conversation-card:hover .title-edit-btn {
  opacity: 1;
}

.title-edit-btn:hover {
  background: var(--overlay-light);
  color: var(--accent);
}

/* Always show edit button on mobile (no hover) */
@media (max-width: 768px) {
  .title-edit-btn {
    opacity: 0.6;
  }

  .title-edit-btn:active {
    opacity: 1;
    color: var(--accent);
  }
}

.conversation-date {
  font-family: var(--font-mono);
  font-size: 0.8rem;
  color: var(--text-muted);
  margin: 0.25rem 0 0 0;
}

.icon-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: var(--radius-md);
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition-normal);
  opacity: 0;
  flex-shrink: 0;
}

.conversation-card:hover .icon-action-btn {
  opacity: 1;
}

.icon-action-btn:hover {
  background: var(--overlay-light);
  color: var(--text-primary);
}

.icon-action-btn.danger:hover {
  background: var(--error-bg);
  color: var(--error);
}

/* Always show action buttons on mobile (no hover) */
@media (max-width: 768px) {
  .icon-action-btn {
    opacity: 0.6;
  }

  .icon-action-btn:active {
    opacity: 1;
  }

  .icon-action-btn.danger:active {
    color: var(--error);
  }
}

/* Icons */
.icon {
  width: 1.25rem;
  height: 1.25rem;
}

.icon-sm {
  width: 1rem;
  height: 1rem;
}

.icon-xs {
  width: 0.875rem;
  height: 0.875rem;
}
</style>
