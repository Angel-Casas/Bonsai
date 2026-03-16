<script setup lang="ts">
/**
 * MessageTreeNode - Recursive tree node component
 *
 * Renders a single node and its children recursively.
 * Shows compact message previews with branch indicators.
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
const indentPx = computed(() => props.depth * 12)

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

function getMessagePreview(): string {
  if (props.message.branchTitle) {
    return props.message.branchTitle
  }
  const maxLength = 25
  const content = props.message.content.trim().replace(/\n/g, ' ')
  if (content.length <= maxLength) {
    return content || `(${props.message.role})`
  }
  return content.substring(0, maxLength) + '…'
}

function getRoleClass(): string {
  switch (props.message.role) {
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

function getRoleLabel(): string {
  switch (props.message.role) {
    case 'system':
      return 'S'
    case 'user':
      return 'U'
    case 'assistant':
      return 'A'
    default:
      return '?'
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
      :style="{ paddingLeft: `${indentPx}px` }"
    >
      <!-- Branch line indicator -->
      <div v-if="depth > 0" class="branch-line"></div>

      <!-- Collapse/expand toggle -->
      <button
        v-if="hasChildren"
        class="collapse-toggle"
        :class="{ collapsed: isCollapsed }"
        :title="isCollapsed ? `Expand (${hiddenCount} hidden)` : 'Collapse'"
        @click="handleToggleCollapse"
      >
        <svg class="collapse-icon" viewBox="0 0 12 12" fill="none">
          <path
            d="M4 2L8 6L4 10"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
      <span v-else class="collapse-placeholder"></span>

      <!-- Node content -->
      <button
        :data-testid="`tree-node-${message.id}`"
        class="tree-node-content"
        :class="[
          getRoleClass(),
          {
            active: isActive,
            'in-path': isInPath && !isActive,
          }
        ]"
        @click="handleClick"
      >
        <!-- Role indicator -->
        <span class="role-indicator" :class="getRoleClass()">
          {{ getRoleLabel() }}
        </span>

        <!-- Message preview -->
        <span
          class="node-preview"
          :class="{ 'has-title': message.branchTitle }"
        >
          {{ getMessagePreview() }}
        </span>

        <!-- Branch count -->
        <span
          v-if="isBranchPoint"
          class="branch-badge"
          :title="`${children.length} branches`"
        >
          {{ children.length }}
        </span>

        <!-- Hidden count when collapsed -->
        <span
          v-if="isCollapsed && hiddenCount > 0"
          class="hidden-badge"
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
  gap: 0.125rem;
  position: relative;
  min-height: 1.75rem;
}

.branch-line {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 50%;
  width: 1px;
  background: var(--border-subtle);
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
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
  flex-shrink: 0;
  border-radius: var(--radius-sm);
}

.collapse-toggle:hover {
  color: var(--text-primary);
  background: var(--border-muted);
}

.collapse-icon {
  width: 0.625rem;
  height: 0.625rem;
  transition: transform var(--transition-fast);
}

.collapse-toggle:not(.collapsed) .collapse-icon {
  transform: rotate(90deg);
}

.collapse-placeholder {
  width: 1rem;
  flex-shrink: 0;
}

.tree-node-content {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  flex: 1;
  min-width: 0;
  padding: 0.25rem 0.5rem;
  border: none;
  border-radius: var(--radius-sm);
  text-align: left;
  cursor: pointer;
  transition: all var(--transition-fast);
  background: transparent;
  color: var(--text-secondary);
  font-family: var(--font-sans);
  font-size: 0.75rem;
}

.tree-node-content:hover {
  background: var(--border-muted);
  color: var(--text-primary);
}

.tree-node-content.in-path {
  background: rgba(var(--accent-rgb), 0.08);
  color: var(--text-primary);
}

.tree-node-content.active {
  background: rgba(var(--accent-rgb), 0.2);
  color: var(--accent);
}

/* Role indicator */
.role-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.125rem;
  height: 1.125rem;
  font-size: 0.625rem;
  font-weight: 600;
  border-radius: var(--radius-sm);
  flex-shrink: 0;
}

.role-indicator.role-system {
  background: rgba(var(--branch-orange-rgb), 0.15);
  color: var(--branch-orange);
}

.role-indicator.role-user {
  background: rgba(var(--branch-blue-rgb), 0.15);
  color: var(--branch-blue);
}

.role-indicator.role-assistant {
  background: rgba(var(--accent-rgb), 0.15);
  color: var(--accent);
}

.node-preview {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.node-preview.has-title {
  font-weight: 500;
  color: var(--text-primary);
}

.branch-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 1rem;
  height: 1rem;
  padding: 0 0.25rem;
  font-size: 0.625rem;
  font-weight: 500;
  background: var(--branch-pink);
  color: var(--bg-primary);
  border-radius: var(--radius-sm);
  flex-shrink: 0;
}

.hidden-badge {
  font-size: 0.625rem;
  padding: 0.0625rem 0.25rem;
  background: var(--border-muted);
  color: var(--text-muted);
  border-radius: var(--radius-sm);
  flex-shrink: 0;
}
</style>
