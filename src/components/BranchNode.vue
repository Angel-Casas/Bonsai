<script setup lang="ts">
/**
 * BranchNode - Recursive branch node for infinite nesting
 *
 * Renders a single branch and recursively renders its children.
 * Supports unlimited depth of branching.
 */
import { ref, watch, nextTick } from 'vue'

export interface Branch {
  id: string
  title: string
  preview: string
  messageCount: number
  excludedCount: number // Number of messages excluded from context
  leafMessageId: string
  depth: number
  isActive: boolean
  hasExplicitTitle: boolean // true if user provided a branch title, false if auto-generated
  children: Branch[]
  colorIndex: number // Index into branchColors, -1 for main branch (uses accent)
}

const props = defineProps<{
  branch: Branch
  depth?: number
  branchColors: string[] // Color palette passed from parent
}>()

// Get the color for this branch
function getBranchColor(): string {
  if (props.branch.colorIndex < 0) {
    return 'var(--accent)'
  }
  return props.branchColors[props.branch.colorIndex % props.branchColors.length]!
}

const emit = defineEmits<{
  select: [leafMessageId: string]
  'delete-branch': [branchId: string, depth: number]
  'rename-branch': [branchId: string, newTitle: string]
}>()

const isEditing = ref(false)
const editTitle = ref('')
const editInputRef = ref<HTMLInputElement | null>(null)

// Shake animation when excluded count changes
const isShaking = ref(false)
watch(() => props.branch.excludedCount, (newVal, oldVal) => {
  if (newVal !== oldVal) {
    isShaking.value = true
    setTimeout(() => { isShaking.value = false }, 400)
  }
})

function startEdit() {
  editTitle.value = props.branch.title
  isEditing.value = true
  nextTick(() => {
    editInputRef.value?.focus()
    editInputRef.value?.select()
  })
}

function saveEdit() {
  const trimmed = editTitle.value.trim()
  if (trimmed && trimmed !== props.branch.title) {
    emit('rename-branch', props.branch.id, trimmed)
  }
  isEditing.value = false
}

function cancelEdit() {
  isEditing.value = false
}

/**
 * Find the deepest leaf in a branch, following the "main" path if there are untitled children.
 *
 * - If all children have explicit titles (user-named branches), stay at this branch's leaf
 *   because those are separate branches, not continuations of the main conversation.
 * - If there are untitled children (auto-generated names), follow the active one as that
 *   represents the main conversation continuing.
 */
function getDeepestActiveLeaf(branch: Branch): string {
  // If no children, this branch's leafMessageId is the deepest
  if (branch.children.length === 0) {
    return branch.leafMessageId
  }

  // Check if any child is an untitled continuation (not an explicit user-named branch)
  const untitledChildren = branch.children.filter(c => !c.hasExplicitTitle)

  // If all children have explicit titles, they're separate branches - stay at this leaf
  if (untitledChildren.length === 0) {
    return branch.leafMessageId
  }

  // There are untitled continuations - follow the active one (or first untitled)
  const activeUntitled = untitledChildren.find(c => c.isActive) ?? untitledChildren[0]!

  // Recursively get the deepest leaf from the continuation
  return getDeepestActiveLeaf(activeUntitled)
}

function handleBranchClick() {
  // When clicking this branch, navigate to the deepest active leaf
  const targetId = getDeepestActiveLeaf(props.branch)
  emit('select', targetId)
}

function handleChildSelect(leafMessageId: string) {
  // Pass through selections from child branches
  emit('select', leafMessageId)
}

function handleDeleteClick() {
  emit('delete-branch', props.branch.id, props.branch.depth)
}

function handleChildDeleteBranch(branchId: string, depth: number) {
  emit('delete-branch', branchId, depth)
}

function handleChildRenameBranch(branchId: string, newTitle: string) {
  emit('rename-branch', branchId, newTitle)
}
</script>

<template>
  <div
    class="branch-node"
    :class="{ 'is-nested': depth && depth > 0 }"
    :style="depth && depth > 0 ? { '--tree-line-color': getBranchColor() } : {}"
  >
    <div class="branch-item-wrapper">
      <button
        :data-testid="`tree-node-${branch.id}`"
        class="branch-item"
        :class="{
          active: branch.isActive,
          child: depth && depth > 0
        }"
        :style="{ '--branch-color': getBranchColor() }"
        @click="handleBranchClick"
      >
        <div class="branch-header">
          <input
            v-if="isEditing"
            ref="editInputRef"
            v-model="editTitle"
            class="branch-title-input"
            @keydown.enter="saveEdit"
            @keydown.escape="cancelEdit"
            @blur="saveEdit"
            @click.stop
          />
          <span v-else class="branch-title">{{ branch.title }}</span>
          <span class="branch-count">{{ branch.messageCount }}</span>
          <span
            v-if="branch.excludedCount > 0"
            class="excluded-count"
            :class="{ 'excluded-count--shake': isShaking }"
            title="Messages excluded from context"
          >
            {{ branch.excludedCount }} &#8856;
          </span>
          <button
            v-if="!isEditing"
            class="branch-edit-btn"
            title="Rename branch"
            @click.stop="startEdit"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
            </svg>
          </button>
          <button
            v-if="!isEditing"
            class="branch-delete-btn"
            :title="depth === 0 || depth === undefined ? 'Delete conversation' : 'Delete branch'"
            @click.stop="handleDeleteClick"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
            </svg>
          </button>
        </div>
        <div v-if="depth === 0 || depth === undefined" class="branch-preview">
          {{ branch.preview }}
        </div>
      </button>
    </div>

    <!-- Recursive children -->
    <div v-if="branch.children.length > 0" class="branch-children">
      <BranchNode
        v-for="child in branch.children"
        :key="child.id"
        :branch="child"
        :depth="(depth ?? 0) + 1"
        :branch-colors="branchColors"
        @select="handleChildSelect"
        @delete-branch="handleChildDeleteBranch"
        @rename-branch="handleChildRenameBranch"
      />
    </div>
  </div>
