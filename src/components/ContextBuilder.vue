<script setup lang="ts">
/**
 * ContextBuilder - Context control panel
 *
 * Three tabs let users control which messages are included in the prompt context:
 * - Current Path: messages on the active path, with anchor + exclude toggles
 * - All Branches: every branch in the tree, grouped with collapsible accordions
 * - All Messages: flat chronological list with in/out-of-context filter
 *
 * Internally, path messages are excluded via excludedMessageIds and non-path
 * messages are included via pinnedMessageIds. The ContextResolverConfig shape
 * is unchanged.
 */

import { ref, computed, nextTick, watch, TransitionGroup } from 'vue'
import type { Message } from '@/db/types'
import { resolveContext, type ContextResolverConfig, type ResolvedContext } from '@/db'
import { getLeaves, getPathToRoot, getRoots, buildChildrenMap } from '@/db/treeUtils'
import { BRANCH_COLORS, MAIN_BRANCH_COLOR } from '@/utils/graphLayout'
import { useThemeStore } from '@/stores/themeStore'
import { useConversationStore } from '@/stores/conversationStore'

const themeStore = useThemeStore()
const store = useConversationStore()

const props = defineProps<{
  /** Current path from root to active message */
  timeline: Message[]
  /** All messages in the conversation */
  messageMap: Map<string, Message>
  /** Currently active message ID */
  activeMessageId: string | null
}>()

// UI state
const isExpanded = ref(false)
const activeTab = ref<'current-path' | 'all-branches' | 'all-messages'>('all-branches')
const allMessagesFilter = ref<'all' | 'in-context' | 'not-in-context'>('all')
const expandedBranches = ref<Set<string>>(new Set())
const expandedMessages = ref<Set<string>>(new Set())
const showWarnings = ref(false)

// Context-change flash tracking
const contextFlashIds = ref<Set<string>>(new Set())
const excludedCountShake = ref(false)
let prevResolvedIds: Set<string> = new Set()

// Current config as ContextResolverConfig — reads from store
const currentConfig = computed<ContextResolverConfig>(() => ({
  startFromMessageId: store.contextStartFromMessageId,
  excludedMessageIds: Array.from(store.excludedMessageIds),
  pinnedMessageIds: store.contextPinnedMessageIds,
}))

// Resolve context whenever config or timeline changes
const resolvedContext = computed<ResolvedContext | null>(() => {
  if (!props.activeMessageId) return null
  return resolveContext(props.activeMessageId, props.messageMap, currentConfig.value)
})

// Watch for context changes to trigger flash animations
watch(() => resolvedContext.value?.resolvedMessageIds, (newIds) => {
  const curr = new Set(newIds ?? [])
  const changed = new Set<string>()
  for (const id of curr) {
    if (!prevResolvedIds.has(id)) changed.add(id)
  }
  for (const id of prevResolvedIds) {
    if (!curr.has(id)) changed.add(id)
  }
  prevResolvedIds = curr
  if (changed.size === 0) return

  contextFlashIds.value = changed
  excludedCountShake.value = true
  setTimeout(() => { contextFlashIds.value = new Set() }, 500)
  setTimeout(() => { excludedCountShake.value = false }, 400)
}, { deep: true })

// Auto-cleanup stale pinned IDs (messages that were deleted from the conversation)
watch(() => resolvedContext.value?.stalePinnedIds, (staleIds) => {
  if (!staleIds || staleIds.length === 0) return
  const staleSet = new Set(staleIds)
  const cleaned = store.contextPinnedMessageIds.filter(id => !staleSet.has(id))
  if (cleaned.length !== store.contextPinnedMessageIds.length) {
    store.setContextState(store.excludedMessageIds, cleaned)
  }
}, { deep: true })

// Set of message IDs on the current path (O(1) lookup)
const pathMessageIdSet = computed<Set<string>>(() => {
  return new Set(props.timeline.map(m => m.id))
})

// Path messages with exclusion status
const pathWithStatus = computed(() => {
  const anchor = store.contextStartFromMessageId
  return props.timeline.map(msg => ({
    message: msg,
    isExcluded: store.excludedMessageIds.has(msg.id),
    isAnchor: msg.id === anchor,
    isBeforeAnchor: anchor
      ? props.timeline.findIndex(m => m.id === anchor) > props.timeline.findIndex(m => m.id === msg.id)
      : false,
  }))
})

// All branches: each leaf defines a unique root-to-leaf path
interface Branch {
  id: string
  label: string
  preview: string
  messages: Message[]          // Full root-to-leaf path (for display)
  uniqueMessages: Message[]    // Only branch-unique messages (for toggle operations)
  isCurrentPath: boolean
  color: string
}

