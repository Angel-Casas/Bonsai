<script setup lang="ts">
/**
 * ConversationView - Conversation Detail
 *
 * Main conversation interface with:
 * - Left sidebar: Tree navigation of messages/branches
 * - Main area: Message timeline for current path
 * - Bottom: Composer for adding messages
 * - Branch-from-any-message UX
 * - Streaming assistant responses with stop button
 *
 * Active Cursor Model:
 * - activeMessageId determines the current position in tree
 * - Timeline shows path from root → activeMessageId
 * - New messages are added as children of activeMessageId
 */

import { ref, watch, onMounted, onUnmounted, computed, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useConversationStore } from '@/stores/conversationStore'
import { useSplitViewStore, type PaneId } from '@/stores/splitViewStore'
import { useThemeStore } from '@/stores/themeStore'
import { useSettingsPanel } from '@/composables/useSettingsPanel'
import MessageTree from '@/components/MessageTree.vue'
import MessageTimeline from '@/components/MessageTimeline.vue'
import MessageComposer from '@/components/MessageComposer.vue'
import PathBreadcrumbs from '@/components/PathBreadcrumbs.vue'
import ContextBuilder from '@/components/ContextBuilder.vue'
import SearchPanel from '@/components/SearchPanel.vue'
import SplitViewPane from '@/components/SplitViewPane.vue'
import GraphView from '@/components/GraphView.vue'
import TopNavBar from '@/components/TopNavBar.vue'
import HalftoneBackground from '@/components/HalftoneBackground.vue'
import type { ContextResolverConfig } from '@/db'
import type { SearchPreset } from '@/api/nanogpt'
import { MissingApiKeyError } from '@/api/streamingService'
import { hasApiKey } from '@/api/settings'
import { useOnlineStatus } from '@/composables/useOnlineStatus'
import { useToast } from '@/composables/useToast'

const props = defineProps<{
  id: string
}>()

const route = useRoute()
const router = useRouter()
const store = useConversationStore()
const splitViewStore = useSplitViewStore()
const themeStore = useThemeStore()
const { openSettings } = useSettingsPanel()
const { isOnline } = useOnlineStatus()
const toast = useToast()

// Reactive API key check
const apiKeyAvailable = computed(() => hasApiKey())

// View mode state: 'tree' | 'split' | 'graph'
type ViewMode = 'tree' | 'split' | 'graph'

// Persist view mode preference to localStorage
const VIEW_MODE_KEY = 'bonsai:viewMode'
function loadViewMode(): ViewMode {
  try {
    const saved = localStorage.getItem(VIEW_MODE_KEY)
    if (saved === 'tree' || saved === 'split' || saved === 'graph') {
      return saved
    }
  } catch {
    // Ignore localStorage errors
  }
  return 'tree'
}
function saveViewMode(mode: ViewMode) {
  try {
    localStorage.setItem(VIEW_MODE_KEY, mode)
  } catch {
    // Ignore localStorage errors
  }
}

const viewMode = ref<ViewMode>(loadViewMode())

// UI state
const isMobile = ref(false)
const showBranchDialog = ref(false)
const branchFromMessageId = ref<string | null>(null)
const branchTitle = ref('')
const pendingBranchTitle = ref<string | null>(null)
const pendingBranchFromId = ref<string | null>(null)
const branchTitleInputRef = ref<HTMLInputElement | null>(null)

// Edit dialog state
const showEditDialog = ref(false)
const editingMessageId = ref<string | null>(null)
const editContent = ref('')
const editHasDescendants = ref(false)
const showEditOptionDialog = ref(false)
const editBranchTitle = ref('')

// Resend dialog state
const showResendDialog = ref(false)
const resendingMessageId = ref<string | null>(null)
const resendSourceContent = ref('')
const resendSourceParentId = ref<string | null>(null)
const resendBranchTitle = ref('')

// Delete confirmation state
const showDeleteDialog = ref(false)
const deletingMessageId = ref<string | null>(null)
const deleteSubtreeCount = ref(0)

// Delete branch confirmation state
const showDeleteBranchDialog = ref(false)
const deletingBranchId = ref<string | null>(null)
const deletingBranchDepth = ref(0)
const deletingBranchMessageCount = ref(0)

// Search state
const showSearchPanel = ref(false)
const highlightedMessageId = ref<string | null>(null)

// Sent context viewer state

// API key prompt state
const showApiKeyPrompt = ref(false)

// Title editing state
const isEditingTitle = ref(false)
const editedTitle = ref('')
const titleInputRef = ref<HTMLInputElement | null>(null)

// Timeline ref for scrolling
const timelineRef = ref<InstanceType<typeof MessageTimeline> | null>(null)

// Tree ref for accessing branch colors
const treeRef = ref<InstanceType<typeof MessageTree> | null>(null)

// Pending scroll target (when switching from graph view)
const pendingScrollToMessageId = ref<string | null>(null)

// Track initial scroll target for each split pane
// - null: use default behavior (scroll to last user message)
// - 'none': don't scroll
// - string: scroll to that message ID
const initialScrollTargetPaneA = ref<string | 'none' | null>(null)
const initialScrollTargetPaneB = ref<string | 'none' | null>(null)

// Store scroll positions for split panes (preserved when switching away)
const savedScrollPositionPaneA = ref<number | null>(null)
const savedScrollPositionPaneB = ref<number | null>(null)

// Explicitly save pane active message IDs when leaving split view
// This is more reliable than relying on the store's state preservation
const savedPaneAActiveMessageId = ref<string | null>(null)
const savedPaneBActiveMessageId = ref<string | null>(null)
const savedFocusedPane = ref<'A' | 'B'>('A')

// Refs to split pane components for accessing scroll position and navigation
const splitPaneARef = ref<{ getScrollPosition?: () => number; scrollToMessage?: (id: string) => void } | null>(null)
const splitPaneBRef = ref<{ getScrollPosition?: () => number; scrollToMessage?: (id: string) => void } | null>(null)

// Split view divider state (persisted to localStorage)
const DIVIDER_POSITION_KEY = 'bonsai:splitView:dividerPosition'
function loadDividerPosition(): number {
  try {
    const saved = localStorage.getItem(DIVIDER_POSITION_KEY)
    if (saved) {
      const value = parseFloat(saved)
      if (!isNaN(value) && value >= 20 && value <= 80) {
        return value
      }
    }
  } catch {
    // Ignore localStorage errors
  }
  return 50
}
function saveDividerPosition(position: number) {
  try {
    localStorage.setItem(DIVIDER_POSITION_KEY, position.toString())
  } catch {
    // Ignore localStorage errors
  }
}
const splitDividerPosition = ref(loadDividerPosition())
const isDraggingDivider = ref(false)

// Sidebar width state (persisted to localStorage)
const SIDEBAR_WIDTH_KEY = 'bonsai:sidebar:width'
function loadSidebarWidth(): number {
  try {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY)
    if (saved) {
      const value = parseInt(saved, 10)
      if (!isNaN(value) && value >= 150 && value <= 600) {
        return value
      }
    }
  } catch {
    // Ignore localStorage errors
  }
  return 288 // Default: 18rem = 288px
}
function saveSidebarWidth(width: number) {
  try {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, width.toString())
  } catch {
    // Ignore localStorage errors
  }
}
const sidebarWidth = ref(loadSidebarWidth())
const isDraggingSidebar = ref(false)

// Sidebar resize handlers
function startSidebarResize(event: MouseEvent) {
  if (isMobile.value) return
  isDraggingSidebar.value = true
  event.preventDefault()
}

function handleSidebarResize(event: MouseEvent) {
  if (!isDraggingSidebar.value) return

  const newWidth = event.clientX
  // Clamp between 270px and 600px
  const clampedWidth = Math.max(270, Math.min(600, newWidth))
  sidebarWidth.value = clampedWidth
}

function stopSidebarResize() {
  if (isDraggingSidebar.value) {
    isDraggingSidebar.value = false
    saveSidebarWidth(sidebarWidth.value)
  }
}

// Context configuration for the next message
/**
 * Effective context config — reads directly from the store (single source of truth).
 */
const effectiveContextConfig = computed<ContextResolverConfig | null>(() => {
  const exclusions = Array.from(store.excludedMessageIds)
  const pins = [...store.contextPinnedMessageIds]
  const anchor = store.contextStartFromMessageId

  if (exclusions.length === 0 && pins.length === 0 && !anchor) {
    return null
  }

  return {
    startFromMessageId: anchor,
    excludedMessageIds: exclusions,
    pinnedMessageIds: pins,
  }
})

// Error state for displaying to user
const sendError = ref<string | null>(null)
const showApiKeyError = ref(false)

// Conversation not found state
const conversationNotFound = ref(false)

// Flag to prevent URL update during initial load
const isInitialLoad = ref(true)

// Check if we're on mobile and set sidebar visibility accordingly
function checkMobile() {
  const wasMobile = isMobile.value
  isMobile.value = window.innerWidth < 768

  if (isMobile.value) {
    // Close sidebar on mobile
    store.isSidebarOpen = false
  } else if (wasMobile || store.isSidebarOpen === false) {
    // Open sidebar on desktop (when switching from mobile or on initial load)
    store.isSidebarOpen = true
  }
}


// Watch for route changes (same conversation, different message)
watch(
  () => route.query.message,
  (newMessageId) => {
    if (typeof newMessageId === 'string' && store.messageMap.has(newMessageId)) {
      store.setActiveMessage(newMessageId)
    }
  }
)

// Update URL when active message changes (but not during initial load)
watch(
  () => store.activeMessageId,
  (newId) => {
    if (isInitialLoad.value) return
    // Skip URL update when in split view mode (split view handles its own URL updates)
    if (splitViewStore.splitViewEnabled) return
    if (newId && newId !== route.query.message) {
      // Exclude split view params to avoid race conditions when switching modes
      const { paneA, paneB, focus, modelA, modelB, view, ...rest } = route.query
      router.replace({
        query: { ...rest, message: newId },
      })
    }
  }
)

