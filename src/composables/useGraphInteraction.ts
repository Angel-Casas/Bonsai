/**
 * Graph Interaction Handler
 *
 * Manages pan/zoom/hit detection for canvas-based graph visualization.
 * Uses requestAnimationFrame for smooth 60fps interactions.
 */

import { ref, type Ref } from 'vue'
import type { GraphNode } from '@/utils/graphLayout'
import { GraphSpatialIndex } from '@/utils/graphSpatialIndex'
import type { ViewportTransform } from './useGraphRenderer'

/**
 * Interaction options
 */
export interface InteractionOptions {
  /** Minimum zoom scale */
  minScale: number
  /** Maximum zoom scale */
  maxScale: number
  /** Zoom speed multiplier */
  zoomSpeed: number
  /** Node hit detection radius */
  hitRadius: number
  /** Enable pan */
  enablePan: boolean
  /** Enable zoom */
  enableZoom: boolean
}

const DEFAULT_OPTIONS: InteractionOptions = {
  minScale: 0.1,
  maxScale: 4,
  zoomSpeed: 0.1,
  hitRadius: 24, // Slightly larger than node radius for easier clicking
  enablePan: true,
  enableZoom: true,
}

/**
 * Hit test result
 */
export interface HitResult {
  node: GraphNode
  screenX: number
  screenY: number
}

/**
 * Composable for graph interactions
 */
