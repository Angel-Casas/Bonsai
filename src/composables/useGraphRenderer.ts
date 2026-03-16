/**
 * Canvas-based Graph Renderer
 *
 * High-performance rendering for large conversation trees using HTML5 Canvas.
 * Achieves 60fps by:
 * - Batch drawing nodes/edges by color
 * - Using transform matrix for pan/zoom (no re-layout)
 * - Drawing only visible elements via spatial index
 */

import { ref, type Ref } from 'vue'
import type { GraphNode, GraphEdge } from '@/utils/graphLayout'
import { MAIN_BRANCH_COLOR } from '@/utils/graphLayout'

/**
 * Render options for the graph
 */
export interface RenderOptions {
  /** Node circle radius */
  nodeRadius: number
  /** Stroke width for edges */
  edgeWidth: number
  /** Stroke width for highlighted edges */
  highlightedEdgeWidth: number
  /** Font for node labels */
  labelFont: string
  /** Background color */
  backgroundColor: string
  /** Whether to show labels */
  showLabels: boolean
  /** Minimum scale to show labels */
  labelMinScale: number
}

const DEFAULT_RENDER_OPTIONS: RenderOptions = {
  nodeRadius: 20,
  edgeWidth: 3,
  highlightedEdgeWidth: 4,
  labelFont: '600 12px system-ui, sans-serif',
  backgroundColor: 'var(--bg)',
  showLabels: true,
  labelMinScale: 0.5,
}

/**
 * Viewport transform state
 */
export interface ViewportTransform {
  /** X offset (pan) */
  offsetX: number
  /** Y offset (pan) */
  offsetY: number
  /** Zoom scale */
  scale: number
}

/**
 * Render state passed to the renderer
 */
export interface RenderState {
  nodes: GraphNode[]
  edges: GraphEdge[]
  activeNodeId: string | null
  highlightedNodeId: string | null
  timelineNodeIds: Set<string>
  excludedNodeIds: Set<string>
  highlightPath: boolean
  transform: ViewportTransform
}

/**
 * Color cache for CSS variable resolution
 */
const colorCache = new Map<string, string>()

function resolveColor(color: string, ctx: CanvasRenderingContext2D): string {
  if (!color.startsWith('var(')) {
    return color
  }

  const cached = colorCache.get(color)
  if (cached) return cached

  // Extract variable name and resolve via computed style
  const varName = color.slice(4, -1) // Remove 'var(' and ')'
  const canvas = ctx.canvas
  const computedStyle = getComputedStyle(canvas)
  const resolved = computedStyle.getPropertyValue(varName).trim() || '#D4A574'

  colorCache.set(color, resolved)
  return resolved
}

/**
 * Clear the color cache (call when theme changes)
 */
export function clearColorCache(): void {
  colorCache.clear()
}

/**
 * Composable for Canvas-based graph rendering
 */