// When streaming finishes, scroll to the active message and focus the branch in the tree
watch(
  () => store.isStreaming,
  (streaming, wasStreaming) => {
    if (wasStreaming && !streaming) {
      // Scroll the last message to the top of the viewport
      nextTick(() => {
        const activeId = store.activeMessageId
        if (activeId) {
          timelineRef.value?.scrollMessageToTop(activeId)
        }
      })

      // Wait for Vue to re-render the tree with the new branch, then scroll to it.
      // Use a retry because the tree re-render may take multiple ticks.
      const scrollToActiveBranch = (retries: number) => {
        const treeContent = document.querySelector('.tree-content')
        const activeNode = treeContent?.querySelector('.branch-item.active')
        if (activeNode) {
          activeNode.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        } else if (retries > 0) {
          setTimeout(() => scrollToActiveBranch(retries - 1), 150)
        }
      }
      setTimeout(() => scrollToActiveBranch(3), 200)
    }
  }
)

// Computed
const hasMessages = computed(() => store.messages.length > 0)

// Split view computed
const isSplitViewEnabled = computed(() => splitViewStore.splitViewEnabled)
const paneATimeline = computed(() => splitViewStore.getPaneTimeline('A', store.messageMap))
const paneBTimeline = computed(() => splitViewStore.getPaneTimeline('B', store.messageMap))

// View mode computed
const isGraphView = computed(() => viewMode.value === 'graph')

// Branch color map from tree (for consistent colors in timeline)
const treeBranchColorMap = computed(() => treeRef.value?.branchColorMap ?? undefined)

// Timeline IDs for graph view highlighting (computed to avoid creating new Set on every render)
const timelineIds = computed(() => new Set(store.timeline.map((m) => m.id)))


// ========== View Mode Handlers ==========

async function setViewMode(mode: ViewMode) {
  // Disable split view if switching away from it
  if (viewMode.value === 'split' && mode !== 'split') {
    // Save scroll positions before leaving split view
    if (splitPaneARef.value?.getScrollPosition) {
      savedScrollPositionPaneA.value = splitPaneARef.value.getScrollPosition()
    }
    if (splitPaneBRef.value?.getScrollPosition) {
      savedScrollPositionPaneB.value = splitPaneBRef.value.getScrollPosition()
    }

    // Explicitly save pane states before disabling split view
    // This ensures they're preserved even if the store has reactivity issues
    savedPaneAActiveMessageId.value = splitViewStore.paneA.activeMessageId
    savedPaneBActiveMessageId.value = splitViewStore.paneB.activeMessageId
    savedFocusedPane.value = splitViewStore.focusedPane

    const activeId = splitViewStore.disableSplitView()
    if (activeId) {
      store.setActiveMessage(activeId)
    }
  }

  // Enable split view if switching to it
  if (mode === 'split' && viewMode.value !== 'split') {
    // Check if we have preserved state (from our explicit save)
    const hasPreservedState = savedPaneAActiveMessageId.value !== null ||
                               savedPaneBActiveMessageId.value !== null

    if (hasPreservedState) {
      // Don't set scroll targets - we'll use saved scroll positions instead
      initialScrollTargetPaneA.value = 'none'
      initialScrollTargetPaneB.value = 'none'

      // Restore the pane states explicitly
      splitViewStore.splitViewEnabled = true
      if (savedPaneAActiveMessageId.value) {
        splitViewStore.setPaneActiveMessage('A', savedPaneAActiveMessageId.value)
      }
      if (savedPaneBActiveMessageId.value) {
        splitViewStore.setPaneActiveMessage('B', savedPaneBActiveMessageId.value)
      }
      splitViewStore.setFocusedPane(savedFocusedPane.value)
    } else {
      // First time - use default scroll behavior, clear any saved positions
      initialScrollTargetPaneA.value = null
      initialScrollTargetPaneB.value = null
      savedScrollPositionPaneA.value = null
      savedScrollPositionPaneB.value = null

      // Initialize split view with current message
      splitViewStore.enableSplitView(store.activeMessageId)
    }

    // Clear the scroll targets after a short delay (scroll positions will be used instead)
    setTimeout(() => {
      initialScrollTargetPaneA.value = null
      initialScrollTargetPaneB.value = null
    }, 300)
  }

  viewMode.value = mode
  saveViewMode(mode)
  await updateViewModeUrl()
}

async function updateViewModeUrl() {
  if (viewMode.value === 'split') {
    const params = splitViewStore.toUrlParams()
    await router.replace({
      query: { ...route.query, ...params, view: 'split', message: undefined },
    })
  } else if (viewMode.value === 'graph') {
    const { paneA, paneB, focus, modelA, modelB, ...rest } = route.query
    await router.replace({ query: { ...rest, view: 'graph' } })
  } else {
    const { paneA, paneB, focus, modelA, modelB, view, ...rest } = route.query
    await router.replace({ query: rest })
  }
}

// ========== Split View Handlers ==========

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function toggleSplitView() {
  if (splitViewStore.splitViewEnabled) {
    const activeId = splitViewStore.disableSplitView()
    if (activeId) {
      store.setActiveMessage(activeId)
    }
  } else {
    splitViewStore.enableSplitView(store.activeMessageId)
  }
  updateSplitViewUrl()
}

function handlePaneFocus(paneId: PaneId) {
  splitViewStore.setFocusedPane(paneId)
  updateSplitViewUrl()
}

function handlePaneSelectMessage(paneId: PaneId, messageId: string) {
  splitViewStore.setPaneActiveMessage(paneId, messageId)
  updateSplitViewUrl()
}

function handleSwapPanes() {
  splitViewStore.swapPanes()
  updateSplitViewUrl()
}

async function updateSplitViewUrl() {
  if (splitViewStore.splitViewEnabled) {
    const params = splitViewStore.toUrlParams()
    await router.replace({
      query: { ...route.query, ...params, message: undefined },
    })
  } else {
    // Remove split view params when disabled
    const { paneA, paneB, focus, modelA, modelB, ...rest } = route.query
    await router.replace({ query: rest })
  }
}

// ========== Split View Divider Handlers ==========

function startDividerDrag(event: MouseEvent) {
  event.preventDefault()
  isDraggingDivider.value = true
  document.addEventListener('mousemove', onDividerDrag)
  document.addEventListener('mouseup', stopDividerDrag)
}

function onDividerDrag(event: MouseEvent) {
  if (!isDraggingDivider.value) return

  const container = document.querySelector('.split-view-container') as HTMLElement
  if (!container) return

  const containerRect = container.getBoundingClientRect()
  const newPosition = ((event.clientX - containerRect.left) / containerRect.width) * 100

  // Clamp between 20% and 80% to prevent panes from becoming too small
  splitDividerPosition.value = Math.max(20, Math.min(80, newPosition))
}

function stopDividerDrag() {
  isDraggingDivider.value = false
  document.removeEventListener('mousemove', onDividerDrag)
  document.removeEventListener('mouseup', stopDividerDrag)
  // Save position when drag ends
  saveDividerPosition(splitDividerPosition.value)
}

function resetDividerPosition() {
  splitDividerPosition.value = 50
  saveDividerPosition(50)
}

// Actions
function goBack() {
  router.push({ name: 'home' })
}

function handleSelectMessage(messageId: string) {
  // In split view, clicking tree affects the focused pane
  if (splitViewStore.splitViewEnabled) {
    splitViewStore.setFocusedPaneActiveMessage(messageId)
    updateSplitViewUrl()
  } else {
    store.setActiveMessage(messageId)
  }

  // Auto-close sidebar on mobile after selecting a branch
  if (isMobile.value && store.isSidebarOpen) {
    store.isSidebarOpen = false
  }
}

// ========== Search Handlers ==========

function openSearch() {
  showSearchPanel.value = true
}

function closeSearch() {
  showSearchPanel.value = false
}

function handleSearchSelect(messageId: string) {

  // Set active message (which updates timeline)
  store.setActiveMessage(messageId)

  // Highlight the message briefly
  highlightedMessageId.value = messageId

  // Clear highlight after animation
  setTimeout(() => {
    highlightedMessageId.value = null
  }, 1200)
}

// ========== Navigate Handlers ==========

/**
 * Handle navigation to a message (from breadcrumbs)
 * This scrolls to and highlights the message WITHOUT changing the timeline.
 * The full conversation path remains visible.
 */
function handleNavigateToMessage(messageId: string) {
  // Highlight the message
  highlightedMessageId.value = messageId

  // Scroll to the message
  setTimeout(() => {
    if (timelineRef.value) {
      timelineRef.value.scrollToMessage(messageId)
    }
  }, 50)

  // Clear highlight after animation
  setTimeout(() => {
    highlightedMessageId.value = null
  }, 1200)
}

// ========== Graph View Handlers ==========

function handleGraphNodeSelect(messageId: string) {
  // Legacy handler - now mostly handled by go-to-tree/go-to-split
  store.setActiveMessage(messageId)
  highlightedMessageId.value = messageId
  setTimeout(() => {
    highlightedMessageId.value = null
  }, 2000)
}

async function handleGraphGoToTree(messageId: string) {
  // Set active message
  store.setActiveMessage(messageId)

  // Highlight the message
  highlightedMessageId.value = messageId

  // Store the message ID to scroll to after view change
  pendingScrollToMessageId.value = messageId

  // Switch to tree view
  await setViewMode('tree')

  // Scroll to the message after a short delay to allow DOM to update
  setTimeout(() => {
    if (timelineRef.value && pendingScrollToMessageId.value) {
      timelineRef.value.scrollToMessage(pendingScrollToMessageId.value)
      pendingScrollToMessageId.value = null
    }
  }, 100)

  // Clear highlight after animation
  setTimeout(() => {
    highlightedMessageId.value = null
  }, 2000)
}

