/**
 * Graph Layout Utilities
 *
 * Pure functions for computing graph layouts for conversation tree visualization.
 * Uses a simple tree layout algorithm that positions nodes in a top-down arrangement.
 *
 * Design decisions:
 * - Deterministic layout: same input always produces same output
 * - No external dependencies: pure SVG rendering approach
 * - Efficient computation: builds adjacency once, computes positions in single pass
 */

import type { Message } from '@/db/types'
import { buildChildrenMap, getDepth, getRoots } from '@/db/treeUtils'

/**
 * Node position in the graph
 */
export interface GraphNode {
  id: string
  x: number
  y: number
  message: Message
  depth: number
  isBranchRoot: boolean
  childCount: number
}

/**
 * Edge between two nodes
 */
export interface GraphEdge {
  from: string
  to: string
  fromX: number
  fromY: number
  toX: number
  toY: number
}

/**
 * Complete graph layout result
 */
export interface GraphLayout {
  nodes: GraphNode[]
  edges: GraphEdge[]
  width: number
  height: number
}

/**
 * Layout configuration options
 */
export interface LayoutOptions {
  /** Horizontal spacing between sibling nodes */
  nodeSpacingX: number
  /** Vertical spacing between tree levels */
  nodeSpacingY: number
  /** Node radius for rendering */
  nodeRadius: number
  /** Padding around the graph */
  padding: number
}

/**
 * Filter options for graph density control
 */
export interface FilterOptions {
  /** Show only branch root nodes (nodes with branchTitle or >1 child) */
  branchRootsOnly: boolean
  /** Maximum depth from root to display (null = no limit) */
  maxDepth: number | null
  /** Collapse linear chains (show only branch points and leaves) */
  collapseLinearChains: boolean
}

const DEFAULT_LAYOUT_OPTIONS: LayoutOptions = {
  nodeSpacingX: 80,
  nodeSpacingY: 100,
  nodeRadius: 20,
  padding: 40,
}

const DEFAULT_FILTER_OPTIONS: FilterOptions = {
  branchRootsOnly: false,
  maxDepth: null,
  collapseLinearChains: false,
}

/**
 * Build adjacency structure from messages
 * This is the primary data structure for graph operations
 */
export function buildGraphAdjacency(messages: Message[]): {
  messageMap: Map<string, Message>
  childrenMap: Map<string, Message[]>
  roots: Message[]
} {
  const messageMap = new Map<string, Message>()
  for (const msg of messages) {
    messageMap.set(msg.id, msg)
  }

  const childrenMap = buildChildrenMap(messageMap)
  const roots = getRoots(messageMap)

  return { messageMap, childrenMap, roots }
}

/**
 * Check if a message is a branch root
 * A branch root is either:
 * - Has a branchTitle
 * - Has multiple children (branch point)
 * - Is a root message with siblings
 */
export function isBranchRoot(
  message: Message,
  childrenMap: Map<string, Message[]>,
  messageMap: Map<string, Message>
): boolean {
  // Has explicit branch title
  if (message.branchTitle) {
    return true
  }

  // Is a branch point (has multiple children)
  const children = childrenMap.get(message.id) ?? []
  if (children.length > 1) {
    return true
  }

  // Is a root with siblings (multiple roots)
  if (message.parentId === null) {
    const roots = getRoots(messageMap)
    if (roots.length > 1) {
      return true
    }
  }

  // Is a child of a branch point (sibling exists)
  if (message.parentId) {
    const siblings = childrenMap.get(message.parentId) ?? []
    if (siblings.length > 1) {
      return true
    }
  }

  return false
}

/**
 * Filter messages based on density control options
 */
export function filterMessages(
  messages: Message[],
  options: FilterOptions,
  childrenMap: Map<string, Message[]>,
  messageMap: Map<string, Message>
): Message[] {
  let filtered = [...messages]

  // Apply depth filter
  if (options.maxDepth !== null) {
    filtered = filtered.filter((msg) => {
      const depth = getDepth(msg.id, messageMap)
      return depth <= options.maxDepth!
    })
  }

  // Apply branch roots only filter
  if (options.branchRootsOnly) {
    // Keep: roots, branch points, branch-titled nodes, and leaves
    filtered = filtered.filter((msg) => {
      // Always show roots
      if (msg.parentId === null) return true

      // Show if it has a branch title
      if (msg.branchTitle) return true

      // Show if it's a branch point (multiple children)
      const children = childrenMap.get(msg.id) ?? []
      if (children.length > 1) return true

      // Show if it's a leaf (no children)
      if (children.length === 0) return true

      // Show if it's a child of a branch point (has siblings)
      const siblings = childrenMap.get(msg.parentId!) ?? []
      if (siblings.length > 1) return true

      return false
    })
  }

  // Apply collapse linear chains filter
  if (options.collapseLinearChains) {
    filtered = filtered.filter((msg) => {
      // Always show roots
      if (msg.parentId === null) return true

      // Show if it has a branch title
      if (msg.branchTitle) return true

      // Show branch points
      const children = childrenMap.get(msg.id) ?? []
      if (children.length !== 1) return true // 0 (leaf) or >1 (branch point)

      // Show if parent has multiple children (start of chain)
      const parentChildren = childrenMap.get(msg.parentId!) ?? []
      if (parentChildren.length > 1) return true

      return false
    })
  }

  return filtered
}