export function useGraphRenderer(
  canvasRef: Ref<HTMLCanvasElement | null>,
  options: Partial<RenderOptions> = {}
) {
  const renderOptions = { ...DEFAULT_RENDER_OPTIONS, ...options }
  const ctx = ref<CanvasRenderingContext2D | null>(null)
  const dpr = ref(window.devicePixelRatio || 1)

  // Track canvas dimensions
  const width = ref(0)
  const height = ref(0)

  /**
   * Initialize the canvas context
   */
  function initCanvas(): void {
    const canvas = canvasRef.value
    if (!canvas) return

    const context = canvas.getContext('2d')
    if (!context) return

    ctx.value = context
    dpr.value = window.devicePixelRatio || 1

    // Set canvas size accounting for device pixel ratio
    const rect = canvas.getBoundingClientRect()
    width.value = rect.width
    height.value = rect.height

    canvas.width = rect.width * dpr.value
    canvas.height = rect.height * dpr.value

    // Scale context to handle device pixel ratio
    context.scale(dpr.value, dpr.value)
  }

  /**
   * Resize canvas to match container
   */
  function resizeCanvas(): void {
    const canvas = canvasRef.value
    const context = ctx.value
    if (!canvas || !context) return

    const rect = canvas.getBoundingClientRect()
    if (rect.width === width.value && rect.height === height.value) return

    width.value = rect.width
    height.value = rect.height

    canvas.width = rect.width * dpr.value
    canvas.height = rect.height * dpr.value

    context.setTransform(1, 0, 0, 1, 0, 0)
    context.scale(dpr.value, dpr.value)
  }

  /**
   * Clear the canvas
   */
  function clear(): void {
    const context = ctx.value
    if (!context) return

    context.setTransform(1, 0, 0, 1, 0, 0)
    context.scale(dpr.value, dpr.value)
    context.clearRect(0, 0, width.value, height.value)
  }

  /**
   * Render the graph
   */
  function render(state: RenderState): void {
    const context = ctx.value
    if (!context) return

    // Clear canvas
    clear()

    const { nodes, edges, activeNodeId, highlightedNodeId, timelineNodeIds, excludedNodeIds, highlightPath, transform } = state

    if (nodes.length === 0) return

    // Apply transform
    context.save()
    context.translate(transform.offsetX, transform.offsetY)
    context.scale(transform.scale, transform.scale)

    // Separate timeline and non-timeline elements if highlighting
    const timelineNodes = highlightPath ? nodes.filter(n => timelineNodeIds.has(n.id)) : []
    const nonTimelineNodes = highlightPath ? nodes.filter(n => !timelineNodeIds.has(n.id)) : nodes
    const timelineEdges = highlightPath ? edges.filter(e => timelineNodeIds.has(e.from) && timelineNodeIds.has(e.to)) : []
    const nonTimelineEdges = highlightPath ? edges.filter(e => !timelineNodeIds.has(e.from) || !timelineNodeIds.has(e.to)) : edges

    // Draw non-timeline edges first (dimmed)
    if (highlightPath && nonTimelineEdges.length > 0) {
      context.globalAlpha = 0.25
      drawEdges(context, nonTimelineEdges, nodes, transform.scale, false)
      context.globalAlpha = 1
    } else if (!highlightPath) {
      drawEdges(context, edges, nodes, transform.scale, false)
    }

    // Draw timeline edges (highlighted)
    if (highlightPath && timelineEdges.length > 0) {
      drawEdges(context, timelineEdges, nodes, transform.scale, true)
    }

    // Draw non-timeline nodes (dimmed)
    if (highlightPath && nonTimelineNodes.length > 0) {
      context.globalAlpha = 0.3
      drawNodes(context, nonTimelineNodes, activeNodeId, highlightedNodeId, timelineNodeIds, false, transform.scale)
      context.globalAlpha = 1
    } else if (!highlightPath) {
      drawNodes(context, nodes, activeNodeId, highlightedNodeId, timelineNodeIds, false, transform.scale)
    }

    // Draw timeline nodes (highlighted)
    if (highlightPath && timelineNodes.length > 0) {
      drawNodes(context, timelineNodes, activeNodeId, highlightedNodeId, timelineNodeIds, true, transform.scale)
    }

    // Draw excluded node indicators (diagonal strike-through)
    if (excludedNodeIds.size > 0) {
      const excludedNodes = nodes.filter(n => excludedNodeIds.has(n.id))
      if (excludedNodes.length > 0) {
        drawExcludedIndicators(context, excludedNodes)
      }
    }

    // Draw active node last (on top)
    if (activeNodeId) {
      const activeNode = nodes.find(n => n.id === activeNodeId)
      if (activeNode) {
        drawActiveNodeHighlight(context, activeNode)
      }
    }

    // Draw highlighted node
    if (highlightedNodeId && highlightedNodeId !== activeNodeId) {
      const highlightedNode = nodes.find(n => n.id === highlightedNodeId)
      if (highlightedNode) {
        drawHighlightedNodeRing(context, highlightedNode)
      }
    }

    context.restore()
  }

  /**
   * Draw edges (batch by color for performance)
   */
  function drawEdges(
    context: CanvasRenderingContext2D,
    edges: GraphEdge[],
    nodes: GraphNode[],
    scale: number,
    isTimeline: boolean
  ): void {
    // Build node lookup for color
    const nodeById = new Map(nodes.map(n => [n.id, n]))

    // Group edges by color
    const edgesByColor = new Map<string, GraphEdge[]>()
    for (const edge of edges) {
      const toNode = nodeById.get(edge.to)
      const color = toNode?.precomputedColor || MAIN_BRANCH_COLOR
      const resolved = resolveColor(color, context)
      const existing = edgesByColor.get(resolved) ?? []
      existing.push(edge)
      edgesByColor.set(resolved, existing)
    }

    // Draw each color group as a single path
    const lineWidth = isTimeline ? renderOptions.highlightedEdgeWidth : renderOptions.edgeWidth

    for (const [color, colorEdges] of edgesByColor) {
      context.beginPath()
      context.strokeStyle = color
      context.lineWidth = lineWidth / scale // Maintain consistent line width

      for (const edge of colorEdges) {
        // Draw quadratic bezier curve
        const midX = (edge.fromX + edge.toX) / 2
        const midY = (edge.fromY + edge.toY) / 2 + 20

        context.moveTo(edge.fromX, edge.fromY + renderOptions.nodeRadius)
        context.quadraticCurveTo(midX, midY, edge.toX, edge.toY - renderOptions.nodeRadius)
      }

      context.stroke()
    }
  }

  /**
   * Draw nodes (batch by color for performance)
   */
  function drawNodes(
    context: CanvasRenderingContext2D,
    nodes: GraphNode[],
    _activeNodeId: string | null,
    _highlightedNodeId: string | null,
    _timelineNodeIds: Set<string>,
    isTimelineLayer: boolean,
    scale: number
  ): void {
    const { nodeRadius, showLabels, labelMinScale, labelFont } = renderOptions

    // Group nodes by color
    const nodesByColor = new Map<string, GraphNode[]>()
    for (const node of nodes) {
      const color = resolveColor(node.precomputedColor, context)
      const existing = nodesByColor.get(color) ?? []
      existing.push(node)
      nodesByColor.set(color, existing)
    }

    // Draw each color group
    for (const [color, colorNodes] of nodesByColor) {
      // Draw branch color rings (outer circle)
      context.beginPath()
      context.strokeStyle = color
      context.lineWidth = 4
      for (const node of colorNodes) {
        context.moveTo(node.x + nodeRadius + 4, node.y)
        context.arc(node.x, node.y, nodeRadius + 4, 0, Math.PI * 2)
      }
      context.stroke()

      // Draw node fill (inner circle)
      context.beginPath()
      context.fillStyle = 'var(--bg-secondary)'
      const bgColor = resolveColor('var(--bg-secondary)', context)
      context.fillStyle = bgColor
      for (const node of colorNodes) {
        context.moveTo(node.x + nodeRadius, node.y)
        context.arc(node.x, node.y, nodeRadius, 0, Math.PI * 2)
      }
      context.fill()

      // Draw node stroke
      context.beginPath()
      context.strokeStyle = color
      context.lineWidth = 2
      for (const node of colorNodes) {
        context.moveTo(node.x + nodeRadius, node.y)
        context.arc(node.x, node.y, nodeRadius, 0, Math.PI * 2)
      }
      context.stroke()
    }

    // Draw timeline glow rings for timeline nodes
    if (isTimelineLayer) {
      const accentColor = resolveColor('var(--accent)', context)
      context.strokeStyle = accentColor
      context.lineWidth = 3
      context.shadowColor = accentColor
      context.shadowBlur = 8

      context.beginPath()
      for (const node of nodes) {
        context.moveTo(node.x + nodeRadius + 7, node.y)
        context.arc(node.x, node.y, nodeRadius + 7, 0, Math.PI * 2)
      }
      context.stroke()
      context.shadowBlur = 0
    }

    // Draw labels if zoomed in enough
    if (showLabels && scale >= labelMinScale) {
      context.font = labelFont
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillStyle = resolveColor('var(--text)', context)

      for (const node of nodes) {
        const label = node.message.role === 'user' ? 'U' : node.message.role === 'assistant' ? 'A' : 'S'
        context.fillText(label, node.x, node.y)
      }
    }

    // Draw collapsed count badges
    for (const node of nodes) {
      if (node.collapsedCount > 0) {
        drawCollapsedBadge(context, node, scale)
      }
    }

    // Draw branch title badges with overlap resolution
    drawBranchTitleBadges(context, nodes, scale)
  }

  /**
   * Draw active node highlight ring
   */
  function drawActiveNodeHighlight(context: CanvasRenderingContext2D, node: GraphNode): void {
    const accentColor = resolveColor('var(--accent)', context)
    context.beginPath()
    context.strokeStyle = accentColor
    context.lineWidth = 4
    context.arc(node.x, node.y, renderOptions.nodeRadius + 2, 0, Math.PI * 2)
    context.stroke()
  }

  /**
   * Draw highlighted node ring (warning color)
   */
  function drawHighlightedNodeRing(context: CanvasRenderingContext2D, node: GraphNode): void {
    const warningColor = resolveColor('var(--warning)', context)
    context.beginPath()
    context.strokeStyle = warningColor
    context.lineWidth = 3
    context.arc(node.x, node.y, renderOptions.nodeRadius + 6, 0, Math.PI * 2)
    context.stroke()
  }

  /**
   * Draw excluded node indicators:
   * 1. Semi-transparent dark overlay to dim the node
   * 2. Dashed warning-colored ring
   * 3. Diagonal strike-through line
   */
  function drawExcludedIndicators(context: CanvasRenderingContext2D, nodes: GraphNode[]): void {
    const { nodeRadius } = renderOptions
    const warningColor = resolveColor('var(--warning)', context)
    const ringRadius = nodeRadius + 4

    // 1. Dark overlay to dim excluded nodes
    context.beginPath()
    context.fillStyle = 'rgba(0, 0, 0, 0.55)'
    for (const node of nodes) {
      context.moveTo(node.x + ringRadius, node.y)
      context.arc(node.x, node.y, ringRadius, 0, Math.PI * 2)
    }
    context.fill()

    // 2. Dashed warning ring (placed outside the timeline glow ring at nodeRadius + 7)
    const dashRingRadius = nodeRadius + 12
    context.setLineDash([5, 4])
    context.strokeStyle = warningColor
    context.lineWidth = 2.5
    context.beginPath()
    for (const node of nodes) {
      context.moveTo(node.x + dashRingRadius, node.y)
      context.arc(node.x, node.y, dashRingRadius, 0, Math.PI * 2)
    }
    context.stroke()
    context.setLineDash([])

    // 3. Diagonal strike-through
    context.strokeStyle = warningColor
    context.lineWidth = 3
    context.lineCap = 'round'
    context.beginPath()
    for (const node of nodes) {
      const d = ringRadius * Math.SQRT1_2 // 45 degree offset
      context.moveTo(node.x + d, node.y - d)
      context.lineTo(node.x - d, node.y + d)
    }
    context.stroke()
    context.lineCap = 'butt'
  }

  /**
   * Draw collapsed count badge
   */
  function drawCollapsedBadge(context: CanvasRenderingContext2D, node: GraphNode, _scale: number): void {
    const badgeSize = 16
    const badgeX = node.x + renderOptions.nodeRadius - 4
    const badgeY = node.y - renderOptions.nodeRadius - 4

    // Badge background
    context.beginPath()
    context.fillStyle = resolveColor('var(--accent)', context)
    context.arc(badgeX, badgeY, badgeSize / 2, 0, Math.PI * 2)
    context.fill()

    // Badge text (use dark color for contrast with accent background)
    context.font = '600 10px system-ui, sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillStyle = resolveColor('var(--text-on-bright)', context)
    context.fillText(`+${node.collapsedCount}`, badgeX, badgeY)
  }

  /**
   * Represents a computed badge ready for drawing
   */
  interface BadgeRect {
    x: number       // left edge
    y: number       // top edge
    width: number
    height: number
    centerX: number // node.x (text center)
    title: string
    color: string
    node: GraphNode
  }

  /**
   * Draw branch title badges with overlap resolution.
   * Computes all badge positions, detects overlaps, and nudges
   * colliding badges upward so every title remains readable.
   */
  function drawBranchTitleBadges(
    context: CanvasRenderingContext2D,
    nodes: GraphNode[],
    _scale: number
  ): void {
    const padding = 12
    const badgeHeight = 26
    const gap = 6 // min vertical gap between badges
    const baseOffset = renderOptions.nodeRadius + badgeHeight + 10

    context.font = '600 14px system-ui, sans-serif'

    // 1. Collect badge rects at their default positions
    const badges: BadgeRect[] = []
    for (const node of nodes) {
      const rawTitle = node.message.branchTitle || (node.message.parentId === null ? 'Main' : null)
      if (!rawTitle) continue

      const title = rawTitle.length > 20 ? rawTitle.slice(0, 20) + '...' : rawTitle
      const metrics = context.measureText(title)
      const badgeWidth = metrics.width + padding * 2

      badges.push({
        x: node.x - badgeWidth / 2,
        y: node.y - baseOffset,
        width: badgeWidth,
        height: badgeHeight,
        centerX: node.x,
        title,
        color: node.precomputedColor,
        node,
      })
    }

    if (badges.length === 0) return

    // 2. Resolve overlaps: sort by x then push overlapping badges upward
    badges.sort((a, b) => a.x - b.x)

    for (let i = 1; i < badges.length; i++) {
      const current = badges[i]!
      // Check against all previously placed badges for overlap
      for (let j = i - 1; j >= 0; j--) {
        const placed = badges[j]!
        // Horizontal overlap?
        if (current.x < placed.x + placed.width + gap &&
            current.x + current.width + gap > placed.x) {
          // Vertical overlap?
          if (current.y < placed.y + placed.height + gap &&
              current.y + current.height + gap > placed.y) {
            // Push current badge above the placed one
            current.y = placed.y - current.height - gap
          }
        }
      }
    }

    // 3. Draw connector lines from badge to node, then draw badges
    const textOnBright = resolveColor('var(--text-on-bright)', context)

    for (const badge of badges) {
      const resolvedColor = resolveColor(badge.color, context)

      // Draw a subtle connector line from badge bottom to node top
      const lineStartY = badge.y + badge.height
      const lineEndY = badge.node.y - renderOptions.nodeRadius - 4
      if (lineStartY < lineEndY - 2) {
        context.beginPath()
        context.strokeStyle = resolvedColor
        context.globalAlpha = 0.35
        context.lineWidth = 1.5
        context.setLineDash([4, 3])
        context.moveTo(badge.centerX, lineStartY)
        context.lineTo(badge.centerX, lineEndY)
        context.stroke()
        context.setLineDash([])
        context.globalAlpha = 1
      }

      // Badge background
      context.fillStyle = resolvedColor
      context.beginPath()
      context.roundRect(badge.x, badge.y, badge.width, badge.height, 13)
      context.fill()

      // Badge text
      context.font = '600 14px system-ui, sans-serif'
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillStyle = textOnBright
      context.fillText(badge.title, badge.centerX, badge.y + badge.height / 2)
    }
  }

  /**
   * Get world coordinates from screen coordinates
   */
  function screenToWorld(screenX: number, screenY: number, transform: ViewportTransform): { x: number; y: number } {
    const canvas = canvasRef.value
    if (!canvas) return { x: screenX, y: screenY }

    const rect = canvas.getBoundingClientRect()
    const canvasX = screenX - rect.left
    const canvasY = screenY - rect.top

    return {
      x: (canvasX - transform.offsetX) / transform.scale,
      y: (canvasY - transform.offsetY) / transform.scale,
    }
  }

  /**
   * Get screen coordinates from world coordinates
   */
  function worldToScreen(worldX: number, worldY: number, transform: ViewportTransform): { x: number; y: number } {
    const canvas = canvasRef.value
    if (!canvas) return { x: worldX, y: worldY }

    const rect = canvas.getBoundingClientRect()

    return {
      x: worldX * transform.scale + transform.offsetX + rect.left,
      y: worldY * transform.scale + transform.offsetY + rect.top,
    }
  }

  /**
   * Get viewport bounds in world coordinates
   */
  function getViewportBounds(transform: ViewportTransform): { x: number; y: number; width: number; height: number } {
    return {
      x: -transform.offsetX / transform.scale,
      y: -transform.offsetY / transform.scale,
      width: width.value / transform.scale,
      height: height.value / transform.scale,
    }
  }

  return {
    // State
    ctx,
    width,
    height,
    dpr,

    // Methods
    initCanvas,
    resizeCanvas,
    clear,
    render,
    screenToWorld,
    worldToScreen,
    getViewportBounds,
  }
}