async function handleGraphGoToSplit(messageId: string, pane: 'A' | 'B') {
  // Check if we have preserved state for the other pane (from our explicit save)
  const otherPane = pane === 'A' ? 'B' : 'A'
  const otherPaneActiveId = pane === 'A'
    ? (savedPaneBActiveMessageId.value ?? splitViewStore.paneB.activeMessageId)
    : (savedPaneAActiveMessageId.value ?? splitViewStore.paneA.activeMessageId)

  // For the target pane: scroll to the selected message (no saved position)
  // For the other pane: use saved scroll position if available
  if (pane === 'A') {
    initialScrollTargetPaneA.value = messageId
    savedScrollPositionPaneA.value = null // Clear - we want to scroll to messageId
    initialScrollTargetPaneB.value = 'none' // Will use saved scroll position
    // Keep savedScrollPositionPaneB as is
  } else {
    initialScrollTargetPaneA.value = 'none' // Will use saved scroll position
    // Keep savedScrollPositionPaneA as is
    initialScrollTargetPaneB.value = messageId
    savedScrollPositionPaneB.value = null // Clear - we want to scroll to messageId
  }

  // Enable split view
  splitViewStore.splitViewEnabled = true

  // Set the pane positions
  splitViewStore.setPaneActiveMessage(pane, messageId)
  if (otherPaneActiveId === null) {
    // If other pane has no state, initialize it to the same message
    splitViewStore.setPaneActiveMessage(otherPane, messageId)
    // Also clear its saved scroll position since it's being initialized
    if (pane === 'A') {
      savedScrollPositionPaneB.value = null
    } else {
      savedScrollPositionPaneA.value = null
    }
  } else {
    // Restore the other pane's state from our saved value
    splitViewStore.setPaneActiveMessage(otherPane, otherPaneActiveId)
  }
  splitViewStore.setFocusedPane(pane)

  // Update our saved state to reflect the new configuration
  savedPaneAActiveMessageId.value = pane === 'A' ? messageId : otherPaneActiveId
  savedPaneBActiveMessageId.value = pane === 'B' ? messageId : otherPaneActiveId
  savedFocusedPane.value = pane

  // Update view mode and URL
  viewMode.value = 'split'
  await updateViewModeUrl()

  // Update main store to match the focused pane
  store.setActiveMessage(messageId)

  // Clear the scroll targets after a short delay
  setTimeout(() => {
    initialScrollTargetPaneA.value = null
    initialScrollTargetPaneB.value = null
  }, 300)
}

// Keyboard shortcut for search (Cmd/Ctrl+F)
function handleGlobalKeydown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key === 'f') {
    // Only capture if not in an input
    const target = event.target as HTMLElement
    if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
      event.preventDefault()
      openSearch()
    }
  }
}

onMounted(async () => {
  checkMobile()
  window.addEventListener('resize', checkMobile)
  window.addEventListener('keydown', handleGlobalKeydown)

  document.addEventListener('mousemove', handleSidebarResize)
  document.addEventListener('mouseup', stopSidebarResize)

  // Check if API key is configured
  if (!hasApiKey()) {
    showApiKeyPrompt.value = true
  }

  // Get the message ID from URL BEFORE loading (to restore correct branch)
  const urlMessageId = route.query.message as string | undefined

  // Load conversation
  try {
    await store.loadConversation(props.id)
  } catch (error) {
    // Conversation not found
    conversationNotFound.value = true
    return
  }

  // Restore active message from URL - this overrides the default "latest leaf"
  // that loadConversation sets, ensuring we stay on the correct branch
  if (urlMessageId && store.messageMap.has(urlMessageId)) {
    store.setActiveMessage(urlMessageId)
  }

  // Allow URL updates from now on
  isInitialLoad.value = false

  // Restore view mode from URL query, or fall back to saved preference
  const viewParam = route.query.view as string | undefined
  if (viewParam === 'graph') {
    viewMode.value = 'graph'
  } else if (viewParam === 'split' || route.query.paneA) {
    viewMode.value = 'split'
    // Restore split view state from URL
    const paneA = route.query.paneA as string | undefined
    const paneB = route.query.paneB as string | undefined
    const focus = route.query.focus as 'A' | 'B' | undefined
    const modelA = route.query.modelA as string | undefined
    const modelB = route.query.modelB as string | undefined
    splitViewStore.enableSplitView(store.activeMessageId)
    if (paneA && store.messageMap.has(paneA)) {
      splitViewStore.setPaneActiveMessage('A', paneA)
    }
    if (paneB && store.messageMap.has(paneB)) {
      splitViewStore.setPaneActiveMessage('B', paneB)
    }
    if (focus) {
      splitViewStore.setFocusedPane(focus)
    }
    // Restore per-pane models
    if (modelA) {
      splitViewStore.setPaneModel('A', modelA)
    }
    if (modelB) {
      splitViewStore.setPaneModel('B', modelB)
    }
  } else if (!viewParam) {
    // No URL param - restore from saved preference (already loaded into viewMode)
    if (viewMode.value === 'split') {
      // Initialize split view with current active message
      splitViewStore.enableSplitView(store.activeMessageId)
    }
    // 'graph' and 'tree' don't need special initialization
  }
})

onUnmounted(() => {
  window.removeEventListener('resize', checkMobile)
  window.removeEventListener('keydown', handleGlobalKeydown)

  // Clean up divider drag listeners if still active
  document.removeEventListener('mousemove', onDividerDrag)
  document.removeEventListener('mouseup', stopDividerDrag)

  // Clean up sidebar resize listeners
  document.removeEventListener('mousemove', handleSidebarResize)
  document.removeEventListener('mouseup', stopSidebarResize)

  // Auto-abort streaming on navigation away
  // This ensures the DB state is consistent (message gets 'aborted' status)
  if (store.isStreaming) {
    store.stopStreaming()
  }

  // Reset split view state when leaving the conversation
  // This prevents stale split view state when returning to a conversation
  if (splitViewStore.splitViewEnabled) {
    splitViewStore.disableSplitView()
  }

  store.clearActiveConversation()
})

async function handleSendMessage(
  content: string,
  modelOverride: string | null,
  webSearchEnabled: boolean,
  searchPreset: SearchPreset
) {
  // Clear previous errors
  sendError.value = null
  showApiKeyError.value = false

  try {
    // Only apply pending branch title when sending from the correct branch point
    const isAtBranchPoint = pendingBranchFromId.value && store.activeMessageId === pendingBranchFromId.value
    const branchTitleToSend = isAtBranchPoint ? pendingBranchTitle.value : null

    await store.sendMessageWithStreaming(
      content,
      effectiveContextConfig.value, // Use merged config with store exclusions
      modelOverride,
      webSearchEnabled,
      searchPreset,
      branchTitleToSend
    )

    // Clear pending branch immediately — user message is already created and navigated to
    if (isAtBranchPoint) {
      pendingBranchTitle.value = null
      pendingBranchFromId.value = null
    }

    // Notify user if their message was auto-excluded by the active preset
    if (
      store.activePresetId &&
      store.activeMessageId &&
      store.excludedMessageIds.has(store.activeMessageId)
    ) {
      const presetName = store.activePresetName ?? 'Active preset'
      const currentPresetId = store.activePresetId
      const otherPresets = store.contextPresets
        .filter(p => p.id !== currentPresetId)
        .map(p => ({ label: p.name, value: p.id }))

      toast.show(
        `This branch is excluded in "${presetName}"`,
        'info',
        0,
        {
          action: {
            label: 'Reset context',
            callback: () => store.clearAllContextConfig(),
          },
          select: otherPresets.length > 0
            ? {
                placeholder: 'Switch preset...',
                options: otherPresets,
                onSelect: (presetId: string) => store.loadPreset(presetId),
              }
            : undefined,
        }
      )
    }
  } catch (error) {
    if (error instanceof MissingApiKeyError) {
      showApiKeyError.value = true
      sendError.value = 'API key not configured. Please go to Settings to add your NanoGPT API key.'
    } else {
      sendError.value = error instanceof Error ? error.message : 'Failed to send message'
    }
  }
}

function handleStopGeneration() {
  store.stopStreaming()
}

async function handleUpdateDefaultModel(modelId: string) {
  if (store.activeConversation) {
    await store.setConversationDefaultModel(store.activeConversation.id, modelId)
  }
}

function handleUpdatePaneModel(paneId: PaneId, modelId: string) {
  splitViewStore.setPaneModel(paneId, modelId)
  updateSplitViewUrl()
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function dismissError() {
  sendError.value = null
  showApiKeyError.value = false
}

function dismissStreamingError() {
  store.clearStreamingError()
}

function goToSettings() {
  openSettings()
}



function openBranchDialog(messageId: string) {
  branchFromMessageId.value = messageId
  branchTitle.value = ''
  showBranchDialog.value = true
  nextTick(() => {
    branchTitleInputRef.value?.focus()
  })
}

function createBranch() {
  if (!branchFromMessageId.value) return

  // Store the branch title and branch point for the next message
  pendingBranchTitle.value = branchTitle.value.trim() || null
  pendingBranchFromId.value = branchFromMessageId.value

  // Navigate to the branch point - next message will be a new branch
  store.setActiveMessage(branchFromMessageId.value)

  closeBranchDialog()
}

function closeBranchDialog() {
  showBranchDialog.value = false
  branchFromMessageId.value = null
  branchTitle.value = ''
}

function cancelPendingBranch() {
  pendingBranchTitle.value = null
  pendingBranchFromId.value = null
}

function goToPendingBranch() {
  if (pendingBranchFromId.value) {
    store.setActiveMessage(pendingBranchFromId.value)
  }
}

function toggleSidebar() {
  store.toggleSidebar()
}

// ========== Title Editing ==========

function startEditingTitle() {
  if (!store.activeConversation) return
  editedTitle.value = store.activeConversation.title
  isEditingTitle.value = true
  // Focus the input after Vue updates the DOM
  setTimeout(() => {
    titleInputRef.value?.focus()
    titleInputRef.value?.select()
  }, 0)
}

async function saveTitle() {
  if (!store.activeConversation || !editedTitle.value.trim()) {
    cancelEditingTitle()
    return
  }

  const newTitle = editedTitle.value.trim()
  if (newTitle !== store.activeConversation.title) {
    await store.renameConversation(store.activeConversation.id, newTitle)
  }
  isEditingTitle.value = false
}

function cancelEditingTitle() {
  isEditingTitle.value = false
  editedTitle.value = ''
}

function handleTitleKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    event.preventDefault()
    saveTitle()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    cancelEditingTitle()
  }
}

