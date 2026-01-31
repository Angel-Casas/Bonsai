<script setup lang="ts">
/**
 * GraphView - Interactive graph visualization of conversation tree
 *
 * Features:
 * - SVG-based rendering for deterministic layout
 * - Pan/zoom via mouse drag and wheel
 * - Click nodes to jump to message
 * - Density controls (branch roots only, depth limit)
 * - Tooltip showing message details
 */

import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import type { Message } from '@/db/types'
import {
  computeTreeLayout,
  getNodeSnippet,
  formatTimestamp,
  type GraphNode,
  type FilterOptions,
} from '@/utils/graphLayout'

const props = defineProps<{
  messages: Message[]
  activeMessageId: string | null
  highlightedMessageId?: string | null
}>()

const emit = defineEmits<{
  (e: 'select', messageId: string): void
}>()

// Pan/zoom state
const containerRef = ref<HTMLDivElement | null>(null)
const viewBox = ref({ x: 0, y: 0, width: 800, height: 600 })
const isPanning = ref(false)
const panStart = ref({ x: 0, y: 0 })
const scale = ref(1)

// Tooltip state
const tooltipNode = ref<GraphNode | null>(null)
const tooltipPosition = ref({ x: 0, y: 0 })

// Filter state
const showBranchRootsOnly = ref(false)
const maxDepth = ref<number | null>(null)
const depthOptions = [null, 3, 5, 10, 20]

// Auto-defaults for large datasets
const LARGE_DATASET_THRESHOLD = 500
const autoDefaultsApplied = ref(false)

// Apply sensible defaults when dataset is large
watch(
  () => props.messages.length,
  (newLength, oldLength) => {
    // Only apply auto-defaults on initial load or significant increase
    if (newLength >= LARGE_DATASET_THRESHOLD && (oldLength === undefined || oldLength < LARGE_DATASET_THRESHOLD)) {
      // Auto-enable branch roots only for large datasets
      showBranchRootsOnly.value = true
      // Auto-limit depth to 10 for very large datasets
      if (newLength >= LARGE_DATASET_THRESHOLD * 2) {
        maxDepth.value = 10
      }
      autoDefaultsApplied.value = true
    } else if (newLength < LARGE_DATASET_THRESHOLD && oldLength !== undefined && oldLength >= LARGE_DATASET_THRESHOLD) {
      // Clear auto-defaults flag when going back to smaller dataset
      autoDefaultsApplied.value = false
    }
  },
  { immediate: true }
)

// Layout options
const NODE_RADIUS = 20

// Compute filter options
const filterOptions = computed<Partial<FilterOptions>>(() => ({
  branchRootsOnly: showBranchRootsOnly.value,
  maxDepth: maxDepth.value,
  collapseLinearChains: false,
}))

// Compute layout (memoized - only recomputes when messages or filters change)
const layout = computed(() => {
  return computeTreeLayout(props.messages, { nodeRadius: NODE_RADIUS }, filterOptions.value)
})

// Initialize viewBox when layout changes
watch(
  layout,
  (newLayout) => {
    if (newLayout.width > 0 && newLayout.height > 0) {
      viewBox.value = {
        x: 0,
        y: 0,
        width: Math.max(newLayout.width, 800),
        height: Math.max(newLayout.height, 600),
      }
    }
  },
  { immediate: true }
)

// Role colors
function getRoleColor(role: string): string {
  switch (role) {
    case 'user':
      return '#10b981' // emerald-500
    case 'assistant':
      return '#3b82f6' // blue-500
    case 'system':
      return '#6b7280' // gray-500
    default:
      return '#6b7280'
  }
}

// Node click handler
function handleNodeClick(node: GraphNode) {
  emit('select', node.id)
}

// Tooltip handlers
function showTooltip(node: GraphNode, event: MouseEvent) {
  tooltipNode.value = node
  tooltipPosition.value = { x: event.clientX, y: event.clientY }
}

function hideTooltip() {
  tooltipNode.value = null
}

// Pan handlers
function startPan(event: MouseEvent) {
  if (event.button !== 0) return // Only left click
  isPanning.value = true
  panStart.value = { x: event.clientX, y: event.clientY }
  event.preventDefault()
}

function doPan(event: MouseEvent) {
  if (!isPanning.value) return
  const dx = (event.clientX - panStart.value.x) / scale.value
  const dy = (event.clientY - panStart.value.y) / scale.value
  viewBox.value = {
    ...viewBox.value,
    x: viewBox.value.x - dx,
    y: viewBox.value.y - dy,
  }
  panStart.value = { x: event.clientX, y: event.clientY }
}

function endPan() {
  isPanning.value = false
}