const branches = computed<Branch[]>(() => {
  const leaves = getLeaves(props.messageMap)
  const allPaths = leaves.map(leaf => getPathToRoot(leaf.id, props.messageMap))

  if (allPaths.length === 0) return []

  // Build tree structure to mirror MessageTree's branch logic
  const roots = getRoots(props.messageMap)
  const childrenMap = buildChildrenMap(props.messageMap)

  // Walk the tree in the same DFS order as MessageTree's buildBranch to assign
  // consistent colors. Maps each branch's start message ID to its color.
  const branchColorMap = new Map<string, string>()
  let colorCounter = 0

  function walkBranch(startMsg: Message, depth: number) {
    const color = depth === 0
      ? MAIN_BRANCH_COLOR
      : BRANCH_COLORS[colorCounter++ % BRANCH_COLORS.length]!
    branchColorMap.set(startMsg.id, color)

    let current = startMsg
    const titledBranches: Message[] = []

    // Follow main path (same logic as MessageTree's buildBranch)
    while (true) {
      const children = childrenMap.get(current.id) ?? []
      if (children.length === 0) break
      if (children.length === 1) {
        if (children[0]!.branchTitle) break
        current = children[0]!
      } else {
        const untitled = children.filter(c => !c.branchTitle)
        const titled = children.filter(c => c.branchTitle)
        if (untitled.length === 1) {
          titledBranches.push(...titled)
          current = untitled[0]!
        } else {
          break
        }
      }
    }

    // Process titled branches along the path (same order as MessageTree)
    for (const titled of titledBranches) {
      walkBranch(titled, depth + 1)
    }

    // Process branch point children
    const bpChildren = childrenMap.get(current.id) ?? []
    const showChildren = bpChildren.length > 1 ||
      (bpChildren.length === 1 && bpChildren[0]?.branchTitle)
    if (showChildren) {
      for (const child of bpChildren) {
        walkBranch(child, depth + 1)
      }
    }
  }

  for (const root of roots) {
    walkBranch(root, 0)
  }

  // Identify the "main" path structurally (not based on navigation).
  // Mirror MessageTree: from the root, follow untitled children at each branch point.
  let mainLeafId: string | null = null
  if (roots.length > 0) {
    let current = roots[0]!
    while (true) {
      const children = childrenMap.get(current.id)
      if (!children || children.length === 0) {
        mainLeafId = current.id
        break
      }
      const untitled = children.filter(c => !c.branchTitle)
      current = untitled.length > 0 ? untitled[0]! : children[0]!
    }
  }
  const mainIdxRaw = mainLeafId
    ? allPaths.findIndex(path => path[path.length - 1]?.id === mainLeafId)
    : 0
  const mainIdx = mainIdxRaw >= 0 ? mainIdxRaw : 0
  const mainPath = allPaths[mainIdx]!

  // Set of message IDs on the main path, used to compute unique messages per branch
  const mainPathIds = new Set(mainPath.map(m => m.id))

  // Detect if the main path absorbed a titled branch (all children at a branch
  // point had branchTitle, so the first titled child became the "main" path).
  // When this happens, split the main path into a trunk ("Main conversation")
  // and the titled branch, so both appear in the listing.
  const mainTitledMsg = mainPath.find(m => m.branchTitle)
  const mainTitledIdx = mainTitledMsg ? mainPath.findIndex(m => m.id === mainTitledMsg.id) : -1
  const hasTrunk = mainTitledIdx > 0
  const trunkIdSet = hasTrunk ? new Set(mainPath.slice(0, mainTitledIdx).map(m => m.id)) : null

  const entries: Branch[] = allPaths.map((path, i) => {
    const isMain = i === mainIdx
    let label: string
    let divergeMsgId: string | undefined

    if (isMain) {
      // Use the first branchTitle found on the path. When all children at a
      // branch point are titled (no untitled continuation), the main path
      // follows the first titled child — show its title instead of hiding it
      // behind "Main conversation."
      const titledMsg = path.find(m => m.branchTitle)
      label = titledMsg?.branchTitle || 'Main conversation'
      divergeMsgId = titledMsg?.id || path[0]?.id
    } else {
      // Find where this path diverges from the main path
      let divergeIdx = path.length
      for (let idx = 0; idx < path.length && idx < mainPath.length; idx++) {
        if (path[idx]!.id !== mainPath[idx]!.id) {
          divergeIdx = idx
          break
        }
      }

      const divergeMsg = path[divergeIdx]
      divergeMsgId = divergeMsg?.id
      if (divergeMsg?.branchTitle) {
        label = divergeMsg.branchTitle
      } else if (divergeMsg) {
        const roleLabel = divergeMsg.role === 'user' ? 'User' : divergeMsg.role === 'assistant' ? 'Assistant' : 'System'
        label = `${roleLabel} branch`
      } else {
        label = `Branch ${i + 1}`
      }
    }

    // When we split off a trunk, the main path's unique messages start at the
    // titled divergence point (trunk messages belong to the trunk entry).
    const uniqueMessages = isMain
      ? (hasTrunk ? path.slice(mainTitledIdx) : path)
      : path.filter(m => !mainPathIds.has(m.id))

    const firstContentMsg = path.find(m => m.content.trim().length > 0)
    const preview = firstContentMsg ? truncateContent(firstContentMsg.content, 30) : ''
    const isCurrentPath = props.activeMessageId
      ? path.some(m => m.id === props.activeMessageId)
      : false

    // Use the color from the DFS walk (matching MessageTree's assignment)
    const color = divergeMsgId ? (branchColorMap.get(divergeMsgId) ?? BRANCH_COLORS[0]!) : MAIN_BRANCH_COLOR

    const leaf = path[path.length - 1]!
    return { id: leaf.id, label, preview, messages: path, uniqueMessages, isCurrentPath, color }
  })

  // Prepend "Main conversation" trunk when the main path was split
  if (hasTrunk && trunkIdSet) {
    const trunkMessages = mainPath.slice(0, mainTitledIdx)
    const trunkLeaf = trunkMessages[trunkMessages.length - 1]!
    const firstContent = trunkMessages.find(m => m.content.trim().length > 0)
    entries.unshift({
      id: `trunk-${trunkLeaf.id}`,
      label: 'Main conversation',
      preview: firstContent ? truncateContent(firstContent.content, 30) : '',
      messages: trunkMessages,
      uniqueMessages: trunkMessages,
      isCurrentPath: props.activeMessageId
        ? trunkMessages.some(m => m.id === props.activeMessageId)
        : false,
      color: MAIN_BRANCH_COLOR,
    })
  }

  return entries
})

// Map each message to the color of the branch it belongs to
const messageBranchColorMap = computed<Map<string, string>>(() => {
  const colorMap = new Map<string, string>()
  // Process current path branch first so its shared ancestors get accent color
  const currentBranch = branches.value.find(b => b.isCurrentPath)
  if (currentBranch) {
    for (const msg of currentBranch.messages) {
      colorMap.set(msg.id, currentBranch.color)
    }
  }
  // Then other branches — only assign to messages not already claimed
  for (const branch of branches.value) {
    if (branch.isCurrentPath) continue
    for (const msg of branch.messages) {
      if (!colorMap.has(msg.id)) {
        colorMap.set(msg.id, branch.color)
      }
    }
  }
  return colorMap
})

// All messages flat, annotated with context status
interface AnnotatedMessage {
  message: Message
  isInContext: boolean
  isOnCurrentPath: boolean
  branchColor: string
}

const allMessagesFlat = computed<AnnotatedMessage[]>(() => {
  const resolvedIds = new Set(resolvedContext.value?.resolvedMessageIds ?? [])
  const colorMap = messageBranchColorMap.value
  const all = Array.from(props.messageMap.values())
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  return all.map(msg => ({
    message: msg,
    isInContext: resolvedIds.has(msg.id),
    isOnCurrentPath: pathMessageIdSet.value.has(msg.id),
    branchColor: colorMap.get(msg.id) ?? BRANCH_COLORS[0]!,
  }))
})

// Filtered messages for All Messages tab
const filteredAllMessages = computed<AnnotatedMessage[]>(() => {
  if (allMessagesFilter.value === 'all') return allMessagesFlat.value
  if (allMessagesFilter.value === 'in-context') {
    return allMessagesFlat.value.filter(m => m.isInContext)
  }
  return allMessagesFlat.value.filter(m => !m.isInContext)
})

// Summary for collapsed state
const contextSummary = computed(() => {
  const resolved = resolvedContext.value
  if (!resolved) return 'No context'

  const total = resolved.resolvedMessages.length
  const pathCount = resolved.pathMessages.length
  const extraCount = resolved.pinnedMessages.length
  const warningCount = resolved.warnings.length

  let summary = `${total} messages`
  if (extraCount > 0) summary += ` (${pathCount} path + ${extraCount} extra)`
  if (warningCount > 0) summary += ` -- ${warningCount} warning${warningCount > 1 ? 's' : ''}`

  return summary
})

// Actions — all state changes go through the store
function setAnchor(messageId: string) {
  store.setContextAnchor(store.contextStartFromMessageId === messageId ? null : messageId)
}

function clearAnchor() {
  store.setContextAnchor(null)
}

function toggleExclude(messageId: string) {
  store.toggleMessageExclusion(messageId)
}

/**
 * Universal toggle: updates both excludedMessageIds and pinnedMessageIds so
 * that the conversation tree and timeline always reflect the change, even for
 * messages on branches that are not currently active.
 */
function toggleMessageInContext(messageId: string) {
  const isOnPath = pathMessageIdSet.value.has(messageId)
  const inContext = isMessageInContext(messageId)
  const newExcluded = new Set(store.excludedMessageIds)
  const newPinned = [...store.contextPinnedMessageIds]

  if (inContext) {
    // Toggle OUT of context
    newExcluded.add(messageId)
    if (!isOnPath) {
      const idx = newPinned.indexOf(messageId)
      if (idx >= 0) newPinned.splice(idx, 1)
    }
  } else {
    // Toggle INTO context
    newExcluded.delete(messageId)
    if (!isOnPath && !newPinned.includes(messageId)) {
      newPinned.push(messageId)
    }
  }

  store.setContextState(newExcluded, newPinned)
}

function isMessageInContext(messageId: string): boolean {
  return resolvedContext.value?.resolvedMessageIds.includes(messageId) ?? false
}

function branchExcludedCount(branch: Branch): number {
  return branch.uniqueMessages.filter(m => !isMessageInContext(m.id)).length
}