// ========== Edit Handlers ==========

async function openEditDialog(messageId: string) {
  const message = store.messageMap.get(messageId)
  if (!message) return

  editingMessageId.value = messageId
  editContent.value = message.content
  editBranchTitle.value = ''

  // Check if this message has descendants
  const hasDescendants = await store.checkHasDescendants(messageId)
  editHasDescendants.value = hasDescendants

  if (hasDescendants) {
    // Show Option A/B dialog
    showEditOptionDialog.value = true
  } else {
    // Show simple edit dialog
    showEditDialog.value = true
  }
}

async function saveSimpleEdit() {
  if (!editingMessageId.value || !editContent.value.trim()) return

  await store.editMessage(
    editingMessageId.value,
    editContent.value.trim()
  )

  closeEditDialogs()
  toast.show('Message updated')
}

async function saveEditOptionA() {
  // Option A: Rewrite history - delete descendants and edit in place
  if (!editingMessageId.value || !editContent.value.trim()) return

  await store.editMessageRewriteHistory(
    editingMessageId.value,
    editContent.value.trim()
  )

  closeEditDialogs()
  toast.show('Message updated (history rewritten)')
}

async function saveEditOptionB() {
  // Option B: Create new branch - create variant message
  if (!editingMessageId.value || !editContent.value.trim()) return

  await store.editMessageCreateBranch(
    editingMessageId.value,
    editContent.value.trim(),
    editBranchTitle.value.trim() || 'Edited'
  )

  closeEditDialogs()
  toast.show('New branch created from edit')
}

function closeEditDialogs() {
  showEditDialog.value = false
  showEditOptionDialog.value = false
  editingMessageId.value = null
  editContent.value = ''
  editHasDescendants.value = false
  editBranchTitle.value = ''
}

// ========== Resend Handlers ==========

async function openResendDialog(messageId: string) {
  const message = store.messageMap.get(messageId)
  if (!message) return

  // Resolve the source user message
  let sourceMessage: typeof message
  if (message.role === 'assistant') {
    // For assistant messages, use the parent user message
    if (!message.parentId) return
    const parent = store.messageMap.get(message.parentId)
    if (!parent || parent.role !== 'user') return
    sourceMessage = parent
  } else {
    sourceMessage = message
  }

  resendingMessageId.value = sourceMessage.id
  resendSourceContent.value = sourceMessage.content
  resendSourceParentId.value = sourceMessage.parentId
  resendBranchTitle.value = ''

  // Check if this message has descendants
  const hasDesc = await store.checkHasDescendants(sourceMessage.id)

  if (!hasDesc) {
    // No descendants — resend immediately
    await resendImmediate()
  } else {
    // Has descendants — show dialog
    showResendDialog.value = true
  }
}

async function resendImmediate() {
  if (!resendSourceParentId.value || !resendSourceContent.value) return

  // Navigate to parent of source user message
  store.setActiveMessage(resendSourceParentId.value)

  // Send with same content
  await handleSendMessage(resendSourceContent.value, null, false, 'standard')

  toast.show('Message resent')
  closeResendDialog()
}

async function confirmResendDeleteSubsequent() {
  if (!resendingMessageId.value || !resendSourceParentId.value || !resendSourceContent.value) return

  const content = resendSourceContent.value
  const parentId = resendSourceParentId.value

  // Delete the source user message subtree
  await store.deleteMessageSubtree(resendingMessageId.value)

  // Navigate to parent
  store.setActiveMessage(parentId)

  // Send with same content
  await handleSendMessage(content, null, false, 'standard')

  toast.show('Message resent')
  closeResendDialog()
}

async function confirmResendNewBranch() {
  if (!resendSourceParentId.value || !resendSourceContent.value) return

  const content = resendSourceContent.value
  const parentId = resendSourceParentId.value

  // Set up pending branch state
  pendingBranchFromId.value = parentId
  pendingBranchTitle.value = resendBranchTitle.value.trim() || 'Resent'

  // Navigate to parent
  store.setActiveMessage(parentId)

  // Send message (handleSendMessage already handles pending branch state)
  await handleSendMessage(content, null, false, 'standard')

  toast.show('Resent as new branch')
  closeResendDialog()
}

function closeResendDialog() {
  showResendDialog.value = false
  resendingMessageId.value = null
  resendSourceContent.value = ''
  resendSourceParentId.value = null
  resendBranchTitle.value = ''
}

// ========== Delete Handlers ==========

function openDeleteDialog(messageId: string) {
  deletingMessageId.value = messageId
  deleteSubtreeCount.value = store.getSubtreeCount(messageId)
  showDeleteDialog.value = true
}

async function confirmDelete() {
  if (!deletingMessageId.value) return

  await store.deleteMessageSubtree(deletingMessageId.value)
  closeDeleteDialog()
  toast.show('Message deleted')
}

function closeDeleteDialog() {
  showDeleteDialog.value = false
  deletingMessageId.value = null
  deleteSubtreeCount.value = 0
}

// ========== Delete Branch Handlers ==========

async function handleRenameBranch(branchId: string, newTitle: string) {
  await store.setBranchTitle(branchId, newTitle)
}

function openDeleteBranchDialog(branchId: string, depth: number) {
  deletingBranchId.value = branchId
  deletingBranchDepth.value = depth
  if (depth === 0) {
    deletingBranchMessageCount.value = store.messages.length
  } else {
    deletingBranchMessageCount.value = store.getSubtreeCount(branchId)
  }
  showDeleteBranchDialog.value = true
}

async function confirmDeleteBranch() {
  if (!deletingBranchId.value) return

  if (deletingBranchDepth.value === 0) {
    const conversationId = store.activeConversation?.id
    if (conversationId) {
      await store.removeConversation(conversationId)
      toast.show('Conversation deleted')
      router.push({ name: 'home' })
    }
  } else {
    await store.deleteMessageSubtree(deletingBranchId.value)
    toast.show('Branch deleted')
  }

  closeDeleteBranchDialog()
}

function closeDeleteBranchDialog() {
  showDeleteBranchDialog.value = false
  deletingBranchId.value = null
  deletingBranchDepth.value = 0
  deletingBranchMessageCount.value = 0
}

// Expose reserved functions for potential future use
defineExpose({
  toggleSplitView,
  dismissError,
})
</script>