/**
 * Compute tree layout positions for messages
 * Uses a simple algorithm:
 * 1. Assign depth (y position) based on tree depth
 * 2. Assign x positions using a recursive subtree width calculation
 */
export function computeTreeLayout(
  messages: Message[],
  layoutOptions: Partial<LayoutOptions> = {},
  filterOptions: Partial<FilterOptions> = {}
): GraphLayout {
  const options = { ...DEFAULT_LAYOUT_OPTIONS, ...layoutOptions }
  const filters = { ...DEFAULT_FILTER_OPTIONS, ...filterOptions }

  if (messages.length === 0) {
    return { nodes: [], edges: [], width: 0, height: 0 }
  }

  // Build adjacency
  const { messageMap, childrenMap, roots } = buildGraphAdjacency(messages)

  // Filter messages
  const filteredMessages = filterMessages(messages, filters, childrenMap, messageMap)
  const filteredSet = new Set(filteredMessages.map((m) => m.id))

  // Build filtered children map (only include edges where both nodes are in filtered set)
  const filteredChildrenMap = new Map<string, Message[]>()
  for (const [parentId, children] of childrenMap) {
    if (filteredSet.has(parentId)) {
      const filteredChildren = children.filter((c) => filteredSet.has(c.id))
      if (filteredChildren.length > 0) {
        filteredChildrenMap.set(parentId, filteredChildren)
      }
    }
  }

  // Find filtered roots
  const filteredRoots = roots.filter((r) => filteredSet.has(r.id))

  // Calculate subtree widths for x positioning
  const subtreeWidths = new Map<string, number>()

  function calculateSubtreeWidth(nodeId: string): number {
    const children = filteredChildrenMap.get(nodeId) ?? []
    if (children.length === 0) {
      subtreeWidths.set(nodeId, 1)
      return 1
    }

    let totalWidth = 0
    for (const child of children) {
      totalWidth += calculateSubtreeWidth(child.id)
    }
    subtreeWidths.set(nodeId, totalWidth)
    return totalWidth
  }

  // Calculate widths for all roots
  for (const root of filteredRoots) {
    calculateSubtreeWidth(root.id)
  }

  // Position nodes
  const nodes: GraphNode[] = []
  const nodePositions = new Map<string, { x: number; y: number }>()

  function positionNode(
    nodeId: string,
    depth: number,
    leftBound: number
  ): number {
    const message = messageMap.get(nodeId)
    if (!message || !filteredSet.has(nodeId)) return leftBound

    const children = filteredChildrenMap.get(nodeId) ?? []
    const nodeWidth = subtreeWidths.get(nodeId) ?? 1

    // Position children first (to calculate center)
    let currentLeft = leftBound
    const childPositions: number[] = []

    for (const child of children) {
      const childWidth = subtreeWidths.get(child.id) ?? 1
      const childX = positionNode(child.id, depth + 1, currentLeft)
      childPositions.push(childX)
      currentLeft += childWidth * options.nodeSpacingX
    }

    // Position this node at center of children, or at leftBound if leaf
    let x: number
    if (childPositions.length > 0) {
      x = (childPositions[0]! + childPositions[childPositions.length - 1]!) / 2
    } else {
      x = leftBound + (nodeWidth * options.nodeSpacingX) / 2
    }

    const y = depth * options.nodeSpacingY + options.padding

    nodePositions.set(nodeId, { x, y })

    nodes.push({
      id: nodeId,
      x,
      y,
      message,
      depth,
      isBranchRoot: isBranchRoot(message, childrenMap, messageMap),
      childCount: (childrenMap.get(nodeId) ?? []).length,
    })

    return x
  }

  // Position all root subtrees
  let currentLeft = options.padding
  for (const root of filteredRoots) {
    const rootWidth = subtreeWidths.get(root.id) ?? 1
    positionNode(root.id, 0, currentLeft)
    currentLeft += rootWidth * options.nodeSpacingX
  }

  // Build edges
  const edges: GraphEdge[] = []
  for (const [parentId, children] of filteredChildrenMap) {
    const parentPos = nodePositions.get(parentId)
    if (!parentPos) continue

    for (const child of children) {
      const childPos = nodePositions.get(child.id)
      if (!childPos) continue

      edges.push({
        from: parentId,
        to: child.id,
        fromX: parentPos.x,
        fromY: parentPos.y,
        toX: childPos.x,
        toY: childPos.y,
      })
    }
  }

  // Calculate bounds
  let maxX = 0
  let maxY = 0
  for (const node of nodes) {
    maxX = Math.max(maxX, node.x)
    maxY = Math.max(maxY, node.y)
  }

  return {
    nodes,
    edges,
    width: maxX + options.padding * 2,
    height: maxY + options.padding * 2,
  }
}

/**
 * Get a content snippet for tooltip display
 */
export function getNodeSnippet(content: string, maxLength: number = 100): string {
  if (content.length <= maxLength) {
    return content
  }
  return content.substring(0, maxLength - 3) + '...'
}

/**
 * Format timestamp for display
 */
export function formatTimestamp(isoString: string): string {
  const date = new Date(isoString)
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
