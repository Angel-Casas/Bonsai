<script setup lang="ts">
/**
 * MessageTree - Conversation tree showing branches
 *
 * Displays a compact tree of conversation branches:
 * - Main conversation path
 * - Branch points where alternatives exist
 * - Click to navigate to any branch
 * - Supports infinite nesting depth
 */

import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import type { Message } from '@/db/types'
import { BRANCH_COLORS } from '@/utils/graphLayout'
import BranchNode from './BranchNode.vue'
import { useConversationStore } from '@/stores/conversationStore'

const conversationStore = useConversationStore()
const { excludedMessageIds } = storeToRefs(conversationStore)

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
  'delete-branch': [branchId: string, depth: number]
  'rename-branch': [branchId: string, newTitle: string]
}>()


/** Represents a branch in the conversation tree */
interface Branch {
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
  colorIndex: number // Index into BRANCH_COLORS for this branch
}

// Track color index during tree building
let colorCounter = 0

/**
 * Build a tree of branches from the message structure
 * A branch is created when a message has multiple children (branch point)
 */
const branchTree = computed((): Branch[] => {
  if (props.rootMessages.length === 0) return []

  // Reset color counter for each rebuild
  colorCounter = 0

  const branches: Branch[] = []

  // Process each root as the start of a branch
  for (const root of props.rootMessages) {
    const branch = buildBranch(root, 0)
    if (branch) {
      branches.push(branch)
    }
  }

  return branches
})

/**
 * Recursively build a branch starting from a message
 * Follows the "main" path (untitled messages) and shows titled branches as sub-branches.
 *
 * Key behavior:
 * - If a message has one untitled child + titled children, follow the untitled one
 *   as the main path and show titled ones as sub-branches
 * - Only create a true "branch point" when multiple untitled children exist
 */
function buildBranch(startMessage: Message, depth: number): Branch {
  let current = startMessage
  let messageCount = 1
  const branchTitle = startMessage.branchTitle
  const titledBranchesAlongPath: Message[] = [] // Collect titled branches we pass

  // Follow the path until we find a true branch point or leaf
  while (true) {
    const children = props.childrenMap.get(current.id) ?? []

    if (children.length === 0) {
      // Leaf node - end of this branch
      break
    } else if (children.length === 1) {
      const onlyChild = children[0]!
      // If the single child has a branch title, treat it as a branch point
      // so it appears separately in the tree
      if (onlyChild.branchTitle) {
        break
      }
      // Single child without title - continue following
      current = onlyChild
      messageCount++
    } else {
      // Multiple children - check if we can continue on a "main" path
      const untitledChildren = children.filter(c => !c.branchTitle)
      const titledChildren = children.filter(c => c.branchTitle)

      if (untitledChildren.length === 1) {
        // Exactly one untitled child = main path continues
        // Collect titled children as branches to show later
        titledBranchesAlongPath.push(...titledChildren)
        current = untitledChildren[0]!
        messageCount++
      } else {
        // Multiple untitled children = true branch point, stop here
        break
      }
    }
  }

  // Get children branches
  const childBranches: Branch[] = []

  // First, add any titled branches we collected while following the main path
  for (const titledChild of titledBranchesAlongPath) {
    const childBranch = buildBranch(titledChild, depth + 1)
    childBranches.push(childBranch)
  }

  // Then handle the final branch point children (if any)
  const branchPointChildren = props.childrenMap.get(current.id) ?? []

  // Show child branches if:
  // 1. Multiple children (traditional branch point), OR
  // 2. Single child with a branch title (explicitly named branch)
  const shouldShowChildren = branchPointChildren.length > 1 ||
    (branchPointChildren.length === 1 && branchPointChildren[0]?.branchTitle)

  if (shouldShowChildren) {
    for (const child of branchPointChildren) {
      const childBranch = buildBranch(child, depth + 1)
      childBranches.push(childBranch)
    }
  }

  // Determine if this branch is active (contains the active message)
  const isActive = isBranchActive(startMessage, current)

  // Create preview from first message
  const preview = getMessagePreview(startMessage)

  // Title: use branch title if available, otherwise generate one
  const title = branchTitle || getBranchTitle(startMessage, depth)

  // Assign color index: -1 for main branch (uses accent), otherwise cycle through palette
  const colorIndex = depth === 0 ? -1 : colorCounter++

  return {
    id: startMessage.id,
    title,
    preview,
    messageCount: countBranchMessages(startMessage, current),
    excludedCount: countExcludedMessages(startMessage, current),
    leafMessageId: current.id,
    depth,
    isActive,
    hasExplicitTitle: !!branchTitle,
    children: childBranches,
    colorIndex,
  }
}

/**
 * Count messages from start to end (following main path through untitled children)
 */