<template>
  <div class="conversation-page">
    <!-- Halftone Background -->
    <HalftoneBackground />

    <!-- Top Navigation Bar -->
    <TopNavBar />

    <!-- Header -->
    <header class="conversation-header">
      <div class="header-left">
        <!-- Back button -->
        <button
          data-testid="back-btn"
          class="icon-btn"
          @click="goBack"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="icon" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clip-rule="evenodd" />
          </svg>
        </button>

        <!-- Mobile sidebar toggle -->
        <button
          v-if="isMobile"
          data-testid="toggle-sidebar-btn"
          class="icon-btn"
          @click="toggleSidebar"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="icon" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clip-rule="evenodd" />
          </svg>
        </button>

        <!-- Editable conversation title -->
        <div class="title-container">
          <input
            v-if="isEditingTitle"
            ref="titleInputRef"
            v-model="editedTitle"
            class="title-input"
            data-testid="conversation-title-input"
            @blur="saveTitle"
            @keydown="handleTitleKeydown"
          />
          <h1
            v-else
            class="conversation-title"
            data-testid="conversation-title"
            title="Click to edit title"
            @click="startEditingTitle"
          >
            {{ store.activeConversation?.title ?? 'Loading...' }}
          </h1>
          <button
            v-if="!isEditingTitle && store.activeConversation"
            class="edit-title-btn"
            title="Edit title"
            @click="startEditingTitle"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="icon-sm" viewBox="0 0 20 20" fill="currentColor">
              <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
            </svg>
          </button>
        </div>
      </div>

      <div class="header-right">
        <!-- View Mode Toggle -->
        <div class="view-mode-toggle" data-testid="view-mode-toggle">
          <button
            data-testid="view-mode-tree"
            class="view-mode-btn"
            :class="{ active: viewMode === 'tree' }"
            @click="setViewMode('tree')"
          >
            Tree
          </button>
          <button
            data-testid="view-mode-split"
            class="view-mode-btn split"
            :class="{ active: viewMode === 'split' }"
            @click="setViewMode('split')"
          >
            Split
          </button>
          <button
            data-testid="view-mode-graph"
            class="view-mode-btn graph"
            :class="{ active: viewMode === 'graph' }"
            @click="setViewMode('graph')"
          >
            Graph
          </button>
        </div>

        <!-- Swap Panes button (only visible in split view, but keeps space) -->
        <button
          data-testid="swap-panes-btn"
          class="icon-btn"
          :class="{ 'visually-hidden': !isSplitViewEnabled }"
          title="Swap panes"
          :disabled="!isSplitViewEnabled"
          @click="handleSwapPanes"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="icon" viewBox="0 0 20 20" fill="currentColor">
            <path d="M8 5a1 1 0 100 2h5.586l-1.293 1.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 00-1.414 1.414L13.586 5H8zM12 15a1 1 0 100-2H6.414l1.293-1.293a1 1 0 10-1.414-1.414l-3 3a1 1 0 000 1.414l3 3a1 1 0 001.414-1.414L6.414 15H12z" />
          </svg>
        </button>

        <!-- Search button -->
        <button
          data-testid="search-btn"
          class="icon-btn"
          title="Search (⌘F)"
          @click="openSearch"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="icon" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clip-rule="evenodd" />
          </svg>
        </button>

              </div>
    </header>

    <!-- Loading State -->
    <div v-if="store.isLoadingMessages" class="loading-container">
      <div class="spinner-lg"></div>
    </div>

    <!-- Conversation Not Found State -->
    <div v-else-if="conversationNotFound" class="not-found-container" data-testid="conversation-not-found">
      <div class="not-found-content">
        <svg xmlns="http://www.w3.org/2000/svg" class="not-found-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <h2 class="not-found-title">Conversation Not Found</h2>
        <p class="not-found-text">The conversation you're looking for doesn't exist or has been deleted.</p>
        <button
          data-testid="go-home-btn"
          class="btn btn-primary"
          @click="goBack"
        >
          Go to Home
        </button>
      </div>
    </div>

    <!-- Main Content -->
    <div v-else class="main-container">
      <!-- Breadcrumbs - Full Width -->
      <PathBreadcrumbs
        v-if="!isGraphView && !isSplitViewEnabled && store.timeline.length > 0"
        class="full-width-breadcrumbs"
        :path="store.timeline"
        :active-message-id="store.activeMessageId"

        @navigate="handleNavigateToMessage"
      />

      <!-- Inner container for sidebar and main areas -->
      <div class="main-container-inner">
        <!-- Sidebar (Tree Navigation) -->
        <!-- Mobile: use v-if for overlay behavior -->
        <!-- Desktop: always render, animate width -->
        <aside
        v-if="isMobile ? store.isSidebarOpen : true"
        class="tree-sidebar"
        :class="{
          'mobile': isMobile,
          'resizing': isDraggingSidebar,
          'collapsed': !isMobile && !store.isSidebarOpen,
          'day-mode': themeStore.isDayMode
        }"
        :style="!isMobile && store.isSidebarOpen ? { width: `${sidebarWidth}px` } : undefined"
        data-testid="tree-sidebar"
      >
        <!-- Sidebar Header -->
        <div class="sidebar-header">
          <div class="sidebar-header-content">
            <h2 class="sidebar-title">Conversation Tree</h2>
            <div class="sidebar-header-actions">
              <!-- Focused pane indicator in split view -->
              <span
                v-if="isSplitViewEnabled"
                class="pane-indicator"
                :class="splitViewStore.focusedPane === 'A' ? 'pane-a' : 'pane-b'"
              >
                → Pane {{ splitViewStore.focusedPane }}
              </span>
              <!-- Collapse button for desktop -->
              <button
                v-if="!isMobile"
                class="sidebar-collapse-btn"
                data-testid="sidebar-collapse-btn"
                title="Collapse sidebar"
                @click="toggleSidebar"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="icon" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clip-rule="evenodd" />
                </svg>
              </button>
              <!-- Close button for mobile -->
              <button
                v-if="isMobile"
                class="sidebar-close-btn"
                data-testid="sidebar-close-btn"
                @click="toggleSidebar"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="icon" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <!-- Pending branch preview -->
        <Transition name="pending-branch">
          <div
            v-if="pendingBranchFromId"
            class="pending-branch-preview"
            :class="{ 'is-active': store.activeMessageId === pendingBranchFromId }"
            @click="goToPendingBranch"
          >
            <div class="pending-branch-indicator">
              <span class="pending-branch-dot"></span>
            </div>
            <div class="pending-branch-info">
              <span class="pending-branch-title">
                {{ pendingBranchTitle || 'New branch' }}
              </span>
              <span class="pending-branch-hint">
                {{ store.activeMessageId === pendingBranchFromId
                  ? 'Type your first message below...'
                  : 'Click to return to this branch' }}
              </span>
            </div>
            <button class="pending-branch-dismiss" title="Cancel branch" @click.stop="cancelPendingBranch">
              &times;
            </button>
          </div>
        </Transition>

        <!-- Tree Content -->
        <div class="tree-content">
          <MessageTree
            v-if="hasMessages"
            ref="treeRef"
            :messages="store.messages"
            :message-map="store.messageMap"
            :children-map="store.childrenMap"
            :root-messages="store.rootMessages"
            :active-message-id="store.activeMessageId"
            :timeline-ids="timelineIds"
    
            @select="handleSelectMessage"
            @delete-branch="openDeleteBranchDialog"
            @rename-branch="handleRenameBranch"
          />
          <div v-else class="empty-tree">
            No messages yet. Start typing below!
          </div>
        </div>

        <!-- Resize handle -->
        <div
          v-if="!isMobile"
          class="sidebar-resize-handle"
          @mousedown="startSidebarResize"
        >
          <div class="sidebar-handle"></div>
        </div>
      </aside>

      <!-- Mobile sidebar overlay -->
      <div
        v-if="isMobile && store.isSidebarOpen"
        class="sidebar-overlay"
        @click="toggleSidebar"
      ></div>

      <!-- Expand tab (shows when sidebar is collapsed on desktop) -->
      <Transition name="expand-tab">
        <button
          v-if="!isMobile && !store.isSidebarOpen"
          class="sidebar-expand-tab"
          data-testid="sidebar-expand-tab"
          title="Expand sidebar"
          @click="toggleSidebar"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="icon" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clip-rule="evenodd" />
          </svg>
        </button>
      </Transition>

      <!-- Main Area - Graph View -->
      <main v-if="isGraphView" class="main-area graph-view" data-testid="graph-view-container">
        <GraphView
          :messages="store.messages"
          :active-message-id="store.activeMessageId"
          :highlighted-message-id="highlightedMessageId"
          :branch-color-map="treeBranchColorMap"
          :timeline-ids="timelineIds"
  
          @select="handleGraphNodeSelect"
          @go-to-tree="handleGraphGoToTree"
          @go-to-split="handleGraphGoToSplit"
        />
      </main>

      <!-- Main Area - Single View -->
      <main v-else-if="!isSplitViewEnabled" class="main-area">
        <!-- Timeline -->
        <div class="timeline-container">
          <MessageTimeline
            ref="timelineRef"
            :timeline="store.timeline"
            :active-message-id="store.activeMessageId"
            :children-map="store.childrenMap"
            :is-streaming="store.isStreaming"
            :streaming-message-id="store.streamingMessageId"
            :get-message-content="store.getMessageContent"
            :highlighted-message-id="highlightedMessageId"
            :branch-color-map="treeBranchColorMap"
    
            :new-message-ids="store.newMessageIds"
            :has-pending-branch="!!pendingBranchFromId"
            @select="handleSelectMessage"
            @branch="openBranchDialog"
            @edit="openEditDialog"
            @delete="openDeleteDialog"
            @resend="openResendDialog"
            @toggle-exclude="store.toggleMessageExclusion"
            @animation-complete="store.clearNewMessageId"
          />
        </div>

        <!-- Error Banner (from store.streamingError) -->
        <div
          v-if="store.streamingError"
          class="error-banner"
          data-testid="error-banner"
        >
          <div class="error-banner-content">
            <div class="error-banner-message">
              <svg xmlns="http://www.w3.org/2000/svg" class="icon" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
              </svg>
              <div class="error-text">
                <span>{{ store.streamingError.message }}</span>
                <a
                  v-if="store.streamingError.type === 'auth'"
                  href="https://nano-gpt.com/api"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="error-link"
                >Get a NanoGPT API key</a>
              </div>
            </div>
            <div class="error-banner-actions">
              <button
                v-if="store.streamingError.type === 'auth'"
                data-testid="set-api-key-btn"
                class="btn btn-primary-action"
                @click="goToSettings"
              >
                Set API key now
              </button>
              <button
                v-else
                data-testid="error-banner-settings-link"
                class="btn btn-error-action"
                @click="goToSettings"
              >
                Go to Settings
              </button>
              <button
                data-testid="error-banner-dismiss"
                class="error-dismiss-btn"
                @click="dismissStreamingError"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="icon" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <!-- Streaming Indicator -->
        <div
          v-if="store.isStreaming"
          class="streaming-indicator"
          data-testid="streaming-indicator"
        >
          <div class="streaming-content">
            <div class="spinner-sm"></div>
            <span>Generating response...</span>
          </div>
        </div>

        <!-- Composer -->
        <MessageComposer
          :disabled="false"
          :is-streaming="store.isStreaming"
          :conversation-default-model="store.activeConversation?.defaultModel"
          :has-api-key="apiKeyAvailable"
          :is-online="isOnline"
          @send="handleSendMessage"
          @stop-generation="handleStopGeneration"
          @update-default-model="handleUpdateDefaultModel"
        />

        <!-- Context Builder Panel -->
        <ContextBuilder
          :timeline="store.timeline"
          :message-map="store.messageMap"
          :active-message-id="store.activeMessageId"
        />
      </main>

      <!-- Main Area - Split View -->
      <div v-else class="split-view-wrapper">
      <div
        class="split-view-container"
        :class="{ 'is-dragging': isDraggingDivider }"
        data-testid="split-view-container"
      >
        <!-- Pane A -->
        <SplitViewPane
          ref="splitPaneARef"
          pane-id="A"
          :timeline="paneATimeline"
          :active-message-id="splitViewStore.paneA.activeMessageId"
          :children-map="store.childrenMap"
          :is-focused="splitViewStore.isPaneFocused('A')"
          :is-streaming="splitViewStore.isPaneStreaming('A')"
          :streaming-message-id="splitViewStore.isPaneStreaming('A') ? store.streamingMessageId : null"
          :can-send="splitViewStore.canPaneSend('A')"
          :conversation-default-model="store.activeConversation?.defaultModel ?? null"
          :pane-model="splitViewStore.getPaneModel('A')"
          :get-message-content="store.getMessageContent"
          :highlighted-message-id="null"
          :initial-scroll-target="initialScrollTargetPaneA"
          :initial-scroll-position="savedScrollPositionPaneA"
          :branch-color-map="treeBranchColorMap"
  
          :new-message-ids="store.newMessageIds"
          class="split-pane-wrapper split-pane-a"
          :style="{ width: `calc(${splitDividerPosition}% - 3px)` }"
          @focus="() => handlePaneFocus('A')"
          @select-message="(id: string) => handlePaneSelectMessage('A', id)"
          @branch="openBranchDialog"
          @edit="openEditDialog"
          @delete="openDeleteDialog"
          @resend="openResendDialog"
          @toggle-exclude="store.toggleMessageExclusion"
          @send="handleSendMessage"
          @stop-generation="handleStopGeneration"
          @update-pane-model="handleUpdatePaneModel"
          @animation-complete="store.clearNewMessageId"
        />

        <!-- Resizable Divider -->
        <div
          class="split-divider"
          data-testid="split-divider"
          @mousedown="startDividerDrag"
          @dblclick="resetDividerPosition"
        >
          <div class="divider-handle"></div>
        </div>

        <!-- Pane B -->
        <SplitViewPane
          ref="splitPaneBRef"
          pane-id="B"
          :timeline="paneBTimeline"
          :active-message-id="splitViewStore.paneB.activeMessageId"
          :children-map="store.childrenMap"
          :is-focused="splitViewStore.isPaneFocused('B')"
          :is-streaming="splitViewStore.isPaneStreaming('B')"
          :streaming-message-id="splitViewStore.isPaneStreaming('B') ? store.streamingMessageId : null"
          :can-send="splitViewStore.canPaneSend('B')"
          :conversation-default-model="store.activeConversation?.defaultModel ?? null"
          :pane-model="splitViewStore.getPaneModel('B')"
          :get-message-content="store.getMessageContent"
          :highlighted-message-id="null"
          :initial-scroll-target="initialScrollTargetPaneB"
          :initial-scroll-position="savedScrollPositionPaneB"
          :branch-color-map="treeBranchColorMap"
  
          :new-message-ids="store.newMessageIds"
          class="split-pane-wrapper split-pane-b"
          :style="{ width: `calc(${100 - splitDividerPosition}% - 3px)` }"
          @focus="() => handlePaneFocus('B')"
          @select-message="(id: string) => handlePaneSelectMessage('B', id)"
          @branch="openBranchDialog"
          @edit="openEditDialog"
          @delete="openDeleteDialog"
          @resend="openResendDialog"
          @toggle-exclude="store.toggleMessageExclusion"
          @send="handleSendMessage"
          @stop-generation="handleStopGeneration"
          @update-pane-model="handleUpdatePaneModel"
          @animation-complete="store.clearNewMessageId"
        />
      </div>

      <!-- Shared Context Builder for Split View -->
      <ContextBuilder
        :timeline="store.timeline"
        :message-map="store.messageMap"
        :active-message-id="store.activeMessageId"
      />
      </div>
      </div>
    </div>

    <!-- Branch Dialog -->
    <div
      v-if="showBranchDialog"
      class="dialog-overlay"
      data-testid="branch-dialog"
      @click.self="closeBranchDialog"
    >
      <div class="dialog-content dialog-md">
        <h2 class="dialog-title">Create Branch</h2>

        <div class="form-group">
          <label class="input-label">Branch Title (optional)</label>
          <input
            ref="branchTitleInputRef"
            v-model="branchTitle"
            data-testid="branch-title-input"
            type="text"
            placeholder="e.g., Alternative approach..."
            class="input"
            @keydown.enter="createBranch"
          />
        </div>

        <p class="dialog-hint">
          After creating the branch, type your first message in the composer below.
        </p>

        <div class="dialog-actions">
          <button
            class="btn btn-ghost"
            @click="closeBranchDialog"
          >
            Cancel
          </button>
          <button
            data-testid="create-branch-btn"
            class="btn btn-primary"
            @click="createBranch"
          >
            Create Branch
          </button>
        </div>
      </div>
    </div>

    <!-- Simple Edit Dialog (no descendants) -->
    <div
      v-if="showEditDialog"
      class="dialog-overlay"
      data-testid="edit-dialog"
      @click.self="closeEditDialogs"
    >
      <div class="dialog-content dialog-lg">
        <h2 class="dialog-title">Edit Message</h2>

        <div class="form-group">
          <label class="input-label">Message Content</label>
          <textarea
            v-model="editContent"
            data-testid="edit-content-input"
            rows="6"
            class="input textarea"
            @keydown.meta.enter="saveSimpleEdit"
            @keydown.ctrl.enter="saveSimpleEdit"
          ></textarea>
        </div>

        <div class="dialog-actions">
          <button
            class="btn btn-ghost"
            @click="closeEditDialogs"
          >
            Cancel
          </button>
          <button
            data-testid="save-edit-btn"
            class="btn btn-primary"
            :disabled="!editContent.trim()"
            @click="saveSimpleEdit"
          >
            Save Edit
          </button>
        </div>
      </div>
    </div>

    <!-- Edit Option A/B Dialog (has descendants) -->
    <div
      v-if="showEditOptionDialog"
      class="dialog-overlay"
      data-testid="edit-option-dialog"
      @click.self="closeEditDialogs"
    >
      <div class="dialog-content dialog-xl">
        <h2 class="dialog-title">Edit Message with Descendants</h2>
        <p class="dialog-description">
          This message has replies below it. Choose how you want to handle the edit:
        </p>

        <div class="form-group">
          <label class="input-label">New Content</label>
          <textarea
            v-model="editContent"
            data-testid="edit-option-content-input"
            rows="4"
            class="input textarea"
          ></textarea>
        </div>

        <!-- Option A/B selection -->
        <div class="edit-options">
          <!-- Option A -->
          <div class="edit-option option-danger">
            <div class="option-header">
              <div>
                <h3 class="option-title">Option A: Rewrite History</h3>
                <p class="option-description">
                  Edit this message and <span class="text-danger">delete all messages after it</span>.
                  The conversation will continue from this edited message.
                </p>
              </div>
            </div>
            <button
              data-testid="edit-option-a-btn"
              class="btn btn-danger"
              :disabled="!editContent.trim()"
              @click="saveEditOptionA"
            >
              Rewrite History
            </button>
          </div>

          <!-- Option B -->
          <div class="edit-option option-success">
            <div class="option-header">
              <h3 class="option-title">Option B: Create New Branch</h3>
              <p class="option-description">
                Keep the original message and its replies intact. Create a
                <span class="text-success">new branch</span> with your edited version.
              </p>
            </div>
            <div class="form-group small">
              <label class="input-label">Branch Title (optional)</label>
              <input
                v-model="editBranchTitle"
                data-testid="edit-branch-title-input"
                type="text"
                placeholder="Edited"
                class="input"
              />
            </div>
            <button
              data-testid="edit-option-b-btn"
              class="btn btn-primary"
              :disabled="!editContent.trim()"
              @click="saveEditOptionB"
            >
              Create New Branch
            </button>
          </div>
        </div>

        <div class="dialog-actions">
          <button
            class="btn btn-ghost"
            @click="closeEditDialogs"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>

    <!-- Resend Dialog -->
    <div
      v-if="showResendDialog"
      class="dialog-overlay"
      data-testid="resend-dialog"
      @click.self="closeResendDialog"
    >
      <div class="dialog-content dialog-xl">
        <h2 class="dialog-title">Resend Message</h2>
        <p class="dialog-description">
          This message has replies below it. Choose how to resend:
        </p>

        <div class="edit-options">
          <!-- Option A: Delete subsequent -->
          <div class="edit-option option-danger">
            <div class="option-header">
              <div>
                <h3 class="option-title">Delete Subsequent Messages</h3>
                <p class="option-description">
                  <span class="text-danger">Delete all messages after this one</span> and resend to get a new response.
                </p>
              </div>
            </div>
            <button
              data-testid="resend-option-a-btn"
              class="btn btn-danger"
              @click="confirmResendDeleteSubsequent"
            >
              Delete &amp; Resend
            </button>
          </div>

          <!-- Option B: New branch -->
          <div class="edit-option option-success">
            <div class="option-header">
              <h3 class="option-title">Create New Branch</h3>
              <p class="option-description">
                Keep all existing messages intact. Create a
                <span class="text-success">new branch</span> and resend from there.
              </p>
            </div>
            <div class="form-group small">
              <label class="input-label">Branch Title (optional)</label>
              <input
                v-model="resendBranchTitle"
                data-testid="resend-branch-title-input"
                type="text"
                placeholder="Resent"
                class="input"
                @keydown.enter.prevent="confirmResendNewBranch"
              />
            </div>
            <button
              data-testid="resend-option-b-btn"
              class="btn btn-primary"
              @click="confirmResendNewBranch"
            >
              Branch &amp; Resend
            </button>
          </div>
        </div>

        <div class="dialog-actions">
          <button
            class="btn btn-ghost"
            @click="closeResendDialog"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>

    <!-- Search Panel -->
    <SearchPanel
      :messages="store.messages"
      :is-open="showSearchPanel"
      @close="closeSearch"
      @select="handleSearchSelect"
    />

    <!-- Delete Confirmation Dialog -->
    <div
      v-if="showDeleteDialog"
      class="dialog-overlay"
      data-testid="delete-dialog"
      @click.self="closeDeleteDialog"
    >
      <div class="dialog-content dialog-md">
        <h2 class="dialog-title">Delete Message</h2>

        <p class="dialog-text">
          <template v-if="deleteSubtreeCount > 1">
            This will delete <span class="text-danger font-semibold">{{ deleteSubtreeCount }} messages</span>
            (this message and all its replies).
          </template>
          <template v-else>
            Are you sure you want to delete this message?
          </template>
        </p>

        <p class="dialog-text-muted">
          This action cannot be undone.
        </p>

        <div class="dialog-actions">
          <button
            class="btn btn-ghost"
            @click="closeDeleteDialog"
          >
            Cancel
          </button>
          <button
            data-testid="confirm-delete-message-btn"
            class="btn btn-danger"
            @click="confirmDelete"
          >
            Delete
          </button>
        </div>
      </div>
    </div>

    <!-- Delete Branch Confirmation Dialog -->
    <div
      v-if="showDeleteBranchDialog"
      class="dialog-overlay"
      data-testid="delete-branch-dialog"
      @click.self="closeDeleteBranchDialog"
    >
      <div class="dialog-content dialog-md">
        <h2 class="dialog-title">
          {{ deletingBranchDepth === 0 ? 'Delete Conversation' : 'Delete Branch' }}
        </h2>

        <p class="dialog-text">
          <template v-if="deletingBranchDepth === 0">
            This will delete the <span class="text-danger font-semibold">entire conversation</span>
            and all <span class="text-danger font-semibold">{{ deletingBranchMessageCount }} messages</span>.
          </template>
          <template v-else>
            This will delete this branch and
            <span class="text-danger font-semibold">{{ deletingBranchMessageCount }}
            {{ deletingBranchMessageCount === 1 ? 'message' : 'messages' }}</span>.
          </template>
        </p>

        <p class="dialog-text-muted">
          This action cannot be undone.
        </p>

        <div class="dialog-actions">
          <button
            class="btn btn-ghost"
            @click="closeDeleteBranchDialog"
          >
            Cancel
          </button>
          <button
            data-testid="confirm-delete-branch-btn"
            class="btn btn-danger"
            @click="confirmDeleteBranch"
          >
            {{ deletingBranchDepth === 0 ? 'Delete Conversation' : 'Delete Branch' }}
          </button>
        </div>
      </div>
    </div>

    <!-- API Key Prompt Overlay -->
    <div
      v-if="showApiKeyPrompt"
      class="api-key-overlay"
      data-testid="api-key-prompt"
    >
      <div class="api-key-prompt">
        <div class="prompt-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
          </svg>
        </div>
        <h2 class="prompt-title">API Key Required</h2>
        <p class="prompt-description">
          To start chatting, you'll need to configure your NanoGPT API key in the settings.
        </p>
        <div class="prompt-actions">
          <button
            class="btn btn-primary btn-lg"
            data-testid="go-to-settings-btn"
            @click="goToSettings"
          >
            Go to Settings
          </button>
          <button
            class="btn btn-ghost"
            @click="showApiKeyPrompt = false"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.conversation-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  padding-top: 60px; /* Account for fixed navbar */
  background: transparent;
  color: var(--text-primary);
  transition: color 0.4s ease;
}