function isBranchAnyInContext(branch: Branch): boolean {
  return branch.uniqueMessages.some(m => isMessageInContext(m.id))
}

function toggleBranchInContext(branch: Branch) {
  const anyIn = isBranchAnyInContext(branch)
  const newExcluded = new Set(store.excludedMessageIds)
  const newPinned = [...store.contextPinnedMessageIds]

  for (const msg of branch.uniqueMessages) {
    const isOnPath = pathMessageIdSet.value.has(msg.id)
    const msgIn = isMessageInContext(msg.id)

    if (anyIn && msgIn) {
      // Exclude this message
      newExcluded.add(msg.id)
      if (!isOnPath) {
        const idx = newPinned.indexOf(msg.id)
        if (idx >= 0) newPinned.splice(idx, 1)
      }
    } else if (!anyIn && !msgIn) {
      // Include this message
      newExcluded.delete(msg.id)
      if (!isOnPath && !newPinned.includes(msg.id)) {
        newPinned.push(msg.id)
      }
    }
  }

  store.setContextState(newExcluded, newPinned)
}

function toggleMessageExpand(messageId: string) {
  const newSet = new Set(expandedMessages.value)
  if (newSet.has(messageId)) {
    newSet.delete(messageId)
  } else {
    newSet.add(messageId)
  }
  expandedMessages.value = newSet
}

function toggleBranchCollapse(branchId: string) {
  const newSet = new Set(expandedBranches.value)
  if (newSet.has(branchId)) {
    newSet.delete(branchId)
  } else {
    newSet.add(branchId)
  }
  expandedBranches.value = newSet
}

function clearAllConfig() {
  store.clearAllContextConfig()
}

// ---- Preset UI State ----
const showPresetMenu = ref(false)
const isCreatingPreset = ref(false)
const newPresetName = ref('')
const renamingPresetId = ref<string | null>(null)
const renameValue = ref('')
const presetNameInputRef = ref<HTMLInputElement | null>(null)

// ---- Preset Actions ----
function openSavePresetDialog() {
  isCreatingPreset.value = true
  newPresetName.value = ''
  showPresetMenu.value = false
  nextTick(() => presetNameInputRef.value?.focus())
}

async function confirmSavePreset() {
  const trimmed = newPresetName.value.trim()
  if (!trimmed) return
  newPresetName.value = ''
  isCreatingPreset.value = false
  await store.savePreset(trimmed)
}

function cancelSavePreset() {
  isCreatingPreset.value = false
  newPresetName.value = ''
}

function handleLoadPreset(presetId: string) {
  store.loadPreset(presetId)
  showPresetMenu.value = false
}

function startRenamePreset(presetId: string, currentName: string) {
  renamingPresetId.value = presetId
  renameValue.value = currentName
}

async function confirmRenamePreset(presetId: string) {
  const trimmed = renameValue.value.trim()
  renamingPresetId.value = null
  if (trimmed) {
    await store.renamePreset(presetId, trimmed)
  }
}

async function handleDeletePreset(presetId: string) {
  await store.deletePreset(presetId)
}

async function handleUpdateActivePreset() {
  if (store.activePresetId) {
    await store.updatePresetFromCurrent(store.activePresetId)
  }
}

function getRoleLabel(role: Message['role']): string {
  switch (role) {
    case 'system': return 'S'
    case 'user': return 'U'
    case 'assistant': return 'A'
    default: return '?'
  }
}

function getRoleClasses(role: Message['role']): string {
  switch (role) {
    case 'system': return 'role-system'
    case 'user': return 'role-user'
    case 'assistant': return 'role-assistant'
    default: return 'role-system'
  }
}

function truncateContent(content: string, maxLen: number = 50): string {
  if (content.length <= maxLen) return content
  return content.slice(0, maxLen) + '...'
}

function getWarningLabel(type: string): string {
  switch (type) {
    case 'ANCHOR_NOT_ON_PATH': return 'Anchor not on path'
    case 'ASSISTANT_WITHOUT_USER': return 'Missing user message'
    default: return 'Warning'
  }
}

/** For a given warning, return the ID of the excluded message the user can act on. */
function getExcludedMessageId(warning: { type: string; relatedMessageId?: string }): string | null {
  if (!warning.relatedMessageId) return null
  switch (warning.type) {
    case 'ASSISTANT_WITHOUT_USER': {
      // relatedMessageId is the assistant — the excluded message is its parent (user msg)
      const assistantMsg = props.messageMap.get(warning.relatedMessageId)
      return assistantMsg?.parentId ?? null
    }
    default:
      return null
  }
}
</script>