</template>

<style scoped>
.branch-node {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

/* Nested branch nodes have a tree line on the left */
.branch-node.is-nested {
  position: relative;
  margin-left: 0.75rem;
  padding-left: 0.75rem;
}

/* Vertical tree line */
.branch-node.is-nested::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--tree-line-color, var(--border-subtle));
  border-radius: 1px;
}

/* Horizontal connector to the branch item */
.branch-node.is-nested::after {
  content: '';
  position: absolute;
  left: 0;
  top: 1rem;
  width: 0.5rem;
  height: 2px;
  background: var(--tree-line-color, var(--border-subtle));
}

.branch-item {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  width: 100%;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--glass-border);
  border-left: 3px solid var(--branch-color, var(--accent));
  border-radius: var(--radius-md);
  background: var(--glass-bg);
  backdrop-filter: blur(8px);
  text-align: left;
  cursor: pointer;
  transition: all var(--transition-fast);
  font-family: var(--font-sans);
}

.branch-item:hover {
  border-color: var(--border-color);
  background: var(--glass-bg-solid);
}

.branch-item.active {
  border-color: var(--accent);
  background: var(--bg-card);
  box-shadow: 0 0 0 1px rgba(var(--accent-rgb), 0.3);
}

.branch-item.child {
  padding: 0.375rem 0.625rem;
}

.branch-header {
  display: flex;
  align-items: center;
  gap: 0.375rem;
}

.branch-title {
  flex: 1;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.branch-item.active .branch-title {
  color: var(--accent);
}

.branch-count {
  flex-shrink: 0;
  font-size: 0.6875rem;
  padding: 0.125rem 0.375rem;
  background: var(--border-muted);
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
}

.branch-item.active .branch-count {
  background: rgba(var(--accent-rgb), 0.2);
  color: var(--accent);
}

.excluded-count {
  flex-shrink: 0;
  font-size: 0.625rem;
  padding: 0.0625rem 0.25rem;
  background: var(--warning-bg);
  color: var(--warning);
  border-radius: var(--radius-sm);
  margin-left: auto;
  transition: transform 0.1s ease;
}

.excluded-count--shake {
  animation: excluded-shake 0.4s ease-in-out;
}

@keyframes excluded-shake {
  0%, 100% { transform: translateX(0); }
  15% { transform: translateX(-3px); }
  30% { transform: translateX(3px); }
  45% { transform: translateX(-2px); }
  60% { transform: translateX(2px); }
  75% { transform: translateX(-1px); }
}

.branch-preview {
  font-size: 0.75rem;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.branch-children {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin-top: 0.125rem;
}

/* Inline title input */
.branch-title-input {
  flex: 1;
  font-size: 0.8125rem;
  font-weight: 500;
  font-family: var(--font-sans);
  color: var(--text-primary);
  background: var(--bg-card);
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  padding: 0.0625rem 0.25rem;
  outline: none;
  min-width: 0;
}


/* Edit button - inline in branch-header */
.branch-edit-btn {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.25rem;
  height: 1.25rem;
  border-radius: var(--radius-sm);
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  opacity: 0;
  padding: 0;
  transition: all var(--transition-fast);
}

.branch-item:hover .branch-edit-btn {
  opacity: 1;
}

.branch-edit-btn:hover {
  background: rgba(var(--accent-rgb), 0.15);
  color: var(--accent);
}

.branch-edit-btn svg {
  width: 12px;
  height: 12px;
}

/* Delete button - inline in branch-header */
.branch-delete-btn {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.25rem;
  height: 1.25rem;
  border-radius: var(--radius-sm);
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  opacity: 0;
  margin-left: auto;
  padding: 0;
  transition: all var(--transition-fast);
}

.branch-item:hover .branch-delete-btn {
  opacity: 1;
}

.branch-delete-btn:hover {
  background: rgba(239, 68, 68, 0.15);
  color: var(--error, #ef4444);
}

.branch-delete-btn svg {
  width: 12px;
  height: 12px;
}

@media (max-width: 768px) {
  .branch-edit-btn,
  .branch-delete-btn {
    opacity: 0.5;
  }
}
</style>