/* Header */
.conversation-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  background: transparent;
  border-bottom: 1px solid var(--glass-border);
  position: relative;
  z-index: 1;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex: 1;
  min-width: 0;
  margin-right: 1rem;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}

.title-container {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  margin-left: 0.5rem;
  min-width: 0;
  flex: 1;
}

.conversation-title {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-primary);
  cursor: pointer;
  padding: 0.25rem 0.5rem;
  border-radius: var(--radius-md);
  transition: background var(--transition-fast);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conversation-title:hover {
  background: var(--overlay-light);
}

.title-input {
  font-size: 1.125rem;
  font-weight: 600;
  font-family: var(--font-sans);
  color: var(--text-primary);
  background: var(--overlay-dark);
  border: 1px solid var(--accent);
  border-radius: var(--radius-md);
  padding: 0.25rem 0.5rem;
  outline: none;
  width: 100%;
  max-width: 300px;
}

.title-input:focus {
  box-shadow: 0 0 0 3px rgba(var(--accent-rgb), 0.2);
}

.edit-title-btn {
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
  transition: all var(--transition-fast);
  flex-shrink: 0;
}

.title-container:hover .edit-title-btn {
  opacity: 1;
}

.edit-title-btn:hover {
  background: var(--overlay-light);
  color: var(--text-primary);
}

