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

import { ref, watch, onMounted, onUnmounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useConversationStore } from '@/stores/conversationStore'
import { useSplitViewStore, type PaneId } from '@/stores/splitViewStore'
import { useThemeStore } from '@/stores/themeStore'
import MessageTree from '@/components/MessageTree.vue'
import MessageTimeline from '@/components/MessageTimeline.vue'
import MessageComposer from '@/components/MessageComposer.vue'
import PathBreadcrumbs from '@/components/PathBreadcrumbs.vue'
import ContextBuilder from '@/components/ContextBuilder.vue'
import SearchPanel from '@/components/SearchPanel.vue'
import SplitViewPane from '@/components/SplitViewPane.vue'
import GraphView from '@/components/GraphView.vue'
import TopNavBar from '@/components/TopNavBar.vue'
import GridBackground from '@/components/GridBackground.vue'
import type { ContextResolverConfig } from '@/db'
import type { SearchPreset } from '@/api/nanogpt'
import { MissingApiKeyError } from '@/api/streamingService'

const props = defineProps<{
  id: string
}>()

const route = useRoute()
const router = useRouter()
const store = useConversationStore()
const splitViewStore = useSplitViewStore()
const themeStore = useThemeStore()

// View mode state: 'tree' | 'split' | 'graph'
type ViewMode = 'tree' | 'split' | 'graph'
const viewMode = ref<ViewMode>('tree')

// UI state
const isMobile = ref(false)
const showBranchDialog = ref(false)
const branchFromMessageId = ref<string | null>(null)
const branchTitle = ref('')
const branchContent = ref('')

// Edit dialog state
const showEditDialog = ref(false)
const editingMessageId = ref<string | null>(null)
const editContent = ref('')
const editHasDescendants = ref(false)
const showEditOptionDialog = ref(false)
const editBranchTitle = ref('')

// Delete confirmation state
const showDeleteDialog = ref(false)
const deletingMessageId = ref<string | null>(null)
const deleteSubtreeCount = ref(0)

// Search state
const showSearchPanel = ref(false)
const highlightedMessageId = ref<string | null>(null)

// Context configuration for the next message
const pendingContextConfig = ref<ContextResolverConfig | null>(null)

// Error state for displaying to user
const sendError = ref<string | null>(null)
const showApiKeyError = ref(false)

// Conversation not found state
const conversationNotFound = ref(false)