<template>
  <div class="context-builder" :class="{ 'day-mode': themeStore.isDayMode }" data-testid="context-builder">
    <!-- Collapsed Header -->
    <button
      class="header-toggle"
      data-testid="context-builder-toggle"
      @click="isExpanded = !isExpanded"
    >
      <div class="header-left">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="chevron-icon"
          :class="{ 'chevron-icon--open': isExpanded }"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path fill-rule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clip-rule="evenodd" />
        </svg>
        <span class="header-title">Context</span>
        <span class="header-summary">{{ contextSummary }}</span>
      </div>

      <span
        v-if="resolvedContext?.warnings.length"
        class="warning-badge"
        @click.stop="isExpanded = true; showWarnings = !showWarnings"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="12" height="12">
          <path fill-rule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.168 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd" />
        </svg>
        {{ resolvedContext.warnings.length }}
      </span>
    </button>

    <!-- Expanded Panel -->
    <div v-if="isExpanded" class="panel" data-testid="context-builder-panel">
      <!-- Tabs -->
      <div class="tabs">
        <button
          v-for="tab in (['all-branches', 'current-path', 'all-messages'] as const)"
          :key="tab"
          class="tab-btn"
          :class="{ 'tab-btn--active': activeTab === tab }"
          :data-testid="`context-tab-${tab}`"
          @click="activeTab = tab"
        >
          {{ tab === 'current-path' ? 'Current Path'
           : tab === 'all-branches' ? 'All Branches'
           : 'All Messages' }}
        </button>
      </div>

      <!-- Warnings Panel -->
      <Transition name="warnings-panel">
        <div v-if="showWarnings && resolvedContext?.warnings.length" class="warnings-panel" data-testid="context-warnings">
          <div class="warnings-header">
            <span class="warnings-title">Warnings ({{ resolvedContext.warnings.length }})</span>
            <button class="warnings-close-btn" @click="showWarnings = false">&times;</button>
          </div>
          <div class="warnings-list">
            <TransitionGroup name="warning-item">
              <div
                v-for="(warning, idx) in resolvedContext.warnings"
                :key="warning.type + '-' + (warning.relatedMessageId ?? idx)"
                class="warning-item"
              >
                <div class="warning-item-top">
                  <span class="warning-type-badge">{{ getWarningLabel(warning.type) }}</span>
                </div>
                <p class="warning-message">{{ warning.message }}</p>

                <!-- Related message (the one flagged by the warning) -->
                <div
                  v-if="warning.relatedMessageId && messageMap.get(warning.relatedMessageId)"
                  class="warning-related-msg"
                  :class="{
                    'warning-related-msg--expanded': expandedMessages.has(warning.relatedMessageId),
                  }"
                >
                  <div class="message-row" @click="toggleMessageExpand(warning.relatedMessageId!)">
                    <span
                      class="role-badge"
                      :class="getRoleClasses(messageMap.get(warning.relatedMessageId)!.role)"
                    >
                      {{ getRoleLabel(messageMap.get(warning.relatedMessageId)!.role) }}
                    </span>
                    <span class="message-text">
                      {{ expandedMessages.has(warning.relatedMessageId)
                        ? messageMap.get(warning.relatedMessageId)!.content
                        : truncateContent(messageMap.get(warning.relatedMessageId)!.content, 50) }}
                    </span>
                    <button
                      class="toggle-btn"
                      :class="isMessageInContext(warning.relatedMessageId) ? 'toggle-btn--on' : 'toggle-btn--off'"
                      @click.stop="toggleMessageInContext(warning.relatedMessageId!)"
                    >
                      {{ isMessageInContext(warning.relatedMessageId) ? 'In' : 'Out' }}
                    </button>
                  </div>
                </div>

                <!-- Excluded message (the one the user should add back) -->
                <div
                  v-if="getExcludedMessageId(warning) && getExcludedMessageId(warning) !== warning.relatedMessageId && messageMap.get(getExcludedMessageId(warning)!)"
                  class="warning-excluded-msg"
                  :class="{
                    'warning-related-msg--expanded': expandedMessages.has(getExcludedMessageId(warning)!),
                  }"
                >
                  <span class="warning-excluded-label">Excluded:</span>
                  <div class="message-row" @click="toggleMessageExpand(getExcludedMessageId(warning)!)">
                    <span
                      class="role-badge"
                      :class="getRoleClasses(messageMap.get(getExcludedMessageId(warning)!)!.role)"
                    >
                      {{ getRoleLabel(messageMap.get(getExcludedMessageId(warning)!)!.role) }}
                    </span>
                    <span class="message-text">
                      {{ expandedMessages.has(getExcludedMessageId(warning)!)
                        ? messageMap.get(getExcludedMessageId(warning)!)!.content
                        : truncateContent(messageMap.get(getExcludedMessageId(warning)!)!.content, 50) }}
                    </span>
                    <button
                      class="toggle-btn"
                      :class="isMessageInContext(getExcludedMessageId(warning)!) ? 'toggle-btn--on' : 'toggle-btn--off'"
                      @click.stop="toggleMessageInContext(getExcludedMessageId(warning)!)"
                    >
                      {{ isMessageInContext(getExcludedMessageId(warning)!) ? 'In' : 'Out' }}
                    </button>
                  </div>
                </div>
              </div>
            </TransitionGroup>
          </div>
        </div>
      </Transition>

      <!-- ============================================================ -->
      <!-- Tab 1: Current Path -->
      <!-- ============================================================ -->
      <div v-if="activeTab === 'current-path'" class="tab-content" data-testid="context-current-path">
        <p class="tab-description">
          Messages on the path from root to the active message. Toggle to include or exclude from context.
        </p>

        <!-- Anchor banner -->
        <div v-if="store.contextStartFromMessageId" class="anchor-banner">
          <span class="anchor-label">Start from:</span>
          <span class="anchor-text">{{ truncateContent(messageMap.get(store.contextStartFromMessageId)?.content ?? '', 30) }}</span>
          <button class="anchor-clear-btn" data-testid="clear-anchor-btn" @click="clearAnchor">
            Clear
          </button>
        </div>

        <TransitionGroup name="msg-toggle" tag="div" class="path-list">
          <div
            v-for="item in pathWithStatus"
            :key="item.message.id"
            class="path-item"
            :class="{
              'path-item--before-anchor': item.isBeforeAnchor,
              'path-item--excluded': item.isExcluded,
              'path-item--expanded': expandedMessages.has(item.message.id),
              'cb-flash': contextFlashIds.has(item.message.id),
            }"
            :data-testid="`path-item-${item.message.id}`"
          >
            <div class="message-row" @click="toggleMessageExpand(item.message.id)">
              <span class="role-badge" :class="getRoleClasses(item.message.role)">
                {{ getRoleLabel(item.message.role) }}
              </span>
              <span class="message-text" :class="{ 'text-excluded': item.isExcluded }">
                {{ expandedMessages.has(item.message.id) ? item.message.content : truncateContent(item.message.content, 40) }}
              </span>

              <div class="path-actions" @click.stop>
                <button
                  class="path-action-btn"
                  :class="{ 'path-action-btn--active': item.isAnchor }"
                  :title="item.isAnchor ? 'Clear anchor' : 'Set as context start'"
                  :data-testid="`anchor-btn-${item.message.id}`"
                  @click="setAnchor(item.message.id)"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" width="12" height="12">
                    <path d="M8 1a2 2 0 0 0-2 2v4H4a1 1 0 0 0 0 2h2v5a1 1 0 1 0 2 0V9h2a1 1 0 1 0 0-2H10V3a2 2 0 0 0-2-2z"/>
                  </svg>
                </button>
                <button
                  class="toggle-btn"
                  :class="item.isExcluded ? 'toggle-btn--off' : 'toggle-btn--on'"
                  :title="item.isExcluded ? 'Include in context' : 'Exclude from context'"
                  :data-testid="`toggle-btn-${item.message.id}`"
                  @click="toggleExclude(item.message.id)"
                >
                  {{ item.isExcluded ? 'Out' : 'In' }}
                </button>
              </div>
            </div>
          </div>
        </TransitionGroup>
      </div>

      <!-- ============================================================ -->
      <!-- Tab 2: All Branches -->
      <!-- ============================================================ -->
      <div v-if="activeTab === 'all-branches'" class="tab-content" data-testid="context-all-branches">
        <p class="tab-description">
          All branches in the conversation. Toggle messages to include or exclude from context.
        </p>

        <div v-if="branches.length === 0" class="empty-state">
          No branches in conversation.
        </div>

        <div
          v-for="branch in branches"
          :key="branch.id"
          class="branch-group"
          :class="{ 'branch-group--in-context': isBranchAnyInContext(branch) }"
          :data-testid="`branch-group-${branch.id}`"
        >
          <!-- Branch header -->
          <button
            class="branch-header"
            :style="{ borderLeftColor: branch.color }"
            :data-testid="`branch-header-${branch.id}`"
            @click="toggleBranchCollapse(branch.id)"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="chevron-icon"
              :class="{ 'chevron-icon--open': expandedBranches.has(branch.id) }"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path fill-rule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clip-rule="evenodd" />
            </svg>
            <div class="branch-title-group">
              <span class="branch-label">{{ branch.label }}</span>
              <span v-if="branch.preview" class="branch-preview">{{ branch.preview }}</span>
            </div>
            <span class="branch-count">{{ branch.messages.length }}</span>
            <span v-if="branch.isCurrentPath" class="current-path-badge">Current</span>
            <span
              v-if="branchExcludedCount(branch) > 0 && isBranchAnyInContext(branch)"
              class="branch-excluded-count"
              :class="{ 'cb-shake': excludedCountShake }"
            >
              {{ branchExcludedCount(branch) }}/{{ branch.uniqueMessages.length }} out
            </span>
            <span
              role="button"
              tabindex="0"
              class="toggle-btn branch-toggle-btn"
              :class="isBranchAnyInContext(branch) ? 'toggle-btn--on' : 'toggle-btn--off'"
              :data-testid="`branch-toggle-${branch.id}`"
              @click.stop="toggleBranchInContext(branch)"
              @keydown.enter.stop="toggleBranchInContext(branch)"
              @keydown.space.stop="toggleBranchInContext(branch)"
            >
              {{ isBranchAnyInContext(branch) ? 'In' : 'Out' }}
            </span>
          </button>

          <!-- Branch messages -->
          <TransitionGroup v-if="expandedBranches.has(branch.id)" name="msg-toggle" tag="div" class="branch-messages">
            <div
              v-for="msg in branch.messages"
              :key="msg.id"
              class="branch-message-item"
              :class="{
                'branch-message-item--in-context': isMessageInContext(msg.id),
                'branch-message-item--not-in-context': !isMessageInContext(msg.id),
                'branch-message-item--on-path': pathMessageIdSet.has(msg.id),
                'branch-message-item--expanded': expandedMessages.has(msg.id),
                'cb-flash': contextFlashIds.has(msg.id),
              }"
              :data-testid="`branch-msg-${msg.id}`"
            >
              <div class="message-row" @click="toggleMessageExpand(msg.id)">
                <span class="role-badge" :class="getRoleClasses(msg.role)">
                  {{ getRoleLabel(msg.role) }}
                </span>
                <span class="message-text" :class="{ 'text-dimmed': !isMessageInContext(msg.id) }">
                  {{ expandedMessages.has(msg.id) ? msg.content : truncateContent(msg.content, 35) }}
                </span>
                <button
                  class="toggle-btn"
                  :class="isMessageInContext(msg.id) ? 'toggle-btn--on' : 'toggle-btn--off'"
                  :data-testid="`toggle-btn-${msg.id}`"
                  @click.stop="toggleMessageInContext(msg.id)"
                >
                  {{ isMessageInContext(msg.id) ? 'In' : 'Out' }}
                </button>
              </div>
            </div>
          </TransitionGroup>
        </div>
      </div>

      <!-- ============================================================ -->
      <!-- Tab 3: All Messages -->
      <!-- ============================================================ -->
      <div v-if="activeTab === 'all-messages'" class="tab-content" data-testid="context-all-messages">
        <p class="tab-description">
          All messages in the conversation. Messages not in context are greyed out.
        </p>

        <!-- Filter bar -->
        <div class="filter-bar" data-testid="all-messages-filter">
          <button
            v-for="filter in (['all', 'in-context', 'not-in-context'] as const)"
            :key="filter"
            class="filter-btn"
            :class="{ 'filter-btn--active': allMessagesFilter === filter }"
            :data-testid="`filter-btn-${filter}`"
            @click="allMessagesFilter = filter"
          >
            {{ filter === 'all' ? 'All'
             : filter === 'in-context' ? 'In context'
             : 'Not in context' }}
          </button>
        </div>

        <!-- Message count -->
        <div class="message-count">
          {{ filteredAllMessages.length }} of {{ allMessagesFlat.length }} messages
        </div>

        <div v-if="filteredAllMessages.length === 0" class="empty-state">
          No messages match this filter.
        </div>

        <TransitionGroup name="msg-toggle" tag="div" class="all-messages-list">
          <div
            v-for="item in filteredAllMessages"
            :key="item.message.id"
            class="all-msg-item"
            :class="{
              'all-msg-item--in-context': item.isInContext,
              'all-msg-item--not-in-context': !item.isInContext,
              'all-msg-item--expanded': expandedMessages.has(item.message.id),
              'cb-flash': contextFlashIds.has(item.message.id),
            }"
            :style="{ borderLeftColor: item.branchColor }"
            :data-testid="`all-msg-${item.message.id}`"
          >
            <div class="message-row" @click="toggleMessageExpand(item.message.id)">
              <span class="role-badge" :class="getRoleClasses(item.message.role)">
                {{ getRoleLabel(item.message.role) }}
              </span>
              <span class="message-text" :class="{ 'text-dimmed': !item.isInContext }">
                {{ expandedMessages.has(item.message.id) ? item.message.content : truncateContent(item.message.content, 40) }}
              </span>
              <span v-if="item.isOnCurrentPath" class="path-indicator" title="On current path">P</span>
              <button
                class="toggle-btn"
                :class="item.isInContext ? 'toggle-btn--on' : 'toggle-btn--off'"
                :data-testid="`toggle-btn-${item.message.id}`"
                @click.stop="toggleMessageInContext(item.message.id)"
              >
                {{ item.isInContext ? 'In' : 'Out' }}
              </button>
            </div>
          </div>
        </TransitionGroup>
      </div>

      <!-- Preset Bar -->
      <div class="preset-bar">
        <!-- Active preset indicator -->
        <div v-if="store.activePresetId && store.activePresetName" class="active-preset-indicator">
          <span class="active-preset-label">Preset:</span>
          <span class="active-preset-name">{{ store.activePresetName }}</span>
          <span v-if="store.isActivePresetModified" class="preset-modified-badge">modified</span>
          <button
            v-if="store.isActivePresetModified"
            class="preset-btn preset-btn--small"
            @click="handleUpdateActivePreset"
          >
            Save
          </button>
          <button
            class="preset-deactivate-btn"
            title="Deactivate preset"
            @click="store.deactivatePreset()"
          >
            &times;
          </button>
        </div>

        <!-- Preset controls row -->
        <div class="preset-controls">
          <button class="preset-btn" @click="openSavePresetDialog">
            + Save
          </button>
          <div class="preset-load-wrapper">
            <button
              class="preset-btn"
              :disabled="store.contextPresets.length === 0"
              @click="showPresetMenu = !showPresetMenu"
            >
              Load{{ store.contextPresets.length > 0 ? ` (${store.contextPresets.length})` : '' }}
            </button>

            <!-- Dropdown backdrop (click-outside) -->
            <div v-if="showPresetMenu" class="preset-dropdown-backdrop" @click="showPresetMenu = false" />

            <!-- Dropdown -->
            <Transition name="preset-dropdown">
              <div v-if="showPresetMenu" class="preset-dropdown">
                <div
                  v-for="preset in store.contextPresets"
                  :key="preset.id"
                  class="preset-item"
                  :class="{ 'preset-item--active': preset.id === store.activePresetId }"
                >
                  <!-- Rename mode -->
                  <template v-if="renamingPresetId === preset.id">
                    <input
                      v-model="renameValue"
                      class="preset-name-input"
                      @keydown.enter="confirmRenamePreset(preset.id)"
                      @keydown.escape="renamingPresetId = null"
                      @vue:mounted="($event: any) => $event.el?.focus()"
                    />
                    <button class="preset-icon-btn" title="Confirm" @click="confirmRenamePreset(preset.id)">&#10003;</button>
                  </template>

                  <!-- Normal mode -->
                  <template v-else>
                    <button class="preset-item-name" @click="handleLoadPreset(preset.id)">
                      {{ preset.name }}
                    </button>
                    <button class="preset-icon-btn" title="Rename" @click.stop="startRenamePreset(preset.id, preset.name)">&#9998;</button>
                    <button class="preset-icon-btn preset-icon-btn--danger" title="Delete" @click.stop="handleDeletePreset(preset.id)">&times;</button>
                  </template>
                </div>
                <div v-if="store.contextPresets.length === 0" class="preset-dropdown-empty">
                  No saved presets
                </div>
              </div>
            </Transition>
          </div>
        </div>

        <!-- Inline save form -->
        <Transition name="preset-save-form">
          <div v-if="isCreatingPreset" class="preset-save-form">
            <input
              ref="presetNameInputRef"
              v-model="newPresetName"
              class="preset-name-input"
              placeholder="Preset name..."
              @keydown.enter="confirmSavePreset"
              @keydown.escape="cancelSavePreset"
            />
            <button class="preset-btn preset-btn--small" :disabled="!newPresetName.trim()" @click="confirmSavePreset">
              Save
            </button>
            <button class="preset-btn preset-btn--small preset-btn--ghost" @click="cancelSavePreset">
              Cancel
            </button>
          </div>
        </Transition>
      </div>

      <!-- Footer -->
      <div class="panel-footer">
        <button
          class="reset-btn"
          data-testid="clear-config-btn"
          @click="clearAllConfig"
        >
          Reset context to default
        </button>
        <span class="footer-hint">
          Config affects next message
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.context-builder {
  position: relative;
  z-index: 10;
  border-top: 1px solid var(--glass-border);
  background: var(--bg-primary);
}

