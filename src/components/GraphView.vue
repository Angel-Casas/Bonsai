<script setup lang="ts">
/**
 * GraphView - High-performance Canvas-based graph visualization
 *
 * Rebuilt for 60fps performance with 1000+ messages:
 * - Canvas rendering instead of SVG (batch drawing)
 * - Quadtree spatial indexing (viewport culling)
 * - Pre-computed colors (O(n) instead of O(n²))
 * - RAF-throttled interactions
 */

import { ref, shallowRef, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import type { Message } from '@/db/types'
import {
  computeTreeLayout,
  getNodeSnippet,
  formatTimestamp,
  COMPACT_GROUP_SIZE,
  type GraphNode,
  type FilterOptions,
} from '@/utils/graphLayout'
import { GraphSpatialIndex, createSpatialIndex } from '@/utils/graphSpatialIndex'
import { useGraphRenderer, clearColorCache, type ViewportTransform, type RenderState } from '@/composables/useGraphRenderer'
import { useGraphInteraction } from '@/composables/useGraphInteraction'
import { useThemeStore } from '@/stores/themeStore'
import { useConversationStore } from '@/stores/conversationStore'
import { storeToRefs } from 'pinia'

const conversationStore = useConversationStore()
const { excludedMessageIds } = storeToRefs(conversationStore)

const props = defineProps<{
  messages: Message[]
  activeMessageId: string | null
  highlightedMessageId?: string | null
  /** Branch color map from MessageTree for consistent colors across views */
  branchColorMap?: Map<string, string>
  /** Set of message IDs in the current timeline/path for highlighting */
  timelineIds?: Set<string>
}>()

const emit = defineEmits<{
  (e: 'select', messageId: string): void
  (e: 'go-to-tree', messageId: string): void
  (e: 'go-to-split', messageId: string, pane: 'A' | 'B'): void
}>()

// Refs
const canvasRef = ref<HTMLCanvasElement | null>(null)

// Spatial index (shallowRef: class instance should not be deeply reactive)
const spatialIndex = shallowRef<GraphSpatialIndex | null>(null)

// Transform state
const transform = ref<ViewportTransform>({
  offsetX: 0,
  offsetY: 0,
  scale: 1,
})

// Composables
const renderer = useGraphRenderer(canvasRef)
const interaction = useGraphInteraction(canvasRef, spatialIndex, transform)
const themeStore = useThemeStore()

// UI State
const isPanning = ref(false)
const tooltipNode = ref<GraphNode | null>(null)
const showSelectionMenu = ref(false)
const selectedNode = ref<GraphNode | null>(null)
const selectionMenuPosition = ref({ x: 0, y: 0 })

// Track if component is mounted (to avoid rendering before canvas is ready)
const isMounted = ref(false)

// ResizeObserver for container size changes (e.g., sidebar resize)
const resizeObserver = ref<ResizeObserver | null>(null)

// Check if mobile
const isMobile = ref(false)
function checkMobile() {
  isMobile.value = window.innerWidth < 768
}

// LocalStorage keys
const COMPACT_MODE_KEY = 'bonsai:graphView:compactNodes'
const HIGHLIGHT_PATH_KEY = 'bonsai:graphView:highlightPath'

// Load/save preferences
function loadCompactMode(): boolean {
  try {
    const saved = localStorage.getItem(COMPACT_MODE_KEY)
    return saved !== null ? saved === 'true' : true
  } catch {
    return true
  }
}

function saveCompactMode(value: boolean) {
  try {
    localStorage.setItem(COMPACT_MODE_KEY, String(value))
  } catch {
    // Ignore
  }
}

function loadHighlightPath(): boolean {
  try {
    const saved = localStorage.getItem(HIGHLIGHT_PATH_KEY)
    return saved !== null ? saved === 'true' : true
  } catch {
    return true
  }
}

function saveHighlightPath(value: boolean) {
  try {
    localStorage.setItem(HIGHLIGHT_PATH_KEY, String(value))
  } catch {
    // Ignore
  }
}

// Filter state
const compactNodes = ref(loadCompactMode())
const highlightPath = ref(loadHighlightPath())
const expandedNodeIds = ref(new Set<string>())

// Auto-defaults for large datasets
const LARGE_DATASET_THRESHOLD = 500
const autoDefaultsApplied = ref(false)

// Watch preferences
watch(compactNodes, (newValue) => {
  saveCompactMode(newValue)
  if (newValue) {
    expandedNodeIds.value = new Set()
  }
})

watch(highlightPath, (newValue) => {
  saveHighlightPath(newValue)
})

// Check for large dataset on mount (not in watcher to avoid recursive updates)
function checkAutoDefaults() {
  if (props.messages.length >= LARGE_DATASET_THRESHOLD && !autoDefaultsApplied.value) {
    compactNodes.value = true
    autoDefaultsApplied.value = true
  }
}

// Layout constants
const NODE_RADIUS = 20

// Computed timeline IDs
const timelineIdSet = computed(() => props.timelineIds ?? new Set<string>())

// Computed filter options
const filterOptions = computed<Partial<FilterOptions>>(() => ({
  collapseLinearChains: false,
  compactNodes: compactNodes.value,
  expandedNodeIds: expandedNodeIds.value,
}))

// Compute layout (memoized)
const layout = computed(() => {
  return computeTreeLayout(
    props.messages,
    { nodeRadius: NODE_RADIUS },
    filterOptions.value,
    props.branchColorMap
  )
})

// Compute tooltip position reactively based on hovered node and current transform
// This ensures tooltip follows the node during pan/zoom
// Note: backdrop-filter on .graph-view creates a containing block for position:fixed,
// so we calculate position relative to that container, not the viewport
const tooltipPosition = computed(() => {
  if (!tooltipNode.value || !canvasRef.value) {
    return { x: 0, y: 0 }
  }

  const node = tooltipNode.value
  const canvas = canvasRef.value
  const canvasRect = canvas.getBoundingClientRect()

  // Get the containing block (.graph-view has backdrop-filter which creates it)
  const container = canvas.closest('.graph-view')
  const containerRect = container?.getBoundingClientRect()
  if (!containerRect) {
    return { x: 0, y: 0 }
  }

  // Node position in canvas coordinates
  const nodeCanvasX = node.x * transform.value.scale + transform.value.offsetX
  const nodeCanvasY = node.y * transform.value.scale + transform.value.offsetY

  // Convert to container-relative coordinates (for position:fixed inside backdrop-filter parent)
  // Canvas offset within container + node position within canvas
  const nodeContainerX = (canvasRect.left - containerRect.left) + nodeCanvasX
  const nodeContainerY = (canvasRect.top - containerRect.top) + nodeCanvasY

  const tooltipWidth = 260
  const tooltipHeight = 160
  const offset = 30

  let x = nodeContainerX + offset
  let y = nodeContainerY - tooltipHeight / 2

  // When selection menu is also open (e.g. touch/tap triggers both hover and click),
  // stack the tooltip above or below the menu so they don't overlap
  if (showSelectionMenu.value) {
    const menuY = selectionMenuPosition.value.y
    const menuHeight = 160
    // Try placing tooltip above the menu
    y = menuY - tooltipHeight - 8
    // If not enough room above, place below the menu instead
    if (y < 10) {
      y = menuY + menuHeight + 8
    }
  }

  // Keep in container bounds - prefer right side, fall back to left
  if (x + tooltipWidth > containerRect.width - 10) {
    x = nodeContainerX - offset - tooltipWidth
  }
  if (x < 10) x = 10
  if (y < 10) y = 10
  if (y + tooltipHeight > containerRect.height - 10) {
    y = containerRect.height - tooltipHeight - 10
  }

  return { x, y }
})

// Build spatial index when layout changes (no immediate to avoid recursive updates on mount)
watch(
  layout,
  (newLayout) => {
    if (newLayout.nodes.length > 0) {
      spatialIndex.value = createSpatialIndex(newLayout.nodes, newLayout.edges)
    } else {
      spatialIndex.value = null
    }
    // Re-render after spatial index update
    if (isMounted.value) {
      renderGraph()
    }
  }
)

// Render the graph (only after mounted)
function renderGraph() {
  if (!isMounted.value) return

  const state: RenderState = {
    nodes: layout.value.nodes,
    edges: layout.value.edges,
    activeNodeId: props.activeMessageId,
    highlightedNodeId: props.highlightedMessageId ?? null,
    timelineNodeIds: timelineIdSet.value,
    excludedNodeIds: excludedMessageIds.value,
    highlightPath: highlightPath.value,
    transform: transform.value,
  }
  renderer.render(state)
}

// Handle node click
function handleNodeClick(node: GraphNode, _event: MouseEvent) {
  // If clicking a compacted node, use hierarchical expansion
  if (node.collapsedCount > 0) {
    const newExpanded = new Set(expandedNodeIds.value)

    if (node.collapsedCount <= COMPACT_GROUP_SIZE || !node.compactChildGroups) {
      // Small group or no sub-groups: expand all nodes directly
      for (const id of node.collapsedNodeIds) {
        newExpanded.add(id)
      }
    } else {
      // Large group with sub-groups: expand only the group representatives
      // This reveals the next level of compaction instead of all nodes at once
      for (const group of node.compactChildGroups) {
        newExpanded.add(group.representativeId)
      }
    }

    expandedNodeIds.value = newExpanded
    // Turn off compact mode so the expanded nodes become visible
    compactNodes.value = false
    return
  }

  // Show selection menu
  selectedNode.value = node
  showSelectionMenu.value = true

  // Position menu near clicked node
  // Note: backdrop-filter on .graph-view creates a containing block for position:fixed,
  // so we need to calculate position relative to that container
  const canvas = canvasRef.value
  if (!canvas) return

  const canvasRect = canvas.getBoundingClientRect()
  const container = canvas.closest('.graph-view')
  const containerRect = container?.getBoundingClientRect()
  if (!containerRect) return

  // Calculate node's position relative to container
  const nodeCanvasX = node.x * transform.value.scale + transform.value.offsetX
  const nodeCanvasY = node.y * transform.value.scale + transform.value.offsetY
  const nodeContainerX = (canvasRect.left - containerRect.left) + nodeCanvasX
  const nodeContainerY = (canvasRect.top - containerRect.top) + nodeCanvasY

  const menuWidth = 180
  const menuHeight = 160
  const offset = 30

  let x = nodeContainerX + offset
  let y = nodeContainerY - menuHeight / 2

  // Keep menu in container bounds
  if (x + menuWidth > containerRect.width - 10) {
    x = nodeContainerX - offset - menuWidth
  }
  if (x < 10) x = 10
  if (y < 10) y = 10
  if (y + menuHeight > containerRect.height - 10) {
    y = containerRect.height - menuHeight - 10
  }

  selectionMenuPosition.value = { x, y }
}

// Handle node hover - just set/clear the node, position is computed reactively
function handleNodeHover(node: GraphNode | null) {
  tooltipNode.value = node
}

// Navigation actions
function goToTree() {
  if (selectedNode.value) {
    emit('go-to-tree', selectedNode.value.id)
  }
  closeSelectionMenu()
}

function goToSplitPane(pane: 'A' | 'B') {
  if (selectedNode.value) {
    emit('go-to-split', selectedNode.value.id, pane)
  }
  closeSelectionMenu()
}

function closeSelectionMenu() {
  showSelectionMenu.value = false
  selectedNode.value = null
}

// Zoom controls
const zoomPercent = computed(() => Math.round(transform.value.scale * 100))

// Slider uses a logarithmic scale for natural-feeling zoom:
// slider 0 → minScale, slider 100 → maxScale
const MIN_SCALE = interaction.minScale // 0.1
const MAX_SCALE = interaction.maxScale // 4
const logMin = Math.log(MIN_SCALE)
const logMax = Math.log(MAX_SCALE)

const zoomSliderValue = computed(() => {
  const logScale = Math.log(transform.value.scale)
  return ((logScale - logMin) / (logMax - logMin)) * 100
})

function handleZoomSlider(event: Event) {
  const target = event.target as HTMLInputElement
  const sliderVal = parseFloat(target.value)
  const logScale = logMin + (sliderVal / 100) * (logMax - logMin)
  const newScale = Math.exp(logScale)
  setZoomToScale(newScale)
}

function setZoomToScale(newScale: number) {
  const canvas = canvasRef.value
  if (!canvas) return

  const rect = canvas.getBoundingClientRect()
  const centerX = rect.width / 2
  const centerY = rect.height / 2

  const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, newScale))
  const scaleRatio = clamped / transform.value.scale

  transform.value = {
    offsetX: centerX - (centerX - transform.value.offsetX) * scaleRatio,
    offsetY: centerY - (centerY - transform.value.offsetY) * scaleRatio,
    scale: clamped,
  }

  interaction.requestRender()
}

