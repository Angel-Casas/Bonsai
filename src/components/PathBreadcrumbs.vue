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

const props = defineProps<{
  path: Message[]
  activeMessageId: string | null
}>()

const emit = defineEmits<{
  select: [messageId: string]
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

function getRoleIcon(role: Message['role']): string {
  switch (role) {
    case 'system':
      return '⚙️'
    case 'user':
      return '👤'
    case 'assistant':
      return '🤖'
    default:
      return '💬'
  }
}

function handleSelect(messageId: string) {
  emit('select', messageId)
}

function isActive(messageId: string): boolean {
  return props.activeMessageId === messageId
}
</script>

<template>
  <div
    v-if="path.length > 0"
    class="flex items-center gap-1 overflow-x-auto border-b border-gray-700 bg-gray-800/50 px-4 py-2 text-sm"
    data-testid="path-breadcrumbs"
  >
    <span class="flex-shrink-0 text-gray-500">Path:</span>

    <template v-for="(message, index) in path" :key="message.id">
      <!-- Separator -->
      <span v-if="index > 0" class="flex-shrink-0 text-gray-600">/</span>

      <!-- Breadcrumb item -->
      <button
        :data-testid="`breadcrumb-${message.id}`"
        class="flex flex-shrink-0 items-center gap-1 rounded px-2 py-0.5 transition-colors"
        :class="[
          isActive(message.id)
            ? 'bg-emerald-600 text-white'
            : 'text-gray-400 hover:bg-gray-700 hover:text-white',
        ]"
        @click="handleSelect(message.id)"
      >
        <span class="text-xs">{{ getRoleIcon(message.role) }}</span>
        <span
          class="max-w-[120px] truncate"
          :class="{ 'font-medium': message.branchTitle }"
        >
          {{ getLabel(message) }}
        </span>
      </button>
    </template>
  </div>
</template>