.context-builder.day-mode {
  background: var(--bg-primary);
}

/* Header */
.header-toggle {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 1rem;
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
  transition: background var(--transition-fast);
}

.header-toggle:hover {
  background: rgba(var(--accent-rgb), 0.05);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.chevron-icon {
  width: 1rem;
  height: 1rem;
  color: var(--text-primary);
  transition: transform var(--transition-fast);
  flex-shrink: 0;
}

.chevron-icon--open {
  transform: rotate(90deg);
}

.header-title {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-primary);
}

.header-summary {
  font-size: 0.75rem;
  color: var(--text-primary);
}

.warning-badge {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.1875rem 0.5rem;
  font-size: 0.75rem;
  font-weight: 600;
  background: rgba(245, 158, 11, 0.2);
  color: #f59e0b;
  border: 1px solid rgba(245, 158, 11, 0.35);
  border-radius: var(--radius-pill);
  cursor: pointer;
  animation: warning-pulse 2s ease-in-out infinite;
}

.warning-badge:hover {
  background: rgba(245, 158, 11, 0.3);
}

@keyframes warning-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}

/* Panel */
.panel {
  position: absolute;
  bottom: 100%;
  left: 0;
  right: 0;
  max-height: 60vh;
  overflow-y: auto;
  border-top: 1px solid var(--border-subtle);
  border-bottom: 1px solid var(--glass-border);
  padding: 1rem;
  background: var(--bg-primary);
}

