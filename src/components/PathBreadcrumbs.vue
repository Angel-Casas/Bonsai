<script setup lang="ts">
/**
 * PathBreadcrumbs - Shows the current path in the message tree
 *
 * Displays a compact breadcrumb trail showing:
 * - Path from root to active message
 * - Clickable nodes for navigation
 * - Branch titles where applicable
 */

import type { Message } from '@/db/types'
import { useThemeStore } from '@/stores/themeStore'
import { useConversationStore } from '@/stores/conversationStore'
import { storeToRefs } from 'pinia'

const themeStore = useThemeStore()
const conversationStore = useConversationStore()
const { excludedMessageIds } = storeToRefs(conversationStore)

const props = defineProps<{
  path: Message[]
  activeMessageId: string | null
}>()

const emit = defineEmits<{
  select: [messageId: string]
  navigate: [messageId: string]
}>()

function getLabel(message: Message): string {
  if (message.branchTitle) {
    return message.branchTitle
  }

  // Truncate content
  const maxLength = 15
  const content = message.content.trim()
  if (content.length <= maxLength) {
    return content || `(${message.role})`
  }
  return content.substring(0, maxLength) + '...'
}

function getRoleClass(role: Message['role']): string {
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

function handleSelect(messageId: string) {
  // Emit navigate instead of select - this scrolls to the message
  // without changing the timeline (keeps all messages visible)
  emit('navigate', messageId)
}

function isActive(messageId: string): boolean {
  return props.activeMessageId === messageId
}

function isExcluded(messageId: string): boolean {
  return excludedMessageIds.value.has(messageId)
}
</script>

<template>
  <div
    v-if="path.length > 0"
    class="path-breadcrumbs"
    :class="{ 'day-mode': themeStore.isDayMode }"
    data-testid="path-breadcrumbs"
  >
    <span class="path-label">Path:</span>

    <template v-for="(message, index) in path" :key="message.id">
      <!-- Separator -->
      <span v-if="index > 0" class="separator">/</span>

      <!-- Breadcrumb item -->
      <button
        :data-testid="`breadcrumb-${message.id}`"
        class="breadcrumb-item"
        :class="[
          getRoleClass(message.role),
          {
            active: isActive(message.id),
            excluded: isExcluded(message.id)
          }
        ]"
        @click="handleSelect(message.id)"
      >
        <span v-if="isExcluded(message.id)" class="excluded-indicator" title="Excluded from context">&#8856;</span>
        <span
          class="breadcrumb-label"
          :class="{ 'has-title': message.branchTitle }"
        >
          {{ getLabel(message) }}
        </span>
      </button>
    </template>
  </div>
</template>

<style scoped>
.path-breadcrumbs {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  overflow-x: auto;
  padding: 0.5rem 1rem;
  background: rgba(0, 0, 0, 0.2);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--glass-border);
  font-size: 0.8125rem;
}

.path-breadcrumbs.day-mode {
  background: rgba(255, 255, 255, 0.85);
}

.path-breadcrumbs.day-mode .breadcrumb-item {
  background: rgba(255, 255, 255, 0.7);
}

.path-breadcrumbs.day-mode .breadcrumb-item:hover {
  background: rgba(255, 255, 255, 0.9);
}

.path-breadcrumbs.day-mode .breadcrumb-item.active {
  background: rgba(var(--accent-rgb), 0.1);
}

.path-breadcrumbs.day-mode .breadcrumb-item.active.role-system {
  background: rgba(253, 186, 116, 0.1);
}

.path-breadcrumbs.day-mode .breadcrumb-item.active.role-user {
  background: rgba(147, 197, 253, 0.1);
}

.path-breadcrumbs.day-mode .breadcrumb-item.active.role-assistant {
  background: rgba(var(--accent-rgb), 0.1);
}

.path-label {
  flex-shrink: 0;
  color: var(--text-primary);
  margin-right: 0.25rem;
}

.separator {
  flex-shrink: 0;
  color: var(--text-primary);
  opacity: 0.5;
}

.breadcrumb-item {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  flex-shrink: 0;
  padding: 0.25rem 0.5rem;
  border: none;
  border-radius: var(--radius-sm);
  font-family: var(--font-sans);
  font-size: 0.75rem;
  cursor: pointer;
  transition: all var(--transition-fast);
  background: var(--border-muted);
  color: var(--text-primary);
}

.breadcrumb-item:hover {
  background: var(--bg-card-hover);
  color: var(--text-primary);
}

/* Role colors */
.breadcrumb-item.role-system {
  border-left: 2px solid var(--branch-orange);
}

.breadcrumb-item.role-user {
  border-left: 2px solid var(--branch-blue);
}

.breadcrumb-item.role-assistant {
  border-left: 2px solid var(--accent);
}

/* Active state */
.breadcrumb-item.active {
  background: rgba(var(--accent-rgb), 0.2);
  color: var(--accent);
}

.breadcrumb-item.active.role-system {
  background: rgba(253, 186, 116, 0.15);
  color: var(--branch-orange);
}

.breadcrumb-item.active.role-user {
  background: rgba(147, 197, 253, 0.15);
  color: var(--branch-blue);
}

.breadcrumb-item.active.role-assistant {
  background: rgba(var(--accent-rgb), 0.15);
  color: var(--accent);
}

.breadcrumb-label {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.breadcrumb-label.has-title {
  font-weight: 500;
}

/* Excluded message styles */
.breadcrumb-item.excluded {
  opacity: 0.5;
}

.breadcrumb-item.excluded .breadcrumb-label {
  text-decoration: line-through;
}

.excluded-indicator {
  color: var(--warning);
  font-size: 0.625rem;
  margin-right: 0.125rem;
}
</style>
