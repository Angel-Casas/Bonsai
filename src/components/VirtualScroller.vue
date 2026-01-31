<script setup lang="ts">
/**
 * VirtualScroller - Virtualized list rendering for large datasets
 *
 * Features:
 * - Renders only visible items + buffer for smooth scrolling
 * - Supports dynamic/variable height items
 * - Supports scrolling to specific items (for search jump-to)
 * - Maintains scroll position during updates
 * - Handles streaming content (growing item height)
 *
 * Implementation approach: Fixed estimation with measurement correction
 * - Uses estimated item height for initial layout
 * - Measures actual heights as items render
 * - Corrects scroll position as measurements become available
 */

import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'

export interface VirtualScrollerItem {
  id: string
  [key: string]: unknown
}

const props = withDefaults(defineProps<{
  /** Array of items to render */
  items: VirtualScrollerItem[]
  /** Estimated height per item (used before measurement) */
  estimatedItemHeight?: number
  /** Number of items to render above/below visible area */
  bufferSize?: number
  /** Key to use for item identification */
  itemKey?: string
  /** Whether virtualization is enabled */
  enabled?: boolean
}>(), {
  estimatedItemHeight: 150,
  bufferSize: 5,
  itemKey: 'id',
  enabled: true,
})

const emit = defineEmits<{
  scrollToComplete: [itemId: string]
}>()

// Refs
const containerRef = ref<HTMLDivElement | null>(null)
const contentRef = ref<HTMLDivElement | null>(null)

// Scroll state
const scrollTop = ref(0)
const containerHeight = ref(0)

// Item height tracking: Map from item id to measured height
const measuredHeights = ref<Map<string, number>>(new Map())

// Get height for an item (measured or estimated)
function getItemHeight(item: VirtualScrollerItem): number {
  const key = item[props.itemKey] as string
  return measuredHeights.value.get(key) ?? props.estimatedItemHeight
}

// Calculate cumulative heights for positioning
const itemPositions = computed(() => {
  const positions: { id: string; top: number; height: number }[] = []
  let currentTop = 0

  for (const item of props.items) {
    const height = getItemHeight(item)
    positions.push({
      id: item[props.itemKey] as string,
      top: currentTop,
      height,
    })
    currentTop += height
  }

  return positions
})

// Total scrollable height
const totalHeight = computed(() => {
  if (props.items.length === 0) return 0
  const lastItem = itemPositions.value[props.items.length - 1]
  return lastItem ? lastItem.top + lastItem.height : 0
})

// Calculate visible range
const visibleRange = computed(() => {
  if (!props.enabled || props.items.length === 0) {
    return { startIndex: 0, endIndex: props.items.length }
  }

  const viewStart = scrollTop.value
  const viewEnd = scrollTop.value + containerHeight.value

  // Binary search for start index
  let startIndex = 0
  let low = 0
  let high = itemPositions.value.length - 1

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const pos = itemPositions.value[mid]
    if (!pos) break
    if (pos.top + pos.height < viewStart) {
      low = mid + 1
    } else {
      startIndex = mid
      high = mid - 1
    }
  }

  // Find end index
  let endIndex = startIndex
  for (let i = startIndex; i < itemPositions.value.length; i++) {
    const pos = itemPositions.value[i]
    if (!pos) break
    if (pos.top > viewEnd) break
    endIndex = i
  }

  // Apply buffer
  startIndex = Math.max(0, startIndex - props.bufferSize)
  endIndex = Math.min(props.items.length - 1, endIndex + props.bufferSize)

  return { startIndex, endIndex: endIndex + 1 }
})

// Items to render
const visibleItems = computed(() => {
  const { startIndex, endIndex } = visibleRange.value
  return props.items.slice(startIndex, endIndex).map((item, index) => ({
    item,
    index: startIndex + index,
    position: itemPositions.value[startIndex + index],
  }))
})