.context-builder.day-mode .panel {
  background: var(--bg-primary);
}

/* Warnings Panel */
.warnings-panel {
  margin-bottom: 0.75rem;
  background: rgba(245, 158, 11, 0.15);
  border: 1px solid rgba(245, 158, 11, 0.35);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.warnings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.375rem 0.625rem;
  background: rgba(245, 158, 11, 0.18);
}

.warnings-title {
  font-size: 0.75rem;
  font-weight: 600;
  color: #f59e0b;
}

.warnings-close-btn {
  background: none;
  border: none;
  color: #f59e0b;
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
  padding: 0 0.25rem;
  opacity: 0.7;
}

.warnings-close-btn:hover {
  opacity: 1;
}

.warnings-list {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  padding: 0.5rem 0.625rem;
  max-height: 10rem;
  overflow-y: auto;
}

.warning-item {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.375rem 0.5rem;
  background: rgba(245, 158, 11, 0.06);
  border-radius: var(--radius-md);
  border-left: 2px solid rgba(245, 158, 11, 0.5);
}

.warning-item-top {
  display: flex;
  align-items: center;
  gap: 0.375rem;
}

.warning-type-badge {
  font-size: 0.625rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  color: #f59e0b;
  padding: 0.0625rem 0.375rem;
  background: rgba(245, 158, 11, 0.15);
  border-radius: var(--radius-sm);
}

.warning-message {
  font-size: 0.75rem;
  color: var(--text-primary);
  opacity: 0.8;
  margin: 0;
  line-height: 1.35;
}

.warning-related-msg {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.25rem 0.375rem;
  margin-top: 0.125rem;
  background: rgba(0, 0, 0, 0.15);
  border-radius: var(--radius-sm);
}

.context-builder.day-mode .warnings-panel {
  background: rgba(255, 255, 255, 0.85);
  border-color: rgba(245, 158, 11, 0.3);
}

.context-builder.day-mode .warnings-header {
  background: rgba(245, 158, 11, 0.1);
}

.context-builder.day-mode .warning-item {
  background: rgba(255, 255, 255, 0.6);
}

.context-builder.day-mode .warnings-title,
.context-builder.day-mode .warnings-close-btn,
.context-builder.day-mode .warning-type-badge,
.context-builder.day-mode .warning-excluded-label {
  color: var(--text-primary);
}

.context-builder.day-mode .warning-related-msg {
  background: rgba(0, 0, 0, 0.05);
}

.warning-excluded-msg {
  display: flex;
  flex-direction: column;
  gap: 0.1875rem;
  padding: 0.25rem 0.375rem;
  margin-top: 0.125rem;
  background: rgba(245, 158, 11, 0.1);
  border: 1px dashed rgba(245, 158, 11, 0.3);
  border-radius: var(--radius-sm);
}

.warning-excluded-label {
  font-size: 0.625rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  color: #f59e0b;
}

.context-builder.day-mode .warning-excluded-msg {
  background: rgba(245, 158, 11, 0.08);
}

/* Tabs */
.tabs {
  display: flex;
  gap: 0.25rem;
  padding: 0.25rem;
  margin-bottom: 1rem;
  background: var(--overlay-dark);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
}

.context-builder.day-mode .tabs {
  background: rgba(255, 255, 255, 0.2);
}

.tab-btn {
  flex: 1;
  padding: 0.375rem 0.5rem;
  font-size: 0.75rem;
  font-weight: 500;
  font-family: var(--font-sans);
  background: transparent;
  border: none;
  border-radius: var(--radius-md);
  color: var(--text-primary);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.tab-btn:hover {
  color: var(--text-primary);
}

.tab-btn--active {
  background: var(--glass-bg-solid);
  color: var(--text-primary);
}

/* Tab Content */
.tab-content {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-height: 16rem;
  overflow-y: auto;
  padding: 0.75rem;
  background: var(--overlay-dark);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  color: #fff;
}

.context-builder.day-mode .tab-content {
  background: rgba(255, 255, 255, 0.2);
  color: #000;
}

.tab-description {
  font-size: 0.6875rem;
  color: var(--text-primary);
  margin-bottom: 0.25rem;
}

/* Message Row (clickable wrapper for expand/collapse) */
.message-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  cursor: pointer;
  min-height: 1.5rem;
}

/* Message Text */
.message-text {
  flex: 1;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.8125rem;
  min-width: 0;
}

/* Expanded message: wrap text instead of truncating */
.path-item--expanded .message-text,
.branch-message-item--expanded .message-text,
.all-msg-item--expanded .message-text {
  white-space: pre-wrap;
  word-break: break-word;
  overflow: visible;
}

.text-excluded {
  text-decoration: line-through;
  opacity: 0.5;
}

.text-dimmed {
  opacity: 0.4;
}

/* Role Badges */
.role-badge {
  width: 1.25rem;
  height: 1.25rem;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.625rem;
  font-weight: 600;
  border-radius: var(--radius-sm);
  flex-shrink: 0;
}

.role-system {
  background: var(--border-muted);
  color: var(--text-primary);
}

.role-user {
  background: rgba(var(--branch-blue-rgb), 0.2);
  color: var(--branch-blue);
}

.role-assistant {
  background: rgba(var(--accent-rgb), 0.2);
  color: var(--accent);
}

/* Toggle Button (universal include/exclude) */
.toggle-btn {
  padding: 0.0625rem 0.375rem;
  font-size: 0.625rem;
  font-weight: 600;
  font-family: var(--font-sans);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all var(--transition-fast);
  text-transform: uppercase;
  letter-spacing: 0.02em;
  flex-shrink: 0;
}

.toggle-btn--on {
  background: rgba(var(--accent-rgb), 0.15);
  color: var(--accent);
  border-color: rgba(var(--accent-rgb), 0.3);
}

.toggle-btn--off {
  background: transparent;
  color: var(--text-muted, var(--text-primary));
  border-color: var(--border-subtle);
  opacity: 0.6;
}

.toggle-btn--off:hover {
  background: rgba(var(--accent-rgb), 0.05);
  color: var(--text-primary);
  opacity: 1;
}