/* Mobile: two-row header and always-visible edit button */
@media (max-width: 768px) {
  .conversation-header {
    flex-wrap: wrap;
    gap: 0.375rem;
    padding: 0.5rem 0.75rem;
  }

  .header-left {
    flex-basis: 100%;
    margin-right: 0;
    justify-content: center;
  }

  .title-container {
    flex: 0 1 auto;
    max-width: 60%;
  }

  .header-right {
    flex-basis: 100%;
    justify-content: center;
  }

  /* Don't reserve space for hidden swap button on mobile */
  .header-right .icon-btn.visually-hidden {
    display: none;
  }

  .edit-title-btn {
    opacity: 0.6;
  }
  .edit-title-btn:active {
    opacity: 1;
    color: var(--accent);
  }
}

.icon-sm {
  width: 0.875rem;
  height: 0.875rem;
}

/* Icon Button */
.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: var(--radius-md);
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition-normal);
}

.icon-btn:hover {
  background: var(--overlay-light);
  color: var(--text-primary);
}

.icon-btn.active {
  background: rgba(var(--accent-rgb), 0.15);
  color: var(--accent);
}

.icon-btn.visually-hidden {
  visibility: hidden;
  pointer-events: none;
}

.icon-btn:not(.visually-hidden) {
  visibility: visible;
}

.icon {
  width: 1.25rem;
  height: 1.25rem;
}

/* View Mode Toggle */
.view-mode-toggle {
  display: flex;
  align-items: center;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 0.125rem;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.view-mode-btn {
  padding: 0.375rem 0.625rem;
  font-size: 0.75rem;
  font-weight: 500;
  font-family: var(--font-sans);
  border-radius: var(--radius-sm);
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition-normal);
}

.view-mode-btn:hover {
  color: var(--text-primary);
}

.view-mode-btn.active {
  background: var(--accent);
  color: var(--bg-primary);
}

.view-mode-btn.split.active {
  background: var(--branch-blue);
  color: var(--bg-primary);
}

.view-mode-btn.graph.active {
  background: var(--branch-pink);
  color: var(--bg-primary);
}

/* Loading State */
.loading-container {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.spinner-lg {
  width: 2rem;
  height: 2rem;
  border: 2px solid var(--border-subtle);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.spinner-sm {
  width: 1rem;
  height: 1rem;
  border: 2px solid rgba(var(--accent-rgb), 0.3);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* Not Found State */
.not-found-container {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.not-found-content {
  text-align: center;
}

.not-found-icon {
  width: 4rem;
  height: 4rem;
  color: var(--text-muted);
  margin: 0 auto 1rem;
}

.not-found-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 0.5rem;
}

.not-found-text {
  color: var(--text-secondary);
  margin-bottom: 1.5rem;
}

/* Main Container */
.main-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  overscroll-behavior: none;
  position: relative;
  z-index: 1;
}

.main-container-inner {
  flex: 1;
  display: flex;
  overflow: hidden;
}

/* Full Width Breadcrumbs */
.full-width-breadcrumbs {
  width: 100%;
  z-index: 10;
  flex-shrink: 0;
}

/* Sidebar */
.tree-sidebar {
  position: relative;
  flex-shrink: 0;
  background: rgba(0, 0, 0, 0.2);
  backdrop-filter: blur(8px);
  border-right: 1px solid var(--glass-border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: width 0.3s ease, border-right-width 0.3s ease;
}

.tree-sidebar.day-mode {
  background: rgba(255, 255, 255, 0.2);
}

.tree-sidebar.resizing {
  user-select: none;
  transition: none; /* Disable transition while resizing */
}

.tree-sidebar.collapsed {
  width: 0 !important;
  min-width: 0;
  border-right-width: 0;
}

.tree-sidebar.collapsed .sidebar-header,
.tree-sidebar.collapsed .tree-content,
.tree-sidebar.collapsed .sidebar-resize-handle {
  opacity: 0;
  pointer-events: none;
}

.tree-sidebar.mobile {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  width: 100% !important;
  z-index: 50;
  padding-top: 60px; /* Account for nav bar */
}

.tree-sidebar.hidden {
  display: none;
}

/* Sidebar resize handle */
.sidebar-resize-handle {
  position: absolute;
  top: 0;
  right: 0;
  width: 6px;
  height: 100%;
  cursor: col-resize;
  z-index: 10;
  background: var(--glass-border);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background var(--transition-fast);
}

.sidebar-resize-handle:hover,
.tree-sidebar.resizing .sidebar-resize-handle {
  background: var(--accent);
}

.sidebar-handle {
  width: 2px;
  height: 40px;
  background: var(--text-muted);
  border-radius: 1px;
  transition: background var(--transition-fast);
}

.sidebar-resize-handle:hover .sidebar-handle,
.tree-sidebar.resizing .sidebar-handle {
  background: var(--bg-primary);
}

.sidebar-header {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--glass-border);
  background: transparent;
}

.sidebar-header-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.sidebar-header-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.sidebar-close-btn,
.sidebar-collapse-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: var(--radius-md);
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition-normal);
}

.sidebar-close-btn:hover,
.sidebar-collapse-btn:hover {
  background: var(--overlay-light);
  color: var(--text-primary);
}

/* Expand tab (shows when sidebar is collapsed) */
.sidebar-expand-tab {
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 24px;
  height: 90px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--glass-bg);
  backdrop-filter: blur(8px);
  border: 1px solid var(--glass-border);
  border-left: none;
  border-radius: 0 var(--radius-md) var(--radius-md) 0;
  color: var(--text-muted);
  cursor: pointer;
  z-index: 10;
  transition: all var(--transition-normal);
}

.sidebar-expand-tab:hover {
  width: 28px;
  background: var(--accent);
  border-color: var(--accent);
  color: var(--bg-primary);
}

.sidebar-expand-tab .icon {
  width: 1rem;
  height: 1rem;
}

.sidebar-title {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-primary);
}

.pane-indicator {
  font-size: 0.75rem;
  padding: 0.125rem 0.5rem;
  border-radius: var(--radius-sm);
  font-weight: 500;
}

.pane-indicator.pane-a {
  background: var(--accent);
  color: var(--bg-primary);
}

.pane-indicator.pane-b {
  background: var(--branch-blue);
  color: var(--bg-primary);
}

.tree-content {
  flex: 1;
  min-height: 0;
  min-width: 270px;
  overflow-y: auto;
  padding: 0.5rem;
}

.empty-tree {
  padding: 1rem;
  text-align: center;
  font-size: 0.875rem;
  color: var(--text-muted);
}

.sidebar-overlay {
  position: fixed;
  inset: 0;
  z-index: 10;
  background: var(--overlay-dark);
  backdrop-filter: blur(4px);
}