function zoomIn() {
  interaction.zoomByDelta(3)
}

function zoomOut() {
  interaction.zoomByDelta(-3)
}

function resetZoom() {
  interaction.fitToView(layout.value.nodes)
}

// View controls
function centerView() {
  interaction.fitToView(layout.value.nodes)
}

function clearAutoDefaults() {
  compactNodes.value = false
  autoDefaultsApplied.value = false
}

// Initialize
onMounted(async () => {
  checkMobile()
  window.addEventListener('resize', handleResize)

  // Set up ResizeObserver to handle container size changes (e.g., sidebar resize)
  if (canvasRef.value) {
    resizeObserver.value = new ResizeObserver(() => {
      if (isMounted.value) {
        renderer.resizeCanvas()
        renderGraph()
      }
    })
    resizeObserver.value.observe(canvasRef.value)
  }

  await nextTick()

  // Check auto-defaults for large datasets (done here, not in watcher, to avoid recursive updates)
  checkAutoDefaults()

  // Initialize canvas
  renderer.initCanvas()

  // Set up interaction callbacks
  interaction.setRenderCallback(renderGraph)
  interaction.setNodeClickCallback(handleNodeClick)
  interaction.setNodeHoverCallback(handleNodeHover)
  interaction.setPanCallbacks(
    () => { isPanning.value = true },
    () => { isPanning.value = false }
  )

  // Set up event listeners
  interaction.setupListeners()

  // Build initial spatial index
  if (layout.value.nodes.length > 0) {
    spatialIndex.value = createSpatialIndex(layout.value.nodes, layout.value.edges)
  }

  // Mark as mounted BEFORE fitToView to enable rendering
  isMounted.value = true

  // Initial fit to view (this will trigger renderGraph via the interaction callback)
  if (layout.value.nodes.length > 0) {
    interaction.fitToView(layout.value.nodes)
  } else {
    // No nodes, still render empty state
    renderGraph()
  }
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  interaction.cleanupListeners()
  if (resizeObserver.value) {
    resizeObserver.value.disconnect()
    resizeObserver.value = null
  }
})

