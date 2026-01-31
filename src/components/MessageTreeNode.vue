<script setup lang="ts">
/**
 * MessageTreeNode - Recursive tree node component
 *
 * Renders a single node and its children recursively.
 * Supports collapse/expand for performance optimization.
 */

import { computed } from 'vue'
import type { Message } from '@/db/types'

const props = defineProps<{
  message: Message
  depth: number
  childrenMap: Map<string, Message[]>
  activeMessageId: string | null
  timelineIds: Set<string>
  collapsedNodes: Set<string>
}>()

const emit = defineEmits<{
  select: [messageId: string]
  toggleCollapse: [messageId: string]
}>()

const children = computed(() => props.childrenMap.get(props.message.id) ?? [])
const hasChildren = computed(() => children.value.length > 0)
const isCollapsed = computed(() => props.collapsedNodes.has(props.message.id))
const isActive = computed(() => props.activeMessageId === props.message.id)
const isInPath = computed(() => props.timelineIds.has(props.message.id))
const isBranchPoint = computed(() => children.value.length > 1)
const indentPx = computed(() => props.depth * 16)

// Count of hidden descendants when collapsed
const hiddenCount = computed(() => {
  if (!isCollapsed.value) return 0

  let count = 0
  const countDescendants = (msgId: string) => {
    const kids = props.childrenMap.get(msgId) ?? []
    for (const kid of kids) {
      count++
      countDescendants(kid.id)
    }
  }
  countDescendants(props.message.id)
  return count
})

function getMessageLabel(): string {
  if (props.message.branchTitle) {
    return props.message.branchTitle
  }
  const maxLength = 30
  const content = props.message.content.trim()
  if (content.length <= maxLength) {
    return content || `(${props.message.role})`
  }
  return content.substring(0, maxLength) + '...'
}

function getRoleIcon(): string {
  switch (props.message.role) {
    case 'system':
      return '\u2699\uFE0F' // ⚙️
    case 'user':
      return '\uD83D\uDC64' // 👤
    case 'assistant':
      return '\uD83E\uDD16' // 🤖
    default:
      return '\uD83D\uDCAC' // 💬
  }
}

function handleClick() {
  emit('select', props.message.id)
}

function handleToggleCollapse(event: MouseEvent) {
  event.stopPropagation()
  emit('toggleCollapse', props.message.id)
}

function handleChildSelect(messageId: string) {
  emit('select', messageId)
}

function handleChildToggleCollapse(messageId: string) {
  emit('toggleCollapse', messageId)
}
</script>

<template>
  <div class="tree-node">
    <div
      class="tree-node-row"
      :style="{ marginLeft: `${indentPx}px` }"
    >
      <!-- Collapse/expand toggle -->
      <button
        v-if="hasChildren"
        class="collapse-toggle"
        :class="{ 'is-collapsed': isCollapsed }"
        :title="isCollapsed ? `Expand (${hiddenCount} hidden)` : 'Collapse'"
        @click="handleToggleCollapse"
      >
        <span class="collapse-icon">{{ isCollapsed ? '\u25B6' : '\u25BC' }}</span>
      </button>
      <span v-else class="collapse-placeholder"></span>

      <!-- Node content -->
      <button
        :data-testid="`tree-node-${message.id}`"
        class="tree-node-content"
        :class="[
          isActive
            ? 'is-active'
            : isInPath
              ? 'is-in-path'
              : 'is-inactive',
        ]"
        @click="handleClick"
      >
        <span class="role-icon">{{ getRoleIcon() }}</span>
        <span
          class="node-label"
          :class="{ 'has-branch-title': message.branchTitle }"
        >
          {{ getMessageLabel() }}
        </span>
        <span
          v-if="isBranchPoint"
          class="branch-count"
          :title="`${children.length} branches`"
        >
          &#8627;{{ children.length }}
        </span>
        <span
          v-if="isCollapsed && hiddenCount > 0"
          class="hidden-count"
          :title="`${hiddenCount} messages hidden`"
        >
          +{{ hiddenCount }}
        </span>
      </button>
    </div>

    <!-- Recursive children (only render if not collapsed) -->
    <template v-if="!isCollapsed">
      <MessageTreeNode
        v-for="child in children"
        :key="child.id"
        :message="child"
        :depth="depth + 1"
        :children-map="childrenMap"
        :active-message-id="activeMessageId"
        :timeline-ids="timelineIds"
        :collapsed-nodes="collapsedNodes"
        @select="handleChildSelect"
        @toggle-collapse="handleChildToggleCollapse"
      />
    </template>
  </div>
</template>

<style scoped>
.tree-node-row {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.collapse-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1rem;
  height: 1rem;
  padding: 0;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.4);
  cursor: pointer;
  transition: color 0.15s ease;
  flex-shrink: 0;
}

.collapse-toggle:hover {
  color: rgba(255, 255, 255, 0.8);
}

.collapse-icon {
  font-size: 0.625rem;
  line-height: 1;
}

.collapse-placeholder {
  width: 1rem;
  flex-shrink: 0;
}

.tree-node-content {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex: 1;
  min-width: 0;
  padding: 0.25rem 0.5rem;
  border: none;
  border-radius: 0.25rem;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.tree-node-content.is-active {
  background: rgb(5 150 105); /* emerald-600 */
  color: white;
}

.tree-node-content.is-in-path {
  background: rgb(55 65 81); /* gray-700 */
  color: white;
}

.tree-node-content.is-inactive {
  background: transparent;
  color: rgb(156 163 175); /* gray-400 */
}

.tree-node-content.is-inactive:hover {
  background: rgb(55 65 81); /* gray-700 */
  color: rgb(229 231 235); /* gray-200 */
}

.role-icon {
  flex-shrink: 0;
}

.node-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.node-label.has-branch-title {
  font-weight: 500;
}

.branch-count {
  flex-shrink: 0;
  font-size: 0.75rem;
  color: rgb(107 114 128); /* gray-500 */
}

.hidden-count {
  flex-shrink: 0;
  font-size: 0.625rem;
  padding: 0.125rem 0.25rem;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 0.25rem;
  color: rgb(156 163 175); /* gray-400 */
}
</style>