// Check if we're on mobile
function checkMobile() {
  isMobile.value = window.innerWidth < 768
  if (isMobile.value) {
    store.isSidebarOpen = false
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

// Update URL when active message changes
watch(
  () => store.activeMessageId,
  (newId) => {
    if (newId && newId !== route.query.message) {
      router.replace({
        query: { ...route.query, message: newId },
      })
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

// ========== View Mode Handlers ==========

function setViewMode(mode: ViewMode) {
  // Disable split view if switching away from it
  if (viewMode.value === 'split' && mode !== 'split') {
    const activeId = splitViewStore.disableSplitView()
    if (activeId) {
      store.setActiveMessage(activeId)
    }
  }

  // Enable split view if switching to it
  if (mode === 'split' && viewMode.value !== 'split') {
    splitViewStore.enableSplitView(store.activeMessageId)
  }

  viewMode.value = mode
  updateViewModeUrl()
}

function updateViewModeUrl() {
  if (viewMode.value === 'split') {
    const params = splitViewStore.toUrlParams()
    router.replace({
      query: { ...route.query, ...params, view: 'split', message: undefined },
    })
  } else if (viewMode.value === 'graph') {
    const { paneA, paneB, focus, ...rest } = route.query
    router.replace({ query: { ...rest, view: 'graph' } })
  } else {
    const { paneA, paneB, focus, view, ...rest } = route.query
    router.replace({ query: rest })
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

function updateSplitViewUrl() {
  if (splitViewStore.splitViewEnabled) {
    const params = splitViewStore.toUrlParams()
    router.replace({
      query: { ...route.query, ...params, message: undefined },
    })
  } else {
    // Remove split view params when disabled
    const { paneA, paneB, focus, ...rest } = route.query
    router.replace({ query: rest })
  }
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
  }, 2000)
}

// ========== Graph View Handlers ==========

function handleGraphNodeSelect(messageId: string) {
  // Set active message (which updates timeline and URL)
  store.setActiveMessage(messageId)

  // Highlight the message briefly for visual feedback
  highlightedMessageId.value = messageId

  // Clear highlight after animation
  setTimeout(() => {
    highlightedMessageId.value = null
  }, 2000)
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

  // Load conversation
  try {
    await store.loadConversation(props.id)
  } catch (error) {
    // Conversation not found
    conversationNotFound.value = true
    return
  }

  // Restore active message from route query if present
  const messageId = route.query.message as string | undefined
  if (messageId && store.messageMap.has(messageId)) {
    store.setActiveMessage(messageId)
  }

  // Restore view mode from URL query
  const viewParam = route.query.view as string | undefined
  if (viewParam === 'graph') {
    viewMode.value = 'graph'
  } else if (viewParam === 'split' || route.query.paneA) {
    viewMode.value = 'split'
    // Restore split view state from URL
    const paneA = route.query.paneA as string | undefined
    const paneB = route.query.paneB as string | undefined
    const focus = route.query.focus as 'A' | 'B' | undefined
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
  }
})

onUnmounted(() => {
  window.removeEventListener('resize', checkMobile)
  window.removeEventListener('keydown', handleGlobalKeydown)

  // Auto-abort streaming on navigation away
  // This ensures the DB state is consistent (message gets 'aborted' status)
  if (store.isStreaming) {
    store.stopStreaming()
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
    await store.sendMessageWithStreaming(
      content,
      pendingContextConfig.value,
      modelOverride,
      webSearchEnabled,
      searchPreset
    )
    // Clear pending config after successful send
    pendingContextConfig.value = null
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function dismissError() {
  sendError.value = null
  showApiKeyError.value = false
}

function dismissStreamingError() {
  store.clearStreamingError()
}

function goToSettings() {
  router.push({ name: 'settings' })
}

function handleContextConfigUpdate(config: ContextResolverConfig) {
  pendingContextConfig.value = config
}

function openBranchDialog(messageId: string) {
  branchFromMessageId.value = messageId
  branchTitle.value = ''
  branchContent.value = ''
  showBranchDialog.value = true
}

async function createBranch() {
  if (!branchFromMessageId.value || !branchContent.value.trim()) return

  await store.branchFromMessage(
    branchFromMessageId.value,
    branchContent.value.trim(),
    branchTitle.value.trim() || undefined
  )

  closeBranchDialog()
}

function closeBranchDialog() {
  showBranchDialog.value = false
  branchFromMessageId.value = null
  branchTitle.value = ''
  branchContent.value = ''
}

function toggleSidebar() {
  store.toggleSidebar()
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
}

async function saveEditOptionA() {
  // Option A: Rewrite history - delete descendants and edit in place
  if (!editingMessageId.value || !editContent.value.trim()) return

  await store.editMessageRewriteHistory(
    editingMessageId.value,
    editContent.value.trim()
  )

  closeEditDialogs()
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
}

function closeEditDialogs() {
  showEditDialog.value = false
  showEditOptionDialog.value = false
  editingMessageId.value = null
  editContent.value = ''
  editHasDescendants.value = false
  editBranchTitle.value = ''
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
}

function closeDeleteDialog() {
  showDeleteDialog.value = false
  deletingMessageId.value = null
  deleteSubtreeCount.value = 0
}

// Expose reserved functions for potential future use
defineExpose({
  toggleSplitView,
  dismissError,
})
</script>

<template>
  <div class="conversation-page" :class="{ 'day-mode': themeStore.isDayMode }">
    <!-- Grid Background -->
    <GridBackground />

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

        <h1 class="conversation-title" data-testid="conversation-title">
          {{ store.activeConversation?.title ?? 'Loading...' }}
        </h1>
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

        <!-- Swap Panes button (only in split view) -->
        <button
          v-if="isSplitViewEnabled"
          data-testid="swap-panes-btn"
          class="icon-btn"
          title="Swap panes"
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

        <!-- Desktop sidebar toggle -->
        <button
          v-if="!isMobile"
          data-testid="toggle-sidebar-desktop-btn"
          class="icon-btn"
          :class="{ active: store.isSidebarOpen }"
          title="Toggle tree view"
          @click="toggleSidebar"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="icon" viewBox="0 0 20 20" fill="currentColor">
            <path d="M3 4a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm0 6a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2zm0 6a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2zm6-12a1 1 0 011-1h6a1 1 0 110 2h-6a1 1 0 01-1-1zm1 5a1 1 0 100 2h6a1 1 0 100-2h-6zm-1 7a1 1 0 011-1h6a1 1 0 110 2h-6a1 1 0 01-1-1z" />
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
      <!-- Sidebar (Tree Navigation) -->
      <aside
        v-if="store.isSidebarOpen || !isMobile"
        class="tree-sidebar"
        :class="{
          'mobile': isMobile,
          'hidden': isMobile && !store.isSidebarOpen
        }"
        data-testid="tree-sidebar"
      >
        <!-- Sidebar Header -->
        <div class="sidebar-header">
          <div class="sidebar-header-content">
            <h2 class="sidebar-title">Message Tree</h2>
            <!-- Focused pane indicator in split view -->
            <span
              v-if="isSplitViewEnabled"
              class="pane-indicator"
              :class="splitViewStore.focusedPane === 'A' ? 'pane-a' : 'pane-b'"
            >
              → Pane {{ splitViewStore.focusedPane }}
            </span>
          </div>
        </div>

        <!-- Tree Content -->
        <div class="tree-content">
          <MessageTree
            v-if="hasMessages"
            :messages="store.messages"
            :message-map="store.messageMap"
            :children-map="store.childrenMap"
            :root-messages="store.rootMessages"
            :active-message-id="store.activeMessageId"
            :timeline-ids="new Set(store.timeline.map((m) => m.id))"
            @select="handleSelectMessage"
          />
          <div v-else class="empty-tree">
            No messages yet. Start typing below!
          </div>
        </div>
      </aside>

      <!-- Mobile sidebar overlay -->
      <div
        v-if="isMobile && store.isSidebarOpen"
        class="sidebar-overlay"
        @click="toggleSidebar"
      ></div>

      <!-- Main Area - Graph View -->
      <main v-if="isGraphView" class="main-area graph-view" data-testid="graph-view-container">
        <GraphView
          :messages="store.messages"
          :active-message-id="store.activeMessageId"
          :highlighted-message-id="highlightedMessageId"
          @select="handleGraphNodeSelect"
        />
      </main>

      <!-- Main Area - Single View -->
      <main v-else-if="!isSplitViewEnabled" class="main-area">
        <!-- Breadcrumbs -->
        <PathBreadcrumbs
          v-if="store.timeline.length > 0"
          :path="store.timeline"
          :active-message-id="store.activeMessageId"
          @select="handleSelectMessage"
        />

        <!-- Timeline -->
        <div class="timeline-container">
          <MessageTimeline
            :timeline="store.timeline"
            :active-message-id="store.activeMessageId"
            :children-map="store.childrenMap"
            :is-streaming="store.isStreaming"
            :streaming-message-id="store.streamingMessageId"
            :get-message-content="store.getMessageContent"
            :highlighted-message-id="highlightedMessageId"
            @select="handleSelectMessage"
            @branch="openBranchDialog"
            @edit="openEditDialog"
            @delete="openDeleteDialog"
          />
        </div>

        <!-- Context Builder Panel -->
        <ContextBuilder
          :timeline="store.timeline"
          :message-map="store.messageMap"
          :active-message-id="store.activeMessageId"
          @update:config="handleContextConfigUpdate"
        />

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
              <span>{{ store.streamingError.message }}</span>
            </div>
            <div class="error-banner-actions">
              <button
                v-if="store.streamingError.type === 'auth'"
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
          @send="handleSendMessage"
          @stop-generation="handleStopGeneration"
        />
      </main>

      <!-- Main Area - Split View -->
      <div v-else class="split-view-container" data-testid="split-view-container">
        <!-- Pane A -->
        <SplitViewPane
          pane-id="A"
          :timeline="paneATimeline"
          :active-message-id="splitViewStore.paneA.activeMessageId"
          :children-map="store.childrenMap"
          :is-focused="splitViewStore.isPaneFocused('A')"
          :is-streaming="splitViewStore.isPaneStreaming('A')"
          :streaming-message-id="splitViewStore.isPaneStreaming('A') ? store.streamingMessageId : null"
          :can-send="splitViewStore.canPaneSend('A')"
          :conversation-default-model="store.activeConversation?.defaultModel ?? null"
          :get-message-content="store.getMessageContent"
          :highlighted-message-id="highlightedMessageId"
          class="split-pane"
          @focus="() => handlePaneFocus('A')"
          @select-message="(id: string) => handlePaneSelectMessage('A', id)"
          @branch="openBranchDialog"
          @edit="openEditDialog"
          @delete="openDeleteDialog"
          @send="handleSendMessage"
          @stop-generation="handleStopGeneration"
        />

        <!-- Pane B -->
        <SplitViewPane
          pane-id="B"
          :timeline="paneBTimeline"
          :active-message-id="splitViewStore.paneB.activeMessageId"
          :children-map="store.childrenMap"
          :is-focused="splitViewStore.isPaneFocused('B')"
          :is-streaming="splitViewStore.isPaneStreaming('B')"
          :streaming-message-id="splitViewStore.isPaneStreaming('B') ? store.streamingMessageId : null"
          :can-send="splitViewStore.canPaneSend('B')"
          :conversation-default-model="store.activeConversation?.defaultModel ?? null"
          :get-message-content="store.getMessageContent"
          :highlighted-message-id="highlightedMessageId"
          class="split-pane"
          @focus="() => handlePaneFocus('B')"
          @select-message="(id: string) => handlePaneSelectMessage('B', id)"
          @branch="openBranchDialog"
          @edit="openEditDialog"
          @delete="openDeleteDialog"
          @send="handleSendMessage"
          @stop-generation="handleStopGeneration"
        />
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
            v-model="branchTitle"
            data-testid="branch-title-input"
            type="text"
            placeholder="e.g., Alternative approach..."
            class="input"
          />
        </div>

        <div class="form-group">
          <label class="input-label">First Message</label>
          <textarea
            v-model="branchContent"
            data-testid="branch-content-input"
            rows="3"
            placeholder="Start this branch with..."
            class="input textarea"
            @keydown.meta.enter="createBranch"
            @keydown.ctrl.enter="createBranch"
          ></textarea>
        </div>

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
            :disabled="!branchContent.trim()"
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
  </div>
</template>

<style scoped>
.conversation-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  padding-top: 60px; /* Account for fixed navbar */
  background: var(--bg-primary);
  color: var(--text-primary);
  transition: background 0.4s ease, color 0.4s ease;
}

/* Header */
.conversation-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border-subtle);
  position: relative;
  z-index: 1;
}

.header-left,
.header-right {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.conversation-title {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-left: 0.5rem;
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
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-primary);
}

.icon-btn.active {
  background: rgba(var(--accent-rgb), 0.15);
  color: var(--accent);
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
  border-radius: var(--radius-md);
  padding: 0.125rem;
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
  background: var(--bg-card-hover);
  color: var(--text-primary);
}

.view-mode-btn.split.active {
  background: var(--accent);
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
  overflow: hidden;
  position: relative;
  z-index: 1;
}

/* Sidebar */
.tree-sidebar {
  width: 18rem;
  flex-shrink: 0;
  background: var(--bg-card);
  border-right: 1px solid var(--border-subtle);
}

.tree-sidebar.mobile {
  position: absolute;
  top: 57px;
  left: 0;
  bottom: 0;
  z-index: 20;
  width: 16rem;
}

.tree-sidebar.hidden {
  display: none;
}

.sidebar-header {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--border-subtle);
}

.sidebar-header-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.sidebar-title {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-secondary);
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
  height: calc(100% - 49px);
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
  background: rgba(0, 0, 0, 0.5);
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
  overflow-y: auto;
}

/* Split View */
.split-view-container {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.split-pane {
  flex: 1;
}

/* Error Banner */
.error-banner {
  border-top: 1px solid rgba(248, 113, 113, 0.3);
  background: var(--error-bg);
  padding: 0.75rem 1rem;
}

.error-banner-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.error-banner-message {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--error);
  font-size: 0.875rem;
}

.error-banner-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.btn-error-action {
  padding: 0.375rem 0.75rem;
  background: rgba(248, 113, 113, 0.3);
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
  background: rgba(var(--accent-rgb), 0.05);
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
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
  padding: 1rem;
}

.dialog-content {
  width: 100%;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
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

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 1rem;
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
  background: var(--bg-primary);
  border: 1px solid var(--border-subtle);
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
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-primary);
}

.btn-danger {
  background: var(--error);
  color: white;
}

.btn-danger:hover:not(:disabled) {
  background: #ef5350;
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

/* ============================================================================= */
/* DAY MODE */
/* ============================================================================= */
.day-mode {
  --bg-primary: #fff8f0;
  --bg-secondary: rgba(255, 248, 240, 0.85);
  --bg-card: #fff;
  --bg-card-hover: #fef7ed;
  --text-primary: #2d2a26;
  --text-secondary: #6b6560;
  --text-muted: rgba(45, 42, 38, 0.6);
  --accent: #c4956a;
  --accent-rgb: 196, 149, 106;
  --accent-hover: #b8865c;
  --border-color: rgba(196, 149, 106, 0.5);
  --border-subtle: rgba(196, 149, 106, 0.25);
  --border-muted: rgba(0, 0, 0, 0.08);
  --branch-blue: #7eb5e8;
  --branch-pink: #e8a4c4;
  --branch-orange: #e8b07e;
  --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.08);
  --shadow-md: 0 4px 16px rgba(0, 0, 0, 0.1);
  --shadow-lg: 0 8px 32px rgba(0, 0, 0, 0.12);
}
</style>