function countBranchMessages(start: Message, end: Message): number {
  let count = 1
  let current = start

  while (current.id !== end.id) {
    const children = props.childrenMap.get(current.id) ?? []
    if (children.length === 1) {
      current = children[0]!
      count++
    } else if (children.length > 1) {
      // Multiple children - follow the untitled one if there's exactly one
      const untitledChildren = children.filter(c => !c.branchTitle)
      if (untitledChildren.length === 1) {
        current = untitledChildren[0]!
        count++
      } else {
        break
      }
    } else {
      break
    }
  }

  return count
}

/**
 * Count excluded messages from start to end (following main path)
 */
function countExcludedMessages(start: Message, end: Message): number {
  const excluded = excludedMessageIds.value
  if (excluded.size === 0) return 0

  let count = excluded.has(start.id) ? 1 : 0
  let current = start

  while (current.id !== end.id) {
    const children = props.childrenMap.get(current.id) ?? []
    if (children.length === 1) {
      current = children[0]!
      if (excluded.has(current.id)) count++
    } else if (children.length > 1) {
      const untitledChildren = children.filter(c => !c.branchTitle)
      if (untitledChildren.length === 1) {
        current = untitledChildren[0]!
        if (excluded.has(current.id)) count++
      } else {
        break
      }
    } else {
      break
    }
  }

  return count
}

/**
 * Check if a branch contains the active message (following main path)
 */
function isBranchActive(start: Message, end: Message): boolean {
  let current: Message | undefined = start

  while (current) {
    if (props.timelineIds.has(current.id)) {
      return true
    }
    if (current.id === end.id) break

    const children: Message[] = props.childrenMap.get(current.id) ?? []
    if (children.length === 1) {
      current = children[0]!
    } else if (children.length > 1) {
      // Multiple children - follow the untitled one if there's exactly one
      const untitledChildren = children.filter(c => !c.branchTitle)
      current = untitledChildren.length === 1 ? untitledChildren[0]! : undefined
    } else {
      current = undefined
    }
  }

  return false
}

/**
 * Generate a default branch title based on position
 */
function getBranchTitle(message: Message, depth: number): string {
  if (depth === 0) {
    return 'Main conversation'
  }
  // Use role to create a label
  const roleLabel = message.role === 'user' ? 'User' : message.role === 'assistant' ? 'Assistant' : 'System'
  return `${roleLabel} branch`
}

/**
 * Get a short preview of message content
 */
function getMessagePreview(message: Message): string {
  const content = message.content.trim().replace(/\n/g, ' ')
  const maxLength = 40
  if (content.length <= maxLength) {
    return content || `(${message.role})`
  }
  return content.substring(0, maxLength) + '…'
}

function handleSelectBranch(leafMessageId: string) {
  emit('select', leafMessageId)
}

function handleDeleteBranch(branchId: string, depth: number) {
  emit('delete-branch', branchId, depth)
}

function handleRenameBranch(branchId: string, newTitle: string) {
  emit('rename-branch', branchId, newTitle)
}

/**
 * Extract branch title to color mapping from the built tree.
 * This allows other components (like MessageTimeline) to use consistent colors.
 */
const branchColorMap = computed((): Map<string, string> => {
  const colorMap = new Map<string, string>()

  function extractColors(branch: Branch) {
    // Only map branches with explicit titles (user-named branches)
    if (branch.hasExplicitTitle && branch.title) {
      const color = branch.colorIndex < 0
        ? 'accent'
        : BRANCH_COLORS[branch.colorIndex % BRANCH_COLORS.length]!
      colorMap.set(branch.title, color)
    }
    // Recurse into children
    for (const child of branch.children) {
      extractColors(child)
    }
  }

  for (const branch of branchTree.value) {
    extractColors(branch)
  }

  return colorMap
})

// Expose the color map for parent components to access
defineExpose({
  branchColorMap
})
</script>

<template>
  <div class="conversation-tree-container">
    <!-- Tree Content -->
    <div class="tree-content" data-testid="message-tree">
      <div v-if="branchTree.length === 0" class="empty-tree">
        No messages yet
      </div>

      <template v-else>
        <BranchNode
          v-for="branch in branchTree"
          :key="branch.id"
          :branch="branch"
          :depth="0"
          :branch-colors="BRANCH_COLORS"
          @select="handleSelectBranch"
          @delete-branch="handleDeleteBranch"
          @rename-branch="handleRenameBranch"
        />
      </template>
    </div>
  </div>
</template>

<style scoped>
.conversation-tree-container {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.tree-content {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.empty-tree {
  padding: 1rem;
  text-align: center;
  font-size: 0.8125rem;
  color: var(--text-muted);
}
</style>