// Handle resize
function handleResize() {
  checkMobile()
  renderer.resizeCanvas()
  clearColorCache() // CSS variables may have changed
  renderGraph()
}

// Re-render when props change (not layout - layout changes are handled by the spatial index watch)
// Using flush: 'post' and checking isMounted to avoid recursive updates during setup
watch(
  [() => props.activeMessageId, () => props.highlightedMessageId, () => props.timelineIds, excludedMessageIds, highlightPath],
  () => {
    if (isMounted.value) {
      renderGraph()
    }
  },
  { flush: 'post' }
)

// Re-render when theme changes (clear color cache and redraw)
watch(
  () => themeStore.isDayMode,
  () => {
    if (isMounted.value) {
      clearColorCache()
      renderGraph()
    }
  }
)

// Note: layout changes trigger spatial index rebuild, which then calls renderGraph
// Note: transform changes are handled by the interaction composable via requestRender callback
</script>

<template>
  <div class="graph-view" :class="{ 'day-mode': themeStore.isDayMode }">
    <!-- Controls -->
    <div class="graph-controls">
      <div class="controls-left">
        <!-- Compact nodes filter -->
        <label class="control-checkbox">
          <input
            v-model="compactNodes"
            type="checkbox"
            class="checkbox"
            data-testid="compact-nodes-toggle"
          />
          Compact
        </label>

        <!-- Highlight path toggle -->
        <label class="control-checkbox">
          <input
            v-model="highlightPath"
            type="checkbox"
            class="checkbox"
            data-testid="highlight-path-toggle"
          />
          Highlight path
        </label>
      </div>

      <div class="controls-right">
        <!-- Auto-defaults indicator -->
        <div
          v-if="autoDefaultsApplied"
          class="auto-defaults-badge"
          data-testid="auto-defaults-indicator"
        >
          <span>Filters auto-applied</span>
          <button
            class="show-all-btn"
            title="Show all nodes (may be slow)"
            @click="clearAutoDefaults"
          >
            Show all
          </button>
        </div>

        <!-- Center view (fits all nodes in viewport) -->
        <button
          class="control-btn"
          @click="centerView"
        >
          Center
        </button>

        <!-- Node count -->
        <span class="node-count">{{ layout.nodes.length }} nodes</span>
      </div>
    </div>

    <!-- Graph container -->
    <div
      class="graph-container"
      data-testid="graph-container"
    >
      <!-- Empty state -->
      <div
        v-if="layout.nodes.length === 0"
        class="empty-state"
      >
        No messages to display
      </div>

      <!-- Canvas Graph -->
      <canvas
        v-show="layout.nodes.length > 0"
        ref="canvasRef"
        class="graph-canvas"
        data-testid="graph-canvas"
      />

      <!-- Tooltip -->
      <div
        v-if="tooltipNode"
        class="tooltip"
        :style="{
          left: `${tooltipPosition.x}px`,
          top: `${tooltipPosition.y}px`,
        }"
        data-testid="graph-tooltip"
      >
        <!-- Role badge -->
        <div class="tooltip-header">
          <span
            class="tooltip-role"
            :class="`role-${tooltipNode.message.role}`"
          >
            {{ tooltipNode.message.role }}
          </span>
          <span v-if="tooltipNode.message.branchTitle" class="tooltip-branch">
            {{ tooltipNode.message.branchTitle }}
          </span>
          <span v-if="excludedMessageIds.has(tooltipNode.id)" class="tooltip-excluded">
            Excluded
          </span>
        </div>

        <!-- Content snippet -->
        <p class="tooltip-content">
          {{ getNodeSnippet(tooltipNode.message.content, 150) }}
        </p>

        <!-- Metadata -->
        <div class="tooltip-meta">
          {{ formatTimestamp(tooltipNode.message.createdAt) }}
          <span v-if="tooltipNode.childCount > 0">
            · {{ tooltipNode.childCount }} {{ tooltipNode.childCount === 1 ? 'reply' : 'replies' }}
          </span>
        </div>
      </div>

      <!-- Selection Menu -->
      <div
        v-if="showSelectionMenu && selectedNode"
        class="selection-menu"
        :style="{
          left: `${selectionMenuPosition.x}px`,
          top: `${selectionMenuPosition.y}px`,
        }"
        data-testid="graph-selection-menu"
      >
        <div class="selection-menu-header">
          <span class="selection-menu-title">Go to message</span>
          <button class="selection-menu-close" @click="closeSelectionMenu">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
            </svg>
          </button>
        </div>
        <div class="selection-menu-options">
          <button class="selection-menu-btn" @click="goToTree">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
              <path d="M3 4a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm0 6a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2zm0 6a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2zm6-12a1 1 0 011-1h6a1 1 0 110 2h-6a1 1 0 01-1-1zm1 5a1 1 0 100 2h6a1 1 0 100-2h-6zm-1 7a1 1 0 011-1h6a1 1 0 110 2h-6a1 1 0 01-1-1z" />
            </svg>
            Tree View
          </button>
          <button class="selection-menu-btn" @click="goToSplitPane('A')">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm1 0v12h5V4H4z" clip-rule="evenodd" />
            </svg>
            Split View · Pane A
          </button>
          <button class="selection-menu-btn" @click="goToSplitPane('B')">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm8 0v12h5V4h-5z" clip-rule="evenodd" />
            </svg>
            Split View · Pane B
          </button>
        </div>
      </div>

      <!-- Click outside to close menu -->
      <div
        v-if="showSelectionMenu"
        class="selection-menu-backdrop"
        @click="closeSelectionMenu"
      ></div>

      <!-- Pan indicator -->
      <div v-if="isPanning" class="pan-overlay"></div>

      <!-- Zoom Bar -->
      <div class="zoom-bar" data-testid="zoom-bar">
        <button
          class="zoom-btn"
          title="Zoom out"
          data-testid="zoom-out-btn"
          :disabled="zoomPercent <= 10"
          @click="zoomOut"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M5 10a1 1 0 011-1h8a1 1 0 110 2H6a1 1 0 01-1-1z" clip-rule="evenodd" />
          </svg>
        </button>

        <div class="zoom-slider-track">
          <input
            type="range"
            class="zoom-slider"
            :value="zoomSliderValue"
            min="0"
            max="100"
            step="0.5"
            data-testid="zoom-slider"
            title="Zoom"
            @input="handleZoomSlider"
          />
        </div>

        <button
          class="zoom-btn"
          title="Zoom in"
          data-testid="zoom-in-btn"
          :disabled="zoomPercent >= 400"
          @click="zoomIn"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" clip-rule="evenodd" />
          </svg>
        </button>

        <button
          class="zoom-level"
          title="Reset zoom (fit to view)"
          data-testid="zoom-level-btn"
          @click="resetZoom"
        >
          {{ zoomPercent }}%
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.graph-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: rgba(0, 0, 0, 0.2);
  backdrop-filter: blur(8px);
}

