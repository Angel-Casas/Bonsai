/**
 * Spatial index for efficient viewport culling in graph visualization
 *
 * Uses a quadtree data structure to enable O(log n + k) queries where:
 * - n = total number of nodes
 * - k = number of nodes in the query region
 *
 * This allows rendering only visible nodes instead of all nodes,
 * dramatically improving performance for large graphs (1000+ nodes).
 */

import type { GraphNode, GraphEdge } from './graphLayout'

/**
 * Axis-aligned bounding box
 */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Quadtree node - either a leaf containing items or an internal node with 4 children
 */
interface QuadtreeNode {
  bounds: Rect
  items: GraphNode[]
  children: QuadtreeNode[] | null // NW, NE, SW, SE
  depth: number
}

/**
 * Quadtree configuration
 */
interface QuadtreeConfig {
  /** Maximum items per leaf before splitting */
  maxItems: number
  /** Maximum tree depth */
  maxDepth: number
}

const DEFAULT_CONFIG: QuadtreeConfig = {
  maxItems: 16,
  maxDepth: 8,
}

/**
 * GraphSpatialIndex - Quadtree-based spatial indexing for graph nodes
 *
 * Provides efficient queries for:
 * - Nodes within a viewport (for rendering)
 * - Nodes near a point (for hit detection)
 */
export class GraphSpatialIndex {
  private root: QuadtreeNode | null = null
  private nodeById: Map<string, GraphNode> = new Map()
  private edgesByNode: Map<string, GraphEdge[]> = new Map()
  private config: QuadtreeConfig