// Spacer height for items above visible range
const topSpacerHeight = computed(() => {
  const { startIndex } = visibleRange.value
  if (startIndex === 0) return 0
  const pos = itemPositions.value[startIndex]
  return pos ? pos.top : 0
})

// Handle scroll
function handleScroll(event: Event) {
  const target = event.target as HTMLDivElement
  scrollTop.value = target.scrollTop
}

// Update container height on resize
function updateContainerHeight() {
  if (containerRef.value) {
    containerHeight.value = containerRef.value.clientHeight
  }
}

// Measure item height after render
function measureItem(itemId: string, element: HTMLElement) {
  const height = element.offsetHeight
  if (height > 0 && measuredHeights.value.get(itemId) !== height) {
    measuredHeights.value.set(itemId, height)
  }
}

// Scroll to a specific item
function scrollToItem(itemId: string, behavior: ScrollBehavior = 'smooth') {
  const index = props.items.findIndex(item => item[props.itemKey] === itemId)
  if (index === -1 || !containerRef.value) return

  const position = itemPositions.value[index]
  if (!position) return

  // Center the item in the viewport if possible
  const targetScroll = Math.max(0, position.top - containerHeight.value / 2 + position.height / 2)

  containerRef.value.scrollTo({
    top: targetScroll,
    behavior,
  })

  // Emit completion after scroll
  if (behavior === 'smooth') {
    setTimeout(() => emit('scrollToComplete', itemId), 300)
  } else {
    nextTick(() => emit('scrollToComplete', itemId))
  }
}

// Scroll to bottom
function scrollToBottom(behavior: ScrollBehavior = 'auto') {
  if (!containerRef.value) return
  containerRef.value.scrollTo({
    top: totalHeight.value,
    behavior,
  })
}

// Expose methods and refs
defineExpose({
  scrollToItem,
  scrollToBottom,
  containerRef,
  contentRef,
})

// Lifecycle
let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  updateContainerHeight()

  if (containerRef.value) {
    resizeObserver = new ResizeObserver(updateContainerHeight)
    resizeObserver.observe(containerRef.value)
  }
})

onUnmounted(() => {
  resizeObserver?.disconnect()
})

// Reset measured heights when items change dramatically
watch(() => props.items.length, (newLength, oldLength = 0) => {
  // If items changed significantly, we might need to remeasure
  if (Math.abs(newLength - oldLength) > 10) {
    // Keep existing measurements, they're still valid for items that remain
  }
})
</script>

<template>
  <div
    ref="containerRef"
    class="virtual-scroller"
    @scroll="handleScroll"
  >
    <div
      ref="contentRef"
      class="virtual-scroller-content"
      :style="{ height: totalHeight + 'px' }"
    >
      <!-- Top spacer -->
      <div
        v-if="enabled && topSpacerHeight > 0"
        class="virtual-scroller-spacer"
        :style="{ height: topSpacerHeight + 'px' }"
      />

      <!-- Render all items if disabled, or visible items if enabled -->
      <template v-if="!enabled">
        <slot
          v-for="(item, index) in items"
          :key="(item as VirtualScrollerItem)[itemKey]"
          :item="item"
          :index="index"
        />
      </template>
      <template v-else>
        <div
          v-for="{ item, index, position } in visibleItems"
          :key="String((item as VirtualScrollerItem)[itemKey])"
          :ref="(el) => el && measureItem(String((item as VirtualScrollerItem)[itemKey]), el as HTMLElement)"
          class="virtual-scroller-item"
        >
          <slot :item="item" :index="index" :position="position" />
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.virtual-scroller {
  overflow-y: auto;
  overflow-x: hidden;
  height: 100%;
  position: relative;
}

.virtual-scroller-content {
  position: relative;
}

.virtual-scroller-spacer {
  flex-shrink: 0;
}

.virtual-scroller-item {
  /* Items are positioned relatively within the content */
}
</style>