.graph-view.day-mode {
  background: rgba(255, 255, 255, 0.2);
}

/* Controls */
.graph-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 1rem;
  border-bottom: 1px solid var(--glass-border);
  background: var(--glass-bg);
  backdrop-filter: blur(var(--glass-blur));
}

.controls-left,
.controls-right {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.control-checkbox {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8125rem;
  color: var(--text-secondary);
  cursor: pointer;
}

.checkbox {
  width: 1rem;
  height: 1rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
  background: var(--bg-primary);
  accent-color: var(--accent);
}

.auto-defaults-badge {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
  background: var(--warning-bg);
  color: var(--warning);
  border-radius: var(--radius-sm);
}

.show-all-btn {
  padding: 0.125rem 0.375rem;
  font-size: 0.6875rem;
  font-family: var(--font-sans);
  background: var(--warning-bg);
  border: none;
  border-radius: var(--radius-sm);
  color: var(--warning);
  cursor: pointer;
  transition: background var(--transition-fast);
}

.show-all-btn:hover {
  background: var(--warning);
}

.control-btn {
  padding: 0.375rem 0.75rem;
  font-size: 0.8125rem;
  font-family: var(--font-sans);
  color: var(--text-secondary);
  background: var(--border-muted);
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.control-btn:hover:not(:disabled) {
  color: var(--text-primary);
  background: var(--bg-card-hover);
}

.control-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.node-count {
  font-size: 0.75rem;
  color: var(--text-muted);
}

/* Graph Container */
.graph-container {
  flex: 1;
  position: relative;
  overflow: hidden;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-muted);
}

.graph-canvas {
  width: 100%;
  height: 100%;
  cursor: grab;
}

.graph-canvas:active {
  cursor: grabbing;
}

/* Tooltip */
.tooltip {
  position: fixed;
  z-index: 100;
  width: 16rem;
  padding: 0.75rem;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  pointer-events: none;
}

.tooltip-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.tooltip-role {
  padding: 0.125rem 0.5rem;
  font-size: 0.75rem;
  font-weight: 500;
  border-radius: var(--radius-sm);
}

.tooltip-role.role-user {
  background: rgba(var(--branch-blue-rgb), 0.15);
  color: var(--branch-blue);
}

.tooltip-role.role-assistant {
  background: rgba(var(--accent-rgb), 0.15);
  color: var(--accent);
}

.tooltip-role.role-system {
  background: rgba(var(--branch-orange-rgb), 0.15);
  color: var(--branch-orange);
}

.tooltip-branch {
  padding: 0.125rem 0.5rem;
  font-size: 0.75rem;
  background: rgba(var(--branch-pink-rgb), 0.15);
  color: var(--branch-pink);
  border-radius: var(--radius-sm);
}

.tooltip-excluded {
  padding: 0.125rem 0.5rem;
  font-size: 0.75rem;
  background: rgba(245, 158, 11, 0.15);
  color: var(--warning);
  border-radius: var(--radius-sm);
}

.tooltip-content {
  margin-bottom: 0.5rem;
  font-size: 0.8125rem;
  color: var(--text-primary);
  white-space: pre-wrap;
  line-height: 1.5;
}

.tooltip-meta {
  font-size: 0.75rem;
  color: var(--text-muted);
}

/* Pan Overlay */
.pan-overlay {
  position: absolute;
  inset: 0;
  background: var(--overlay-light);
  pointer-events: none;
}

/* Selection Menu */
.selection-menu {
  position: fixed;
  z-index: 60;
  min-width: 180px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.selection-menu-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-primary);
}