.branch-excluded-count {
  margin-left: auto;
  font-size: 0.6rem;
  color: var(--text-muted);
  white-space: nowrap;
}

.branch-toggle-btn {
  margin-left: 0.25rem;
}

.branch-excluded-count + .branch-toggle-btn {
  margin-left: 0.25rem;
}

.branch-excluded-count:first-of-type {
  margin-left: auto;
}

/* Anchor Banner */
.anchor-banner {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0.75rem;
  background: rgba(var(--branch-blue-rgb), 0.1);
  border-radius: var(--radius-md);
}

.anchor-label {
  color: var(--branch-blue);
  font-size: 0.75rem;
  font-weight: 500;
  flex-shrink: 0;
}

.anchor-text {
  flex: 1;
  font-size: 0.75rem;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.anchor-clear-btn {
  font-size: 0.6875rem;
  color: var(--branch-blue);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: opacity var(--transition-fast);
}

.anchor-clear-btn:hover {
  opacity: 0.8;
}

/* Path List */
.path-list {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  flex-shrink: 0;
}

.path-item {
  padding: 0.25rem 0.5rem;
  font-size: 0.8125rem;
  background: rgba(var(--accent-rgb), 0.05);
  border-radius: var(--radius-sm);
  transition: all var(--transition-fast);
}

.path-item--before-anchor {
  opacity: 0.4;
}

.path-item--excluded {
  background: rgba(var(--error-rgb, 239, 68, 68), 0.08);
}

.path-actions {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  flex-shrink: 0;
}

.path-action-btn {
  padding: 0.25rem;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  cursor: pointer;
  transition: all var(--transition-fast);
  opacity: 0.4;
}

.path-action-btn:hover {
  background: var(--border-muted);
  opacity: 1;
}

.path-action-btn--active {
  color: var(--branch-blue);
  opacity: 1;
}

/* Branch Group (All Branches tab) */
.branch-group {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  overflow: hidden;
  flex-shrink: 0;
  transition: border-color var(--transition-normal), box-shadow var(--transition-normal);
}

.branch-group--in-context {
  border-color: rgba(var(--accent-rgb), 0.35);
  box-shadow: inset 0 0 0 1px rgba(var(--accent-rgb), 0.1);
}

.branch-group + .branch-group {
  margin-top: 0.375rem;
}

.branch-header {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0.5rem;
  background: rgba(var(--accent-rgb), 0.03);
  border: none;
  border-left: 3px solid transparent;
  cursor: pointer;
  text-align: left;
  font-family: var(--font-sans);
  font-size: 0.75rem;
  color: var(--text-primary);
  transition: background var(--transition-fast);
}

.branch-header:hover {
  background: rgba(var(--accent-rgb), 0.06);
}

.branch-title-group {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.0625rem;
  overflow: hidden;
  min-width: 0;
}

.branch-label {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.branch-preview {
  font-size: 0.6875rem;
  font-weight: 400;
  color: var(--text-primary);
  opacity: 0.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.branch-count {
  font-size: 0.625rem;
  color: var(--text-muted, var(--text-primary));
  flex-shrink: 0;
  opacity: 0.6;
}

.current-path-badge {
  padding: 0.0625rem 0.375rem;
  font-size: 0.5625rem;
  font-weight: 600;
  background: rgba(var(--accent-rgb), 0.2);
  color: var(--accent);
  border-radius: var(--radius-pill);
  flex-shrink: 0;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.branch-messages {
  display: flex;
  flex-direction: column;
  gap: 0.0625rem;
  padding: 0.25rem 0.25rem 0.375rem;
}

.branch-message-item {
  padding: 0.25rem 0.375rem;
  font-size: 0.8125rem;
  border-radius: var(--radius-sm);
  transition: all var(--transition-fast);
  min-height: 1.75rem;
  flex-shrink: 0;
}

.branch-message-item--not-in-context {
  opacity: 0.45;
}

.branch-message-item--on-path {
  border-left: 2px solid var(--accent);
  padding-left: calc(0.375rem - 2px);
}

/* Filter Bar (All Messages tab) */
.filter-bar {
  display: flex;
  gap: 0.125rem;
  padding: 0.1875rem;
  background: var(--overlay-dark);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
}

.context-builder.day-mode .filter-bar {
  background: rgba(255, 255, 255, 0.15);
}

.filter-btn {
  flex: 1;
  padding: 0.25rem 0.375rem;
  font-size: 0.6875rem;
  font-weight: 500;
  font-family: var(--font-sans);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-muted, var(--text-primary));
  cursor: pointer;
  transition: all var(--transition-fast);
}

.filter-btn--active {
  background: var(--glass-bg-solid);
  color: var(--text-primary);
}

.filter-btn:hover:not(.filter-btn--active) {
  color: var(--text-primary);
}

.message-count {
  font-size: 0.625rem;
  color: var(--text-muted, var(--text-primary));
  text-align: right;
  opacity: 0.6;
}

/* All Messages List */
.all-messages-list {
  display: flex;
  flex-direction: column;
  gap: 0.0625rem;
  flex-shrink: 0;
}

.all-msg-item {
  padding: 0.1875rem 0.375rem;
  padding-left: calc(0.375rem - 3px);
  font-size: 0.8125rem;
  border-radius: var(--radius-sm);
  transition: all var(--transition-fast);
  min-height: 1.75rem;
  flex-shrink: 0;
  border-left: 3px solid transparent;
}

.all-msg-item--not-in-context {
  opacity: 0.45;
}

.path-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1rem;
  height: 1rem;
  font-size: 0.5625rem;
  font-weight: 700;
  background: rgba(var(--branch-blue-rgb), 0.15);
  color: var(--branch-blue);
  border-radius: var(--radius-sm);
  flex-shrink: 0;
}

/* Empty State */
.empty-state {
  padding: 0.75rem;
  text-align: center;
  font-size: 0.8125rem;
  color: var(--text-primary);
  opacity: 0.6;
}

/* Footer */
.panel-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 0.75rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--border-subtle);
}