/* Main Area */
.main-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.main-area.graph-view {
  overflow: hidden;
}

.timeline-container {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* Split View */
.split-view-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.split-view-container {
  flex: 1;
  display: flex;
  overflow: hidden;
  position: relative;
  min-height: 0;
}

.split-view-container.is-dragging {
  cursor: col-resize;
  user-select: none;
}

.split-pane-wrapper {
  flex-shrink: 0;
  min-width: 0;
  overflow: hidden;
}

.split-pane-a {
  border-right: none;
}

.split-pane-b {
  border-left: none;
}

/* Resizable Divider */
.split-divider {
  flex-shrink: 0;
  width: 6px;
  background: var(--border-subtle);
  cursor: col-resize;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background var(--transition-fast);
  position: relative;
  z-index: 5;
}

.split-divider:hover {
  background: var(--accent);
}

.split-divider:hover .divider-handle {
  background: var(--bg-primary);
}

.divider-handle {
  width: 2px;
  height: 40px;
  background: var(--text-muted);
  border-radius: 1px;
  transition: background var(--transition-fast);
}

.split-view-container.is-dragging .split-divider {
  background: var(--accent);
}

.split-view-container.is-dragging .divider-handle {
  background: var(--bg-primary);
}

/* Error Banner */
.error-banner {
  border-top: 1px solid var(--error);
  background: var(--glass-bg);
  backdrop-filter: blur(var(--glass-blur));
  padding: 0.75rem 1rem;
}

.error-banner-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.error-banner-message {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  color: var(--error);
  font-size: 0.875rem;
}

.error-text {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.error-help-text {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.error-link {
  color: var(--accent);
  text-decoration: underline;
}

.error-link:hover {
  color: var(--accent-hover);
}

.error-banner-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.btn-primary-action {
  padding: 0.375rem 0.75rem;
  background: var(--accent);
  color: var(--bg-primary);
  border: none;
  border-radius: var(--radius-md);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: background var(--transition-fast);
}

.btn-primary-action:hover {
  background: var(--accent-hover);
}

.btn-error-action {
  padding: 0.375rem 0.75rem;
  background: var(--error);
  color: white;
  border: none;
  border-radius: var(--radius-md);
  font-size: 0.875rem;
  cursor: pointer;
  transition: background var(--transition-fast);
}

.btn-error-action:hover {
  background: rgba(248, 113, 113, 0.4);
}

.error-dismiss-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: var(--error);
  cursor: pointer;
  padding: 0.25rem;
  transition: opacity var(--transition-fast);
}

.error-dismiss-btn:hover {
  opacity: 0.7;
}

/* Streaming Indicator */
.streaming-indicator {
  border-top: 1px solid rgba(var(--accent-rgb), 0.2);
  background: var(--glass-bg);
  backdrop-filter: blur(var(--glass-blur));
  padding: 0.5rem 1rem;
}

.streaming-content {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--accent);
  font-size: 0.875rem;
}

/* Dialog */
.dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--overlay-dark);
  backdrop-filter: blur(8px);
  padding: 1rem;
}

.dialog-content {
  width: 100%;
  background: var(--glass-bg-solid);
  backdrop-filter: blur(16px);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  padding: 1.5rem;
  box-shadow: var(--shadow-lg);
}

.dialog-md {
  max-width: 28rem;
}

.dialog-lg {
  max-width: 32rem;
}

.dialog-xl {
  max-width: 36rem;
}

.dialog-title {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 1rem;
}

.dialog-description {
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin-bottom: 1rem;
}

.dialog-text {
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin-bottom: 0.75rem;
}

.dialog-text-muted {
  font-size: 0.875rem;
  color: var(--text-muted);
  margin-bottom: 1rem;
}

.dialog-hint {
  font-size: 0.8125rem;
  color: var(--text-muted);
  margin-bottom: 1rem;
  padding: 0.5rem 0.75rem;
  background: rgba(var(--accent-rgb), 0.05);
  border-radius: var(--radius-md);
  border-left: 2px solid var(--accent);
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 1rem;
}

/* API Key Prompt Overlay */
.api-key-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--overlay-dark);
  backdrop-filter: blur(12px);
  padding: 1rem;
}

.api-key-prompt {
  text-align: center;
  max-width: 400px;
  padding: 2.5rem;
  background: var(--glass-bg-solid);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
}

.prompt-icon {
  display: flex;
  justify-content: center;
  color: var(--accent);
  margin-bottom: 1.5rem;
}

.prompt-icon svg {
  width: 48px;
  height: 48px;
}

.prompt-title {
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 0.75rem;
}

.prompt-description {
  font-size: 0.9375rem;
  color: var(--text-secondary);
  line-height: 1.6;
  margin-bottom: 1.5rem;
}

.prompt-actions {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.btn-lg {
  padding: 0.75rem 1.5rem;
  font-size: 1rem;
}

/* Form */
.form-group {
  margin-bottom: 1rem;
}

.form-group.small {
  margin-bottom: 0.75rem;
}

.input-label {
  display: block;
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin-bottom: 0.375rem;
}

.input {
  width: 100%;
  padding: 0.625rem 0.875rem;
  font-family: var(--font-sans);
  font-size: 0.875rem;
  color: var(--text-primary);
  background: var(--bg-card);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  transition: all var(--transition-normal);
}

.input::placeholder {
  color: var(--text-muted);
}

.input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(var(--accent-rgb), 0.1);
}

.textarea {
  resize: vertical;
  min-height: 4rem;
}

/* Buttons */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  font-family: var(--font-sans);
  font-size: 0.875rem;
  font-weight: 500;
  border-radius: var(--radius-md);
  border: 1px solid transparent;
  cursor: pointer;
  transition: all var(--transition-normal);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: linear-gradient(135deg, rgba(var(--accent-rgb), 0.95) 0%, rgba(var(--accent-rgb), 0.8) 100%);
  color: var(--bg-primary);
}

.btn-primary:hover:not(:disabled) {
  background: linear-gradient(135deg, rgba(var(--accent-rgb), 1) 0%, rgba(var(--accent-rgb), 0.9) 100%);
  transform: translateY(-1px);
}

.btn-ghost {
  background: transparent;
  color: var(--text-secondary);
}

.btn-ghost:hover:not(:disabled) {
  background: var(--overlay-light);
  color: var(--text-primary);
}

.btn-danger {
  background: var(--error);
  color: white;
}

.btn-danger:hover:not(:disabled) {
  background: var(--error);
}

/* Edit Options */
.edit-options {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.edit-option {
  padding: 1rem;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-subtle);
  transition: border-color var(--transition-normal);
}

.edit-option.option-danger:hover {
  border-color: var(--error);
}

.edit-option.option-success:hover {
  border-color: var(--accent);
}

.option-header {
  margin-bottom: 0.75rem;
}

.option-title {
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: 0.25rem;
}

.option-description {
  font-size: 0.875rem;
  color: var(--text-secondary);
}

/* Text Colors */
.text-danger {
  color: var(--error);
}

.text-success {
  color: var(--accent);
}

.font-semibold {
  font-weight: 600;
}

/* Day mode styles are handled globally in style.css */

/* Expand tab transition */
.expand-tab-enter-active {
  transition: transform 0.25s ease 0.2s, opacity 0.25s ease 0.2s;
}

.expand-tab-leave-active {
  transition: transform 0.15s ease, opacity 0.15s ease;
}

.expand-tab-enter-from,
.expand-tab-leave-to {
  transform: translateY(-50%) translateX(-100%);
  opacity: 0;
}

.expand-tab-enter-to,
.expand-tab-leave-from {
  transform: translateY(-50%) translateX(0);
  opacity: 1;
}

/* Pending branch preview */
.pending-branch-preview {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  margin: 0.375rem 0.5rem;
  padding: 0.5rem 0.75rem;
  border: 1px dashed rgba(var(--accent-rgb), 0.4);
  border-left: 3px solid var(--accent);
  border-radius: var(--radius-md);
  background: rgba(var(--accent-rgb), 0.05);
  cursor: pointer;
  flex-shrink: 0;
  overflow: hidden;
  transition: all var(--transition-fast);
}

.pending-branch-preview:hover {
  background: rgba(var(--accent-rgb), 0.1);
  border-color: rgba(var(--accent-rgb), 0.6);
}

.pending-branch-preview.is-active {
  border-style: solid;
  background: rgba(var(--accent-rgb), 0.08);
  box-shadow: 0 0 0 1px rgba(var(--accent-rgb), 0.2);
}

.pending-branch-dot {
  display: block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
  animation: pending-pulse 2s ease-in-out infinite;
}

@keyframes pending-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.75); }
}

.pending-branch-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  min-width: 0;
}

.pending-branch-title {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--accent);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pending-branch-hint {
  font-size: 0.6875rem;
  color: var(--text-muted);
}

.pending-branch-dismiss {
  flex-shrink: 0;
  width: 1.25rem;
  height: 1.25rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-size: 1rem;
  cursor: pointer;
  opacity: 0;
  transition: all var(--transition-fast);
}

.pending-branch-preview:hover .pending-branch-dismiss {
  opacity: 1;
}

.pending-branch-dismiss:hover {
  background: rgba(239, 68, 68, 0.15);
  color: var(--error, #ef4444);
}

/* Pending branch transition */
.pending-branch-enter-active {
  animation: pending-slide-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.pending-branch-leave-active {
  animation: pending-slide-out 0.25s ease-in forwards;
}

@keyframes pending-slide-in {
  from {
    opacity: 0;
    transform: translateX(-1rem) scaleY(0.8);
    max-height: 0;
  }
  to {
    opacity: 1;
    transform: translateX(0) scaleY(1);
    max-height: 5rem;
  }
}

@keyframes pending-slide-out {
  from {
    opacity: 1;
    transform: translateX(0);
    max-height: 5rem;
  }
  to {
    opacity: 0;
    transform: translateX(-1rem);
    max-height: 0;
    margin: 0;
    padding: 0;
  }
}
</style>