.selection-menu-title {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.025em;
}

.selection-menu-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.25rem;
  height: 1.25rem;
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: all var(--transition-fast);
}

.selection-menu-close:hover {
  background: var(--border-muted);
  color: var(--text-primary);
}

.selection-menu-close svg {
  width: 0.875rem;
  height: 0.875rem;
}

.selection-menu-options {
  display: flex;
  flex-direction: column;
  padding: 0.375rem;
}

.selection-menu-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.5rem 0.625rem;
  background: transparent;
  border: none;
  border-radius: var(--radius-md);
  font-size: 0.8125rem;
  font-family: var(--font-sans);
  color: var(--text-primary);
  cursor: pointer;
  transition: all var(--transition-fast);
  text-align: left;
}

.selection-menu-btn:hover {
  background: rgba(var(--accent-rgb), 0.1);
  color: var(--accent);
}

.selection-menu-btn svg {
  width: 1rem;
  height: 1rem;
  flex-shrink: 0;
  color: var(--text-muted);
}

.selection-menu-btn:hover svg {
  color: var(--accent);
}

.selection-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 55;
}

/* Zoom Bar */
.zoom-bar {
  position: absolute;
  bottom: 1rem;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 0;
  height: 2.5rem;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  z-index: 20;
}

.zoom-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
  flex-shrink: 0;
}