.reset-btn {
  font-size: 0.6875rem;
  font-family: var(--font-sans);
  font-weight: 500;
  letter-spacing: 0.02em;
  padding: 0.3rem 0.75rem;
  color: rgba(var(--accent-rgb), 0.85);
  background: rgba(var(--accent-rgb), 0.08);
  border: 1px solid rgba(var(--accent-rgb), 0.2);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.reset-btn:hover {
  color: var(--accent);
  background: rgba(var(--accent-rgb), 0.15);
  border-color: rgba(var(--accent-rgb), 0.4);
}

.reset-btn:active {
  transform: scale(0.97);
  background: rgba(var(--accent-rgb), 0.2);
}

.footer-hint {
  font-size: 0.6875rem;
  color: var(--text-primary);
  opacity: 0.6;
}

/* Expanded warning message */
.warning-related-msg--expanded .message-text {
  white-space: pre-wrap;
  word-break: break-word;
  overflow: visible;
}

.warning-excluded-msg .message-row {
  min-height: 1.5rem;
}

/* ---- Animations ---- */

/* Warnings panel slide in/out */
.warnings-panel-enter-active {
  animation: slide-down 0.25s ease-out;
}
.warnings-panel-leave-active {
  animation: slide-down 0.2s ease-in reverse;
}

@keyframes slide-down {
  from {
    opacity: 0;
    max-height: 0;
    margin-bottom: 0;
  }
  to {
    opacity: 1;
    max-height: 20rem;
    margin-bottom: 0.75rem;
  }
}

/* Warning items leaving when resolved */
.warning-item-enter-active {
  animation: warning-in 0.3s ease-out;
}
.warning-item-leave-active {
  animation: warning-out 0.35s ease-in forwards;
}
.warning-item-move {
  transition: transform 0.3s ease;
}

@keyframes warning-in {
  from {
    opacity: 0;
    transform: translateX(-12px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@keyframes warning-out {
  0% {
    opacity: 1;
    transform: translateX(0);
    max-height: 8rem;
  }
  50% {
    opacity: 0;
    transform: translateX(16px);
    max-height: 8rem;
  }
  100% {
    opacity: 0;
    transform: translateX(16px);
    max-height: 0;
    padding: 0 0.5rem;
    margin: 0;
  }
}

/* Message expand/collapse */
.message-text {
  transition: all 0.2s ease;
}

/* Toggle button state change animation */
.toggle-btn {
  transition: all 0.2s ease, transform 0.15s ease;
}

.toggle-btn:active {
  transform: scale(0.9);
}

/* Message items: context toggle flash */
.msg-toggle-enter-active,
.msg-toggle-leave-active {
  transition: all 0.3s ease;
}
.msg-toggle-enter-from {
  opacity: 0;
  transform: translateY(-4px);
}
.msg-toggle-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
.msg-toggle-move {
  transition: transform 0.3s ease;
}

.warning-related-msg .message-row {
  min-height: 1.5rem;
}

/* ---- Context change animations ---- */

/* Flash highlight when a message's context state changes */
.cb-flash {
  animation: cb-flash 0.5s ease-out;
}

@keyframes cb-flash {
  0% { box-shadow: inset 0 0 0 100px rgba(var(--accent-rgb), 0.25); }
  100% { box-shadow: inset 0 0 0 100px transparent; }
}

.path-item--excluded.cb-flash {
  animation: cb-flash-exclude 0.5s ease-out;
}

@keyframes cb-flash-exclude {
  0% { box-shadow: inset 0 0 0 100px rgba(245, 158, 11, 0.3); }
  100% { box-shadow: inset 0 0 0 100px transparent; }
}

/* Shake animation for excluded count badge */
.cb-shake {
  animation: cb-shake 0.4s ease-in-out;
}

@keyframes cb-shake {
  0%, 100% { transform: translateX(0); }
  15% { transform: translateX(-3px); }
  30% { transform: translateX(3px); }
  45% { transform: translateX(-2px); }
  60% { transform: translateX(2px); }
  75% { transform: translateX(-1px); }
}

/* ---- Preset Bar ---- */
.preset-bar {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 0.75rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--border-subtle);
}

.active-preset-indicator {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.3rem 0.625rem;
  min-height: 1.75rem;
  height: 1.75rem;
  background: rgba(var(--accent-rgb), 0.08);
  border: 1px solid rgba(var(--accent-rgb), 0.2);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.active-preset-label {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--accent);
  flex-shrink: 0;
}

.active-preset-name {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-primary);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preset-modified-badge {
  padding: 0.0625rem 0.375rem;
  font-size: 0.5625rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  background: rgba(245, 158, 11, 0.2);
  color: #f59e0b;
  border: 1px solid rgba(245, 158, 11, 0.35);
  border-radius: var(--radius-pill);
  flex-shrink: 0;
}

.preset-deactivate-btn {
  background: none;
  border: none;
  color: var(--text-primary);
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
  padding: 0 0.25rem;
  opacity: 0.5;
  flex-shrink: 0;
  transition: opacity var(--transition-fast);
}

.preset-deactivate-btn:hover {
  opacity: 1;
}

.preset-controls {
  display: flex;
  gap: 0.375rem;
  align-items: center;
}

.preset-btn {
  font-size: 0.6875rem;
  font-family: var(--font-sans);
  font-weight: 500;
  letter-spacing: 0.02em;
  padding: 0.25rem 0.625rem;
  color: rgba(var(--accent-rgb), 0.85);
  background: rgba(var(--accent-rgb), 0.08);
  border: 1px solid rgba(var(--accent-rgb), 0.2);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.preset-btn:hover:not(:disabled) {
  color: var(--accent);
  background: rgba(var(--accent-rgb), 0.15);
  border-color: rgba(var(--accent-rgb), 0.4);
}

.preset-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.preset-btn--small {
  padding: 0.125rem 0.5rem;
  font-size: 0.625rem;
}

.preset-btn--ghost {
  background: transparent;
  border-color: var(--border-subtle);
  color: var(--text-primary);
  opacity: 0.7;
}

.preset-btn--ghost:hover {
  opacity: 1;
  background: rgba(var(--accent-rgb), 0.05);
}

.preset-load-wrapper {
  position: relative;
}

.preset-dropdown-backdrop {
  position: fixed;
  inset: 0;
  z-index: 19;
}

.preset-dropdown {
  position: absolute;
  bottom: calc(100% + 0.375rem);
  left: 0;
  min-width: 14rem;
  max-height: 12rem;
  overflow-y: auto;
  background: rgba(20, 20, 30, 0.95);
  backdrop-filter: blur(12px);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.4);
  padding: 0.25rem;
  z-index: 20;
}

.context-builder.day-mode .preset-dropdown {
  background: rgba(255, 255, 255, 0.95);
  box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.12);
}

.preset-item {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0.375rem;
  border-radius: var(--radius-md);
  transition: background var(--transition-fast);
}

.preset-item:hover {
  background: rgba(var(--accent-rgb), 0.08);
}

.preset-item--active {
  background: rgba(var(--accent-rgb), 0.12);
  border-left: 2px solid var(--accent);
  padding-left: calc(0.375rem - 2px);
}

.preset-item-name {
  flex: 1;
  background: none;
  border: none;
  color: var(--text-primary);
  font-size: 0.75rem;
  font-family: var(--font-sans);
  text-align: left;
  cursor: pointer;
  padding: 0.125rem 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preset-item-name:hover {
  color: var(--accent);
}

.preset-icon-btn {
  background: none;
  border: none;
  color: var(--text-primary);
  font-size: 0.8125rem;
  cursor: pointer;
  padding: 0.125rem 0.25rem;
  opacity: 0.4;
  flex-shrink: 0;
  transition: opacity var(--transition-fast);
  line-height: 1;
}

.preset-icon-btn:hover {
  opacity: 1;
}

.preset-icon-btn--danger:hover {
  color: var(--error, #ef4444);
}

.preset-dropdown-empty {
  padding: 0.5rem;
  font-size: 0.75rem;
  color: var(--text-primary);
  opacity: 0.5;
  text-align: center;
}

.preset-name-input {
  flex: 1;
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
  font-family: var(--font-sans);
  color: var(--text-primary);
  background: rgba(var(--accent-rgb), 0.05);
  border: 1px solid rgba(var(--accent-rgb), 0.3);
  border-radius: var(--radius-md);
  outline: none;
  transition: border-color var(--transition-fast);
}

.preset-name-input:focus {
  border-color: var(--accent);
}

.context-builder.day-mode .preset-name-input {
  background: rgba(255, 255, 255, 0.6);
}

.preset-save-form {
  display: flex;
  gap: 0.375rem;
  align-items: center;
}

/* Preset dropdown animation */
.preset-dropdown-enter-active {
  animation: preset-slide-up 0.2s ease-out;
}
.preset-dropdown-leave-active {
  animation: preset-slide-up 0.15s ease-in reverse;
}

@keyframes preset-slide-up {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Preset save form animation */
.preset-save-form-enter-active {
  animation: preset-fade-in 0.2s ease-out;
}
.preset-save-form-leave-active {
  animation: preset-fade-in 0.15s ease-in reverse;
}

@keyframes preset-fade-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