// Zoom handler
function handleWheel(event: WheelEvent) {
  event.preventDefault()
  const zoomFactor = event.deltaY > 0 ? 1.1 : 0.9
  const newScale = Math.max(0.25, Math.min(4, scale.value * zoomFactor))

  // Zoom towards mouse position
  if (containerRef.value) {
    const rect = containerRef.value.getBoundingClientRect()
    const mouseX = event.clientX - rect.left
    const mouseY = event.clientY - rect.top

    const svgX = viewBox.value.x + (mouseX / rect.width) * viewBox.value.width
    const svgY = viewBox.value.y + (mouseY / rect.height) * viewBox.value.height

    const newWidth = viewBox.value.width * (scale.value / newScale)
    const newHeight = viewBox.value.height * (scale.value / newScale)

    viewBox.value = {
      x: svgX - (mouseX / rect.width) * newWidth,
      y: svgY - (mouseY / rect.height) * newHeight,
      width: newWidth,
      height: newHeight,
    }
  }

  scale.value = newScale
}

// Reset view
function resetView() {
  scale.value = 1
  viewBox.value = {
    x: 0,
    y: 0,
    width: Math.max(layout.value.width, 800),
    height: Math.max(layout.value.height, 600),
  }
}

// Clear auto-applied defaults (user wants to see full graph)
function clearAutoDefaults() {
  showBranchRootsOnly.value = false
  maxDepth.value = null
  autoDefaultsApplied.value = false
}

// Center on active node
function centerOnActive() {
  if (!props.activeMessageId) return
  const node = layout.value.nodes.find((n) => n.id === props.activeMessageId)
  if (!node) return

  viewBox.value = {
    ...viewBox.value,
    x: node.x - viewBox.value.width / 2,
    y: node.y - viewBox.value.height / 2,
  }
}

// Global mouse event handlers for pan
onMounted(() => {
  document.addEventListener('mousemove', doPan)
  document.addEventListener('mouseup', endPan)
})

onUnmounted(() => {
  document.removeEventListener('mousemove', doPan)
  document.removeEventListener('mouseup', endPan)
})

// Computed viewBox string
const viewBoxString = computed(
  () => `${viewBox.value.x} ${viewBox.value.y} ${viewBox.value.width} ${viewBox.value.height}`
)
</script>