.zoom-btn:hover:not(:disabled) {
  background: rgba(var(--accent-rgb), 0.1);
  color: var(--accent);
}

.zoom-btn:active:not(:disabled) {
  background: rgba(var(--accent-rgb), 0.15);
}

.zoom-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.zoom-btn svg {
  width: 1.125rem;
  height: 1.125rem;
}

.zoom-slider-track {
  display: flex;
  align-items: center;
  width: 10rem;
  height: 100%;
  padding: 0 0.25rem;
}

.zoom-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 4px;
  background: var(--border-subtle);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}

.zoom-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 1rem;
  height: 1rem;
  border-radius: 50%;
  background: var(--accent);
  border: 2px solid var(--bg-card);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  cursor: pointer;
  transition: transform var(--transition-fast), box-shadow var(--transition-fast);
}

.zoom-slider::-webkit-slider-thumb:hover {
  transform: scale(1.2);
  box-shadow: 0 0 0 4px rgba(var(--accent-rgb), 0.2);
}

.zoom-slider::-webkit-slider-thumb:active {
  transform: scale(1.15);
  box-shadow: 0 0 0 6px rgba(var(--accent-rgb), 0.15);
}

.zoom-slider::-moz-range-thumb {
  width: 1rem;
  height: 1rem;
  border-radius: 50%;
  background: var(--accent);
  border: 2px solid var(--bg-card);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  cursor: pointer;
}

.zoom-slider::-moz-range-track {
  height: 4px;
  background: var(--border-subtle);
  border-radius: 2px;
  border: none;
}

.zoom-level {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 3.25rem;
  height: 2.5rem;
  padding: 0 0.625rem;
  background: transparent;
  border: none;
  border-left: 1px solid var(--border-subtle);
  font-size: 0.75rem;
  font-weight: 600;
  font-family: var(--font-sans);
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
  white-space: nowrap;
}

.zoom-level:hover {
  color: var(--accent);
  background: rgba(var(--accent-rgb), 0.05);
}
</style>
