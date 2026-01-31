<script setup lang="ts">
/**
 * MessageTree - Hierarchical tree view of messages
 *
 * Renders the message tree with:
 * - Indentation to show hierarchy
 * - Branch titles where applicable
 * - Visual indicators for current path
 * - Click to select/navigate
 * - Collapse/expand state for performance
 * - "Collapse all" and "Expand to active path" controls
 */

import { ref, computed, watch, provide } from 'vue'
import type { Message } from '@/db/types'
import MessageTreeNode from '@/components/MessageTreeNode.vue'

const props = defineProps<{
  messages: Message[]
  messageMap: Map<string, Message>
  childrenMap: Map<string, Message[]>
  rootMessages: Message[]
  activeMessageId: string | null
  timelineIds: Set<string>
}>()

const emit = defineEmits<{
  select: [messageId: string]
}>()

// Collapsed state: Set of message IDs that are collapsed
const collapsedNodes = ref<Set<string>>(new Set())

// Auto-collapse threshold: collapse nodes when tree has more than this many messages
const AUTO_COLLAPSE_THRESHOLD = 200

// Whether to show tree controls
const showControls = computed(() => props.messages.length > 50)

// Count of total nodes
const nodeCount = computed(() => props.messages.length)

// Count of visible nodes (rough estimate based on collapsed state)
const visibleNodeCount = computed(() => {
  let count = 0
  const countVisible = (msgId: string | null, depth: number = 0) => {
    const children = msgId ? props.childrenMap.get(msgId) ?? [] : props.rootMessages
    for (const child of children) {
      count++
      if (!collapsedNodes.value.has(child.id)) {
        countVisible(child.id, depth + 1)
      }
    }
  }
  countVisible(null)
  return count
})

// Check if a node is collapsed
function isCollapsed(messageId: string): boolean {
  return collapsedNodes.value.has(messageId)
}

// Toggle collapse state for a node
function toggleCollapse(messageId: string) {
  const newSet = new Set(collapsedNodes.value)
  if (newSet.has(messageId)) {
    newSet.delete(messageId)
  } else {
    newSet.add(messageId)
  }
  collapsedNodes.value = newSet
}

// Expand a specific node
function expandNode(messageId: string) {
  const newSet = new Set(collapsedNodes.value)
  newSet.delete(messageId)
  collapsedNodes.value = newSet
}

// Collapse all nodes except those on the active path
function collapseAll() {
  const newCollapsed = new Set<string>()

  // Collapse all nodes that have children
  for (const msg of props.messages) {
    const children = props.childrenMap.get(msg.id) ?? []
    if (children.length > 0) {
      newCollapsed.add(msg.id)
    }
  }

  collapsedNodes.value = newCollapsed
}

// Expand only the path to the active message
function expandToActivePath() {
  const newCollapsed = new Set<string>()

  // First collapse all nodes with children
  for (const msg of props.messages) {
    const children = props.childrenMap.get(msg.id) ?? []
    if (children.length > 0) {
      newCollapsed.add(msg.id)
    }
  }

  // Then expand all nodes on the active path
  for (const msgId of props.timelineIds) {
    newCollapsed.delete(msgId)
  }

  collapsedNodes.value = newCollapsed
}

// Expand all nodes
function expandAll() {
  collapsedNodes.value = new Set()
}

// Auto-collapse when tree gets large
watch(
  () => props.messages.length,
  (newLength, oldLength) => {
    // If we just loaded a large tree, auto-collapse to active path
    if (newLength > AUTO_COLLAPSE_THRESHOLD && oldLength === 0) {
      expandToActivePath()
    }
  },
  { immediate: true }
)

// Ensure active message path is always visible
watch(
  () => props.activeMessageId,
  (newActiveId) => {
    if (!newActiveId) return

    // Expand all ancestors of the active message
    let currentId: string | null = newActiveId
    while (currentId) {
      const msg = props.messageMap.get(currentId)
      if (!msg) break

      // Expand parent if it's collapsed
      if (msg.parentId && collapsedNodes.value.has(msg.parentId)) {
        expandNode(msg.parentId)
      }

      currentId = msg.parentId
    }
  }
)

// Provide collapse state to child nodes
provide('isCollapsed', isCollapsed)
provide('toggleCollapse', toggleCollapse)

function handleSelect(messageId: string) {
  emit('select', messageId)
}
</script>

<template>
  <div class="message-tree-container">
    <!-- Tree Controls -->
    <div
      v-if="showControls"
      class="tree-controls"
      data-testid="tree-controls"
    >
      <div class="tree-stats">
        <span class="text-xs text-gray-500">
          {{ visibleNodeCount }}/{{ nodeCount }} visible
        </span>
      </div>
      <div class="tree-actions">
        <button
          class="tree-action-btn"
          title="Collapse all branches"
          data-testid="collapse-all-btn"
          @click="collapseAll"
        >
          <span>&#x25B6;</span>
          <span>Collapse</span>
        </button>
        <button
          class="tree-action-btn"
          title="Expand to active path only"
          data-testid="expand-to-path-btn"
          @click="expandToActivePath"
        >
          <span>&#x25BC;</span>
          <span>Active Path</span>
        </button>
        <button
          class="tree-action-btn"
          title="Expand all branches"
          data-testid="expand-all-btn"
          @click="expandAll"
        >
          <span>&#x25BC;</span>
          <span>All</span>
        </button>
      </div>
    </div>

    <!-- Tree Content -->
    <div class="text-sm" data-testid="message-tree">
      <MessageTreeNode
        v-for="rootMessage in rootMessages"
        :key="rootMessage.id"
        :message="rootMessage"
        :depth="0"
        :children-map="childrenMap"
        :active-message-id="activeMessageId"
        :timeline-ids="timelineIds"
        :collapsed-nodes="collapsedNodes"
        @select="handleSelect"
        @toggle-collapse="toggleCollapse"
      />
    </div>
  </div>
</template>

<style scoped>
.message-tree-container {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.tree-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(0, 0, 0, 0.2);
  flex-shrink: 0;
}

.tree-stats {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.tree-actions {
  display: flex;
  gap: 0.25rem;
}

.tree-action-btn {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.6);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 0.25rem;
  cursor: pointer;
  transition: all 0.15s ease;
}

.tree-action-btn:hover {
  color: rgba(255, 255, 255, 0.9);
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.2);
}
</style>
