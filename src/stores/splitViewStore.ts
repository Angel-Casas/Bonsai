/**
 * Split View Store
 *
 * Manages the state for split view mode, allowing users to compare
 * two different branch paths side-by-side within the same conversation.
 *
 * State Model:
 * - splitViewEnabled: Whether split view is active
 * - paneA.activeMessageId: The cursor position for pane A
 * - paneB.activeMessageId: The cursor position for pane B
 * - focusedPane: Which pane is currently focused ('A' | 'B')
 *
 * The focused pane determines which pane receives navigation actions
 * from the sidebar tree. Each pane has independent navigation.
 *
 * Streaming Constraints:
 * - Only one pane can stream at a time
 * - The non-streaming pane's send is disabled during streaming
 * - Stop affects only the pane that initiated streaming
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Message } from '@/db/types'
import { getPathToRoot, getFullBranchTimeline } from '@/db/treeUtils'

export type PaneId = 'A' | 'B'

export interface PaneState {
  activeMessageId: string | null
  /** Per-pane model override (null = use conversation default) */
  modelId: string | null
}

export const useSplitViewStore = defineStore('splitView', () => {
  // ========== State ==========

  /** Whether split view is enabled */
  const splitViewEnabled = ref(false)

  /** Pane A state */
  const paneA = ref<PaneState>({
    activeMessageId: null,
    modelId: null,
  })

  /** Pane B state */
  const paneB = ref<PaneState>({
    activeMessageId: null,
    modelId: null,
  })

  /** Currently focused pane ('A' or 'B') - determines which pane receives tree clicks */
  const focusedPane = ref<PaneId>('A')

  /** Which pane is currently streaming (null if none) */
  const streamingPane = ref<PaneId | null>(null)

  // ========== Computed ==========

  /** Get state for a specific pane */
  function getPaneState(paneId: PaneId): PaneState {
    return paneId === 'A' ? paneA.value : paneB.value
  }

  /** Check if a pane is the focused one */
  function isPaneFocused(paneId: PaneId): boolean {
    return focusedPane.value === paneId
  }

  /** Check if a pane can send (not streaming, or this pane is the streaming one that can be stopped) */
  function canPaneSend(_paneId: PaneId): boolean {
    // If nothing is streaming, any pane can send
    if (streamingPane.value === null) return true
    // If this pane is streaming, it can't send (it's already streaming)
    // If another pane is streaming, this pane can't send either
    return false
  }

  /** Check if a specific pane is streaming */
  function isPaneStreaming(paneId: PaneId): boolean {
    return streamingPane.value === paneId
  }

  // ========== Actions ==========

  /**
   * Enable split view mode
   * If panes already have state (from previous split view session), restore that.
   * Otherwise, initialize both panes with the current active message.
   */
  function enableSplitView(currentActiveMessageId: string | null) {
    splitViewEnabled.value = true

    // If panes already have saved state, just re-enable without changing positions
    if (paneA.value.activeMessageId !== null || paneB.value.activeMessageId !== null) {
      // Panes have previous state, keep it
      return
    }

    // First time enabling - initialize both panes with the current position
    paneA.value.activeMessageId = currentActiveMessageId
    paneB.value.activeMessageId = currentActiveMessageId
    focusedPane.value = 'A'
  }

  /**
   * Disable split view mode
   * Returns the active message ID from the focused pane to restore single view
   * NOTE: Does NOT reset pane states - they are preserved for when split view is re-enabled
   */
  function disableSplitView(): string | null {
    splitViewEnabled.value = false
    const activeId = getPaneState(focusedPane.value).activeMessageId
    // Don't reset pane states - preserve them for when split view is re-enabled
    streamingPane.value = null
    return activeId
  }

  /**
   * Set focus to a specific pane
   */
  function setFocusedPane(paneId: PaneId) {
    focusedPane.value = paneId
  }

  /**
   * Set the active message for a specific pane
   */
  function setPaneActiveMessage(paneId: PaneId, messageId: string | null) {
    if (paneId === 'A') {
      paneA.value.activeMessageId = messageId
    } else {
      paneB.value.activeMessageId = messageId
    }
  }

  /**
   * Get the model for a specific pane
   */
  function getPaneModel(paneId: PaneId): string | null {
    return paneId === 'A' ? paneA.value.modelId : paneB.value.modelId
  }

  /**
   * Set the model for a specific pane
   */
  function setPaneModel(paneId: PaneId, modelId: string | null) {
    if (paneId === 'A') {
      paneA.value.modelId = modelId
    } else {
      paneB.value.modelId = modelId
    }
  }

  /**
   * Set the active message for the currently focused pane
   * Used when clicking on tree nodes
   */
  function setFocusedPaneActiveMessage(messageId: string | null) {
    setPaneActiveMessage(focusedPane.value, messageId)
  }

  /**
   * Start streaming in a specific pane
   */
  function startPaneStreaming(paneId: PaneId) {
    streamingPane.value = paneId
  }

  /**
   * Stop streaming (clears streaming pane)
   */
  function stopPaneStreaming() {
    streamingPane.value = null
  }

  /**
   * Swap the positions of pane A and pane B
   * Useful for comparing branches from different starting points
   */
  function swapPanes() {
    const tempActiveId = paneA.value.activeMessageId
    const tempModelId = paneA.value.modelId
    paneA.value.activeMessageId = paneB.value.activeMessageId
    paneA.value.modelId = paneB.value.modelId
    paneB.value.activeMessageId = tempActiveId
    paneB.value.modelId = tempModelId
  }

  /**
   * Clone the active message from one pane to another
   */
  function clonePaneToOther(fromPaneId: PaneId) {
    const sourceState = getPaneState(fromPaneId)
    const targetPaneId = fromPaneId === 'A' ? 'B' : 'A'
    setPaneActiveMessage(targetPaneId, sourceState.activeMessageId)
  }

  /**
   * Set the other pane to the divergence point (common ancestor)
   * of the two panes' current positions
   */
  function setOtherPaneToDivergence(
    messageMap: Map<string, Message>,
    currentPaneId: PaneId
  ) {
    const paneAId = paneA.value.activeMessageId
    const paneBId = paneB.value.activeMessageId
    
    if (!paneAId || !paneBId) return

    // Get paths for both panes
    const pathA = getPathToRoot(paneAId, messageMap)
    const pathB = getPathToRoot(paneBId, messageMap)

    // Find common ancestor (last common element in both paths, starting from root)
    // Paths are ordered from root to leaf
    const pathAIds = new Set(pathA.map(m => m.id))
    
    // Find the deepest common message (iterate pathB from root to find last match)
    let commonAncestorId: string | null = null
    for (const msg of pathB) {
      if (pathAIds.has(msg.id)) {
        commonAncestorId = msg.id
      }
    }

    if (commonAncestorId) {
      const otherPaneId = currentPaneId === 'A' ? 'B' : 'A'
      setPaneActiveMessage(otherPaneId, commonAncestorId)
    }
  }

  /**
   * Get timeline for a specific pane
   * Returns the full branch: path from root through active message to leaf
   */
  function getPaneTimeline(
    paneId: PaneId,
    messageMap: Map<string, Message>
  ): Message[] {
    const paneState = getPaneState(paneId)
    if (!paneState.activeMessageId) return []
    return getFullBranchTimeline(paneState.activeMessageId, messageMap)
  }

  /**
   * Initialize pane states from URL params
   */
  function initFromUrlParams(
    paneAId: string | null,
    paneBId: string | null,
    focus: PaneId | null,
    messageMap: Map<string, Message>,
    modelA?: string | null,
    modelB?: string | null
  ) {
    // Validate message IDs exist in the conversation
    if (paneAId && messageMap.has(paneAId)) {
      paneA.value.activeMessageId = paneAId
    }
    if (paneBId && messageMap.has(paneBId)) {
      paneB.value.activeMessageId = paneBId
    }
    if (focus === 'A' || focus === 'B') {
      focusedPane.value = focus
    }
    // Restore per-pane models
    if (modelA) {
      paneA.value.modelId = modelA
    }
    if (modelB) {
      paneB.value.modelId = modelB
    }

    // If we have valid pane params, enable split view
    if (paneA.value.activeMessageId && paneB.value.activeMessageId) {
      splitViewEnabled.value = true
    }
  }

  /**
   * Generate URL params for current split view state
   */
  function toUrlParams(): Record<string, string> {
    if (!splitViewEnabled.value) {
      return {}
    }

    const params: Record<string, string> = {}
    if (paneA.value.activeMessageId) {
      params.paneA = paneA.value.activeMessageId
    }
    if (paneB.value.activeMessageId) {
      params.paneB = paneB.value.activeMessageId
    }
    if (paneA.value.modelId) {
      params.modelA = paneA.value.modelId
    }
    if (paneB.value.modelId) {
      params.modelB = paneB.value.modelId
    }
    params.focus = focusedPane.value
    return params
  }

  /**
   * Reset all split view state
   */
  function reset() {
    splitViewEnabled.value = false
    paneA.value.activeMessageId = null
    paneA.value.modelId = null
    paneB.value.activeMessageId = null
    paneB.value.modelId = null
    focusedPane.value = 'A'
    streamingPane.value = null
  }

  return {
    // State
    splitViewEnabled,
    paneA,
    paneB,
    focusedPane,
    streamingPane,

    // Getters
    getPaneState,
    isPaneFocused,
    canPaneSend,
    isPaneStreaming,
    getPaneTimeline,

    // Actions
    enableSplitView,
    disableSplitView,
    setFocusedPane,
    setPaneActiveMessage,
    setFocusedPaneActiveMessage,
    getPaneModel,
    setPaneModel,
    startPaneStreaming,
    stopPaneStreaming,
    swapPanes,
    clonePaneToOther,
    setOtherPaneToDivergence,
    initFromUrlParams,
    toUrlParams,
    reset,
  }
})