export function useGraphInteraction(
  canvasRef: Ref<HTMLCanvasElement | null>,
  spatialIndex: Ref<GraphSpatialIndex | null>,
  transform: Ref<ViewportTransform>,
  options: Partial<InteractionOptions> = {}
) {
  const opts = { ...DEFAULT_OPTIONS, ...options }

  // Pan state
  const isPanning = ref(false)
  const panStart = ref({ x: 0, y: 0 })
  const panStartTransform = ref({ offsetX: 0, offsetY: 0 })

  // Touch state
  const touchStartPos = ref({ x: 0, y: 0 })
  const touchStartTime = ref(0)
  const isTouchDrag = ref(false)
  const TAP_DISTANCE_THRESHOLD = 10 // px - movement beyond this is a pan, not a tap
  const TAP_TIME_THRESHOLD = 300 // ms
  let lastTouchEndTime = 0 // used to suppress synthetic mouse click after touch

  // Hover state
  const hoveredNode = ref<GraphNode | null>(null)
  const hoverPosition = ref({ x: 0, y: 0 })

  // RAF state
  let rafId: number | null = null
  let pendingRender = false

  // Callbacks
  let onRender: (() => void) | null = null
  let onNodeClick: ((node: GraphNode, event: MouseEvent) => void) | null = null
  let onNodeHover: ((node: GraphNode | null, screenX: number, screenY: number) => void) | null = null
  let onPanStart: (() => void) | null = null
  let onPanEnd: (() => void) | null = null

  /**
   * Set callback for render requests
   */
  function setRenderCallback(callback: () => void): void {
    onRender = callback
  }

  /**
   * Set callback for node clicks
   */
  function setNodeClickCallback(callback: (node: GraphNode, event: MouseEvent) => void): void {
    onNodeClick = callback
  }

  /**
   * Set callback for node hover
   */
  function setNodeHoverCallback(callback: (node: GraphNode | null, screenX: number, screenY: number) => void): void {
    onNodeHover = callback
  }

  /**
   * Set callbacks for pan events
   */
  function setPanCallbacks(start: () => void, end: () => void): void {
    onPanStart = start
    onPanEnd = end
  }

  /**
   * Request a render on next animation frame
   */
  function requestRender(): void {
    if (pendingRender) return
    pendingRender = true

    rafId = requestAnimationFrame(() => {
      pendingRender = false
      onRender?.()
    })
  }

  /**
   * Get world coordinates from screen coordinates
   */
  function screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    const canvas = canvasRef.value
    if (!canvas) return { x: screenX, y: screenY }

    const rect = canvas.getBoundingClientRect()
    const canvasX = screenX - rect.left
    const canvasY = screenY - rect.top

    return {
      x: (canvasX - transform.value.offsetX) / transform.value.scale,
      y: (canvasY - transform.value.offsetY) / transform.value.scale,
    }
  }

  /**
   * Get screen coordinates from world coordinates
   */
  function worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
    const canvas = canvasRef.value
    if (!canvas) return { x: worldX, y: worldY }

    const rect = canvas.getBoundingClientRect()

    return {
      x: worldX * transform.value.scale + transform.value.offsetX + rect.left,
      y: worldY * transform.value.scale + transform.value.offsetY + rect.top,
    }
  }

  /**
   * Hit test at screen coordinates
   */
  function hitTest(screenX: number, screenY: number): GraphNode | null {
    const index = spatialIndex.value
    if (!index) return null

    const world = screenToWorld(screenX, screenY)
    const candidates = index.queryPoint(world.x, world.y, opts.hitRadius / transform.value.scale)

    if (candidates.length === 0) return null

    // Return the closest node
    let closest: GraphNode | null = null
    let closestDist = Infinity

    for (const node of candidates) {
      const dx = node.x - world.x
      const dy = node.y - world.y
      const dist = dx * dx + dy * dy
      if (dist < closestDist) {
        closestDist = dist
        closest = node
      }
    }

    return closest
  }

  /**
   * Handle mouse down - start panning
   */
  function handleMouseDown(event: MouseEvent): void {
    if (!opts.enablePan) return
    if (event.button !== 0) return // Only left click

    // Ignore synthetic mouse event fired by browser after touch
    if (Date.now() - lastTouchEndTime < 500) return

    // Check if clicking on a node
    const node = hitTest(event.clientX, event.clientY)
    if (node) return // Don't pan if clicking a node

    isPanning.value = true
    panStart.value = { x: event.clientX, y: event.clientY }
    panStartTransform.value = {
      offsetX: transform.value.offsetX,
      offsetY: transform.value.offsetY,
    }

    onPanStart?.()

    // Add global listeners for pan
    document.addEventListener('mousemove', handleMouseMovePan)
    document.addEventListener('mouseup', handleMouseUp)
  }

  /**
   * Handle mouse move during pan
   */
  function handleMouseMovePan(event: MouseEvent): void {
    if (!isPanning.value) return

    const dx = event.clientX - panStart.value.x
    const dy = event.clientY - panStart.value.y

    transform.value = {
      ...transform.value,
      offsetX: panStartTransform.value.offsetX + dx,
      offsetY: panStartTransform.value.offsetY + dy,
    }

    requestRender()
  }

  /**
   * Handle mouse up - end panning
   */
  function handleMouseUp(_event: MouseEvent): void {
    if (isPanning.value) {
      isPanning.value = false
      onPanEnd?.()
    }

    document.removeEventListener('mousemove', handleMouseMovePan)
    document.removeEventListener('mouseup', handleMouseUp)
  }

  /**
   * Handle mouse move - hover detection
   */
  function handleMouseMove(event: MouseEvent): void {
    if (isPanning.value) return

    const node = hitTest(event.clientX, event.clientY)

    if (node !== hoveredNode.value) {
      hoveredNode.value = node
      hoverPosition.value = { x: event.clientX, y: event.clientY }
      onNodeHover?.(node, event.clientX, event.clientY)
    } else if (node) {
      // Update position even if same node
      hoverPosition.value = { x: event.clientX, y: event.clientY }
    }

    // Update cursor
    const canvas = canvasRef.value
    if (canvas) {
      canvas.style.cursor = node ? 'pointer' : (isPanning.value ? 'grabbing' : 'grab')
    }
  }

  /**
   * Handle mouse leave
   */
  function handleMouseLeave(): void {
    if (hoveredNode.value) {
      hoveredNode.value = null
      onNodeHover?.(null, 0, 0)
    }
  }

  /**
   * Handle click - node selection
   */
  function handleClick(event: MouseEvent): void {
    // Ignore if we were panning
    if (isPanning.value) return

    // Ignore synthetic click fired by browser after touch end (already handled)
    if (Date.now() - lastTouchEndTime < 500) return

    const node = hitTest(event.clientX, event.clientY)
    if (node) {
      onNodeClick?.(node, event)
    }
  }

  /**
   * Handle touch start - prepare for pan or tap
   */
  function handleTouchStart(event: TouchEvent): void {
    if (!opts.enablePan) return
    if (event.touches.length !== 1) return

    const touch = event.touches[0]!
    touchStartPos.value = { x: touch.clientX, y: touch.clientY }
    touchStartTime.value = Date.now()
    isTouchDrag.value = false

    panStartTransform.value = {
      offsetX: transform.value.offsetX,
      offsetY: transform.value.offsetY,
    }
  }

  /**
   * Handle touch move - pan the graph
   */
  function handleTouchMove(event: TouchEvent): void {
    if (event.touches.length !== 1) return
    event.preventDefault()

    const touch = event.touches[0]!
    const dx = touch.clientX - touchStartPos.value.x
    const dy = touch.clientY - touchStartPos.value.y

    // Once moved past threshold, commit to panning
    if (!isTouchDrag.value) {
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist > TAP_DISTANCE_THRESHOLD) {
        isTouchDrag.value = true
        isPanning.value = true
        onPanStart?.()
      }
    }

    if (isTouchDrag.value) {
      transform.value = {
        ...transform.value,
        offsetX: panStartTransform.value.offsetX + dx,
        offsetY: panStartTransform.value.offsetY + dy,
      }
      requestRender()
    }
  }

  /**
   * Handle touch end - finish pan or trigger tap on node
   */
  function handleTouchEnd(_event: TouchEvent): void {
    lastTouchEndTime = Date.now()

    if (isTouchDrag.value) {
      isTouchDrag.value = false
      isPanning.value = false
      onPanEnd?.()
      return
    }

    // It was a tap (short touch, minimal movement)
    const elapsed = Date.now() - touchStartTime.value
    if (elapsed < TAP_TIME_THRESHOLD) {
      const { x, y } = touchStartPos.value
      const node = hitTest(x, y)
      if (node) {
        // Show tooltip
        hoveredNode.value = node
        onNodeHover?.(node, x, y)
        // Show selection menu
        const syntheticEvent = new MouseEvent('click', { clientX: x, clientY: y })
        onNodeClick?.(node, syntheticEvent)
      } else {
        // Tap on empty space - clear hover
        if (hoveredNode.value) {
          hoveredNode.value = null
          onNodeHover?.(null, 0, 0)
        }
      }
    }
  }

  /**
   * Handle wheel - zoom
   */
  function handleWheel(event: WheelEvent): void {
    if (!opts.enableZoom) return

    event.preventDefault()

    const canvas = canvasRef.value
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const mouseX = event.clientX - rect.left
    const mouseY = event.clientY - rect.top

    // Calculate zoom
    const delta = event.deltaY > 0 ? -1 : 1
    const zoomFactor = 1 + delta * opts.zoomSpeed
    const newScale = Math.min(opts.maxScale, Math.max(opts.minScale, transform.value.scale * zoomFactor))

    if (newScale === transform.value.scale) return

    // Zoom around mouse position
    const scaleRatio = newScale / transform.value.scale

    transform.value = {
      offsetX: mouseX - (mouseX - transform.value.offsetX) * scaleRatio,
      offsetY: mouseY - (mouseY - transform.value.offsetY) * scaleRatio,
      scale: newScale,
    }

    requestRender()
  }

  /**
   * Zoom programmatically toward/away from center of the canvas
   * @param delta - positive to zoom in, negative to zoom out
   */
  function zoomByDelta(delta: number): void {
    const canvas = canvasRef.value
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const centerX = rect.width / 2
    const centerY = rect.height / 2

    const zoomFactor = 1 + delta * opts.zoomSpeed
    const newScale = Math.min(opts.maxScale, Math.max(opts.minScale, transform.value.scale * zoomFactor))

    if (newScale === transform.value.scale) return

    const scaleRatio = newScale / transform.value.scale

    transform.value = {
      offsetX: centerX - (centerX - transform.value.offsetX) * scaleRatio,
      offsetY: centerY - (centerY - transform.value.offsetY) * scaleRatio,
      scale: newScale,
    }

    requestRender()
  }

  /**
   * Reset transform to default
   */
  function resetTransform(): void {
    transform.value = { offsetX: 0, offsetY: 0, scale: 1 }
    requestRender()
  }

  /**
   * Center on a specific node
   */
  function centerOnNode(node: GraphNode): void {
    const canvas = canvasRef.value
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const centerX = rect.width / 2
    const centerY = rect.height / 2

    transform.value = {
      ...transform.value,
      offsetX: centerX - node.x * transform.value.scale,
      offsetY: centerY - node.y * transform.value.scale,
    }

    requestRender()
  }

  /**
   * Fit all nodes in view
   */
  function fitToView(nodes: GraphNode[], padding: number = 50): void {
    const canvas = canvasRef.value
    if (!canvas || nodes.length === 0) return

    const rect = canvas.getBoundingClientRect()

    // Calculate bounds
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity

    for (const node of nodes) {
      minX = Math.min(minX, node.x)
      minY = Math.min(minY, node.y)
      maxX = Math.max(maxX, node.x)
      maxY = Math.max(maxY, node.y)
    }

    const graphWidth = maxX - minX + padding * 2
    const graphHeight = maxY - minY + padding * 2

    // Calculate scale to fit
    const scaleX = rect.width / graphWidth
    const scaleY = rect.height / graphHeight
    const newScale = Math.min(scaleX, scaleY, opts.maxScale)

    // Center the graph
    const graphCenterX = (minX + maxX) / 2
    const graphCenterY = (minY + maxY) / 2

    transform.value = {
      offsetX: rect.width / 2 - graphCenterX * newScale,
      offsetY: rect.height / 2 - graphCenterY * newScale,
      scale: newScale,
    }

    requestRender()
  }

  /**
   * Set up event listeners
   */
  function setupListeners(): void {
    const canvas = canvasRef.value
    if (!canvas) return

    canvas.addEventListener('mousedown', handleMouseDown)
    canvas.addEventListener('mousemove', handleMouseMove)
    canvas.addEventListener('mouseleave', handleMouseLeave)
    canvas.addEventListener('click', handleClick)
    canvas.addEventListener('wheel', handleWheel, { passive: false })

    // Touch events for mobile pan and tap
    canvas.addEventListener('touchstart', handleTouchStart, { passive: true })
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false })
    canvas.addEventListener('touchend', handleTouchEnd, { passive: true })
  }

  /**
   * Clean up event listeners
   */
  function cleanupListeners(): void {
    const canvas = canvasRef.value
    if (!canvas) return

    canvas.removeEventListener('mousedown', handleMouseDown)
    canvas.removeEventListener('mousemove', handleMouseMove)
    canvas.removeEventListener('mouseleave', handleMouseLeave)
    canvas.removeEventListener('click', handleClick)
    canvas.removeEventListener('wheel', handleWheel)

    canvas.removeEventListener('touchstart', handleTouchStart)
    canvas.removeEventListener('touchmove', handleTouchMove)
    canvas.removeEventListener('touchend', handleTouchEnd)

    document.removeEventListener('mousemove', handleMouseMovePan)
    document.removeEventListener('mouseup', handleMouseUp)

    if (rafId !== null) {
      cancelAnimationFrame(rafId)
    }
  }

  return {
    // State
    isPanning,
    hoveredNode,
    hoverPosition,

    // Config
    minScale: opts.minScale,
    maxScale: opts.maxScale,

    // Methods
    setupListeners,
    cleanupListeners,
    setRenderCallback,
    setNodeClickCallback,
    setNodeHoverCallback,
    setPanCallbacks,
    requestRender,
    screenToWorld,
    worldToScreen,
    hitTest,
    zoomByDelta,
    resetTransform,
    centerOnNode,
    fitToView,
  }
}