<template>
  <div class="flex h-full flex-col bg-gray-900">
    <!-- Controls -->
    <div class="flex items-center justify-between border-b border-gray-700 bg-gray-800 px-4 py-2">
      <div class="flex items-center gap-4">
        <!-- Branch roots filter -->
        <label class="flex items-center gap-2 text-sm text-gray-300">
          <input
            v-model="showBranchRootsOnly"
            type="checkbox"
            class="h-4 w-4 rounded border-gray-600 bg-gray-700 text-emerald-500"
            data-testid="branch-roots-toggle"
          />
          Branch roots only
        </label>

        <!-- Depth limit -->
        <label class="flex items-center gap-2 text-sm text-gray-300">
          Depth:
          <select
            v-model="maxDepth"
            class="rounded border border-gray-600 bg-gray-700 px-2 py-1 text-sm text-white"
            data-testid="depth-limit-select"
          >
            <option :value="null">All</option>
            <option v-for="d in depthOptions.filter((x) => x !== null)" :key="d" :value="d">
              {{ d }}
            </option>
          </select>
        </label>
      </div>

      <div class="flex items-center gap-2">
        <!-- Auto-defaults indicator -->
        <div
          v-if="autoDefaultsApplied"
          class="flex items-center gap-2 rounded bg-amber-900/50 px-2 py-1 text-xs text-amber-200"
          data-testid="auto-defaults-indicator"
        >
          <span>Filters auto-applied for large dataset</span>
          <button
            class="rounded bg-amber-800 px-2 py-0.5 hover:bg-amber-700"
            title="Show all nodes (may be slow)"
            @click="clearAutoDefaults"
          >
            Show all
          </button>
        </div>
        <!-- Center on active -->
        <button
          class="rounded bg-gray-700 px-3 py-1 text-sm text-gray-300 hover:bg-gray-600"
          :disabled="!activeMessageId"
          @click="centerOnActive"
        >
          Center
        </button>
        <!-- Reset view -->
        <button
          class="rounded bg-gray-700 px-3 py-1 text-sm text-gray-300 hover:bg-gray-600"
          @click="resetView"
        >
          Reset
        </button>
        <!-- Node count -->
        <span class="text-xs text-gray-500">{{ layout.nodes.length }} nodes</span>
      </div>
    </div>

    <!-- Graph container -->
    <div
      ref="containerRef"
      class="relative flex-1 overflow-hidden"
      data-testid="graph-container"
      @mousedown="startPan"
      @wheel="handleWheel"
    >
      <!-- Empty state -->
      <div
        v-if="layout.nodes.length === 0"
        class="flex h-full items-center justify-center text-gray-500"
      >
        No messages to display
      </div>

      <!-- SVG Graph -->
      <svg
        v-else
        ref="svgRef"
        class="h-full w-full"
        :viewBox="viewBoxString"
        preserveAspectRatio="xMidYMid meet"
        data-testid="graph-svg"
      >
        <!-- Edges -->
        <g class="edges">
          <path
            v-for="edge in layout.edges"
            :key="`${edge.from}-${edge.to}`"
            :d="`M ${edge.fromX} ${edge.fromY + NODE_RADIUS} Q ${edge.fromX} ${(edge.fromY + edge.toY) / 2} ${edge.toX} ${edge.toY - NODE_RADIUS}`"
            fill="none"
            stroke="#4b5563"
            stroke-width="2"
            class="transition-colors"
          />
        </g>

        <!-- Nodes -->
        <g class="nodes">
          <g
            v-for="node in layout.nodes"
            :key="node.id"
            class="cursor-pointer"
            :transform="`translate(${node.x}, ${node.y})`"
            :data-testid="`graph-node-${node.id}`"
            @click="handleNodeClick(node)"
            @mouseenter="showTooltip(node, $event)"
            @mouseleave="hideTooltip"
          >
            <!-- Node circle -->
            <circle
              :r="NODE_RADIUS"
              :fill="getRoleColor(node.message.role)"
              :stroke="
                node.id === activeMessageId
                  ? '#fbbf24'
                  : node.id === highlightedMessageId
                    ? '#f59e0b'
                    : node.isBranchRoot
                      ? '#ffffff'
                      : 'transparent'
              "
              :stroke-width="
                node.id === activeMessageId || node.id === highlightedMessageId ? 4 : node.isBranchRoot ? 2 : 0
              "
              class="transition-all hover:opacity-80"
            />

            <!-- Role icon -->
            <text
              text-anchor="middle"
              dominant-baseline="central"
              fill="white"
              font-size="16"
              class="pointer-events-none select-none"
            >
              {{ node.message.role === 'user' ? '👤' : node.message.role === 'assistant' ? '🤖' : '⚙️' }}
            </text>

            <!-- Branch title badge -->
            <g v-if="node.message.branchTitle" transform="translate(0, -30)">
              <rect
                x="-30"
                y="-10"
                width="60"
                height="20"
                rx="4"
                fill="#374151"
                stroke="#6b7280"
              />
              <text
                text-anchor="middle"
                dominant-baseline="central"
                fill="#d1d5db"
                font-size="10"
                class="pointer-events-none"
              >
                {{ node.message.branchTitle.slice(0, 8) }}{{ node.message.branchTitle.length > 8 ? '...' : '' }}
              </text>
            </g>
          </g>
        </g>
      </svg>

      <!-- Tooltip -->
      <div
        v-if="tooltipNode"
        class="pointer-events-none absolute z-50 max-w-xs rounded-lg bg-gray-800 p-3 text-sm shadow-lg"
        :style="{
          left: `${tooltipPosition.x + 10}px`,
          top: `${tooltipPosition.y + 10}px`,
        }"
        data-testid="graph-tooltip"
      >
        <!-- Role badge -->
        <div class="mb-2 flex items-center gap-2">
          <span
            class="rounded px-2 py-0.5 text-xs font-medium"
            :class="{
              'bg-emerald-900 text-emerald-200': tooltipNode.message.role === 'user',
              'bg-blue-900 text-blue-200': tooltipNode.message.role === 'assistant',
              'bg-gray-700 text-gray-300': tooltipNode.message.role === 'system',
            }"
          >
            {{ tooltipNode.message.role }}
          </span>
          <span v-if="tooltipNode.message.branchTitle" class="rounded bg-purple-900 px-2 py-0.5 text-xs text-purple-200">
            {{ tooltipNode.message.branchTitle }}
          </span>
        </div>

        <!-- Content snippet -->
        <p class="mb-2 whitespace-pre-wrap text-gray-300">
          {{ getNodeSnippet(tooltipNode.message.content, 150) }}
        </p>

        <!-- Metadata -->
        <div class="text-xs text-gray-500">
          {{ formatTimestamp(tooltipNode.message.createdAt) }}
          <span v-if="tooltipNode.childCount > 0" class="ml-2">
            · {{ tooltipNode.childCount }} {{ tooltipNode.childCount === 1 ? 'reply' : 'replies' }}
          </span>
        </div>
      </div>

      <!-- Pan indicator -->
      <div
        v-if="isPanning"
        class="pointer-events-none absolute inset-0 bg-black/10"
      ></div>
    </div>
  </div>
</template>