  constructor(config: Partial<QuadtreeConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Build the spatial index from graph nodes and edges
   * Call this after layout computation
   */
  build(nodes: GraphNode[], edges: GraphEdge[]): void {
    this.nodeById.clear()
    this.edgesByNode.clear()

    if (nodes.length === 0) {
      this.root = null
      return
    }

    // Build node lookup
    for (const node of nodes) {
      this.nodeById.set(node.id, node)
    }

    // Build edge lookup (edges connected to each node)
    for (const edge of edges) {
      const fromEdges = this.edgesByNode.get(edge.from) ?? []
      fromEdges.push(edge)
      this.edgesByNode.set(edge.from, fromEdges)

      const toEdges = this.edgesByNode.get(edge.to) ?? []
      toEdges.push(edge)
      this.edgesByNode.set(edge.to, toEdges)
    }

    // Calculate bounds that contain all nodes
    const bounds = this.calculateBounds(nodes)

    // Create root node
    this.root = {
      bounds,
      items: [],
      children: null,
      depth: 0,
    }

    // Insert all nodes
    for (const node of nodes) {
      this.insert(this.root, node)
    }
  }

  /**
   * Query nodes within a rectangular viewport
   * Returns nodes that are within or intersect the viewport
   */
  queryViewport(viewport: Rect, buffer: number = 0): GraphNode[] {
    if (!this.root) return []

    const results: GraphNode[] = []
    const expandedViewport: Rect = {
      x: viewport.x - buffer,
      y: viewport.y - buffer,
      width: viewport.width + buffer * 2,
      height: viewport.height + buffer * 2,
    }

    this.queryRect(this.root, expandedViewport, results)
    return results
  }

  /**
   * Query nodes near a point (for hit detection)
   * Returns nodes within the specified radius
   */
  queryPoint(x: number, y: number, radius: number): GraphNode[] {
    const queryRect: Rect = {
      x: x - radius,
      y: y - radius,
      width: radius * 2,
      height: radius * 2,
    }

    const candidates = this.queryViewport(queryRect)

    // Filter to nodes actually within radius
    return candidates.filter((node) => {
      const dx = node.x - x
      const dy = node.y - y
      return dx * dx + dy * dy <= radius * radius
    })
  }

  /**
   * Get edges that should be rendered for the given visible nodes
   * Returns edges where at least one endpoint is visible
   */
  getVisibleEdges(visibleNodeIds: Set<string>, allEdges: GraphEdge[]): GraphEdge[] {
    return allEdges.filter(
      (edge) => visibleNodeIds.has(edge.from) || visibleNodeIds.has(edge.to)
    )
  }

  /**
   * Get a node by ID
   */
  getNode(id: string): GraphNode | undefined {
    return this.nodeById.get(id)
  }

  /**
   * Get all nodes (for when viewport culling is disabled)
   */
  getAllNodes(): GraphNode[] {
    return Array.from(this.nodeById.values())
  }

  /**
   * Check if index is empty
   */
  isEmpty(): boolean {
    return this.root === null
  }

  // Private methods

  private calculateBounds(nodes: GraphNode[]): Rect {
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

    // Add padding
    const padding = 100
    return {
      x: minX - padding,
      y: minY - padding,
      width: maxX - minX + padding * 2,
      height: maxY - minY + padding * 2,
    }
  }

  private insert(node: QuadtreeNode, item: GraphNode): void {
    // If this is a leaf node
    if (node.children === null) {
      node.items.push(item)

      // Split if over capacity and under max depth
      if (node.items.length > this.config.maxItems && node.depth < this.config.maxDepth) {
        this.split(node)
      }
      return
    }

    // Find the child that contains this item
    const childIndex = this.getChildIndex(node.bounds, item.x, item.y)
    if (childIndex !== -1) {
      this.insert(node.children[childIndex]!, item)
    } else {
      // Item spans multiple children, keep in this node
      node.items.push(item)
    }
  }

  private split(node: QuadtreeNode): void {
    const { x, y, width, height } = node.bounds
    const halfW = width / 2
    const halfH = height / 2

    node.children = [
      // NW
      { bounds: { x, y, width: halfW, height: halfH }, items: [], children: null, depth: node.depth + 1 },
      // NE
      { bounds: { x: x + halfW, y, width: halfW, height: halfH }, items: [], children: null, depth: node.depth + 1 },
      // SW
      { bounds: { x, y: y + halfH, width: halfW, height: halfH }, items: [], children: null, depth: node.depth + 1 },
      // SE
      { bounds: { x: x + halfW, y: y + halfH, width: halfW, height: halfH }, items: [], children: null, depth: node.depth + 1 },
    ]

    // Redistribute items
    const items = node.items
    node.items = []

    for (const item of items) {
      this.insert(node, item)
    }
  }

  private getChildIndex(bounds: Rect, px: number, py: number): number {
    const midX = bounds.x + bounds.width / 2
    const midY = bounds.y + bounds.height / 2

    const isNorth = py < midY
    const isWest = px < midX

    if (isNorth && isWest) return 0 // NW
    if (isNorth && !isWest) return 1 // NE
    if (!isNorth && isWest) return 2 // SW
    return 3 // SE
  }

  private queryRect(node: QuadtreeNode, rect: Rect, results: GraphNode[]): void {
    // Check if query rect intersects this node's bounds
    if (!this.rectsIntersect(node.bounds, rect)) {
      return
    }

    // Add items from this node that are in the query rect
    for (const item of node.items) {
      if (this.pointInRect(item.x, item.y, rect)) {
        results.push(item)
      }
    }

    // Recurse into children
    if (node.children) {
      for (const child of node.children) {
        this.queryRect(child, rect, results)
      }
    }
  }

  private rectsIntersect(a: Rect, b: Rect): boolean {
    return !(
      a.x + a.width < b.x ||
      b.x + b.width < a.x ||
      a.y + a.height < b.y ||
      b.y + b.height < a.y
    )
  }

  private pointInRect(x: number, y: number, rect: Rect): boolean {
    return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height
  }
}

/**
 * Create a spatial index from a graph layout
 * Convenience function for common use case
 */
export function createSpatialIndex(
  nodes: GraphNode[],
  edges: GraphEdge[],
  config?: Partial<QuadtreeConfig>
): GraphSpatialIndex {
  const index = new GraphSpatialIndex(config)
  index.build(nodes, edges)
  return index
}
