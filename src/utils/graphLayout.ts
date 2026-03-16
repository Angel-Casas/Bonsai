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
 * Compact group for hierarchical expansion
 */
export interface CompactGroup {
  /** ID of the first node in this group (representative) */
  representativeId: string
  /** All node IDs in this group */
  nodeIds: string[]
  /** Number of nodes in this group */
  count: number
}

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
  /** Number of nodes collapsed after this node (for display) */
  collapsedCount: number
  /** IDs of nodes that were collapsed after this node */
  collapsedNodeIds: string[]
  /** Pre-computed color for this node's branch (avoids O(n²) computation during render) */
  precomputedColor: string
  /** Sub-groups for hierarchical expansion (when collapsedCount > COMPACT_GROUP_SIZE) */
  compactChildGroups?: CompactGroup[]
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
  /** Compact nodes by keeping only ~20% of intermediate nodes between branch points */
  compactNodes: boolean
  /** Specific node IDs that should be shown even when compacted */
  expandedNodeIds?: Set<string>
}

const DEFAULT_LAYOUT_OPTIONS: LayoutOptions = {
  nodeSpacingX: 100,
  nodeSpacingY: 100,
  nodeRadius: 20,
  padding: 60,
}

const DEFAULT_FILTER_OPTIONS: FilterOptions = {
  branchRootsOnly: false,
  maxDepth: null,
  collapseLinearChains: false,
  compactNodes: false,
}

/**
 * Base group size for hierarchical compaction
 * Chains longer than this will be split into sub-groups
 */
export const COMPACT_GROUP_SIZE = 10

/**
 * Branch color palette - 30 pastel colors for visual distinction
 * Used across MessageTree, MessageTimeline, and GraphView for consistency
 */
export const BRANCH_COLORS = [
  // Original 10
  '#93C5FD', // soft blue
  '#F9A8D4', // soft pink
  '#FDBA74', // soft orange
  '#86EFAC', // soft green
  '#C4B5FD', // soft purple
  '#FCA5A5', // soft red
  '#5EEAD4', // soft teal
  '#FDE047', // soft yellow
  '#A5B4FC', // soft indigo
  '#F0ABFC', // soft magenta
  // Additional 20 pastel colors
  '#7DD3FC', // sky blue
  '#FDA4AF', // rose
  '#BEF264', // lime
  '#FBBF24', // amber
  '#E879F9', // fuchsia
  '#67E8F9', // cyan
  '#D8B4FE', // violet
  '#FCD34D', // golden
  '#6EE7B7', // emerald
  '#FB923C', // tangerine
  '#A78BFA', // lavender
  '#F472B6', // hot pink
  '#4ADE80', // bright green
  '#38BDF8', // bright blue
  '#FB7185', // coral
  '#A3E635', // yellow-green
  '#E9D5FF', // pale purple
  '#FECACA', // pale red
  '#D9F99D', // pale lime
  '#BAE6FD', // pale sky
]

/**
 * Main branch color - uses CSS variable for theme support
 */
export const MAIN_BRANCH_COLOR = 'var(--accent)'

/**
 * Pre-compute colors for all nodes in a single O(n) pass
 * Colors are assigned by DFS traversal, propagating parent's color to children
 * unless the child has its own branch title.
 */
export function precomputeNodeColors(
  nodes: GraphNode[],
  _childrenMap: Map<string, Message[]>,
  externalColorMap?: Map<string, string>
): void {
  // Build node lookup
  const nodeById = new Map<string, GraphNode>()
  for (const node of nodes) {
    nodeById.set(node.id, node)
  }

  // Build internal color map for branch titles (in DFS order for consistency)
  let colorIndex = 0
  const branchColorMap = new Map<string, string>()

  // First pass: assign colors to all branch titles
  for (const node of nodes) {
    if (node.message.branchTitle && !branchColorMap.has(node.message.branchTitle)) {
      // Use external map if provided, otherwise assign from palette
      if (externalColorMap?.has(node.message.branchTitle)) {
        const color = externalColorMap.get(node.message.branchTitle)!
        branchColorMap.set(node.message.branchTitle, color === 'accent' ? MAIN_BRANCH_COLOR : color)
      } else {
        branchColorMap.set(node.message.branchTitle, BRANCH_COLORS[colorIndex % BRANCH_COLORS.length]!)
        colorIndex++
      }
    }
  }

  // Second pass: DFS to propagate colors from parents to children
  // Build parent-child relationships from the filtered nodes
  const nodeChildrenMap = new Map<string, string[]>()
  for (const node of nodes) {
    if (node.message.parentId) {
      const parentNode = nodeById.get(node.message.parentId)
      if (parentNode) {
        const children = nodeChildrenMap.get(parentNode.id) ?? []
        children.push(node.id)
        nodeChildrenMap.set(parentNode.id, children)
      }
    }
  }

  // Find roots (nodes without parents in the filtered set)
  const roots = nodes.filter(n => !n.message.parentId || !nodeById.has(n.message.parentId))

  // DFS to assign colors
  function assignColor(nodeId: string, inheritedColor: string): void {
    const node = nodeById.get(nodeId)
    if (!node) return

    // Use own branch color if has branch title, otherwise inherit
    if (node.message.branchTitle && branchColorMap.has(node.message.branchTitle)) {
      node.precomputedColor = branchColorMap.get(node.message.branchTitle)!
    } else {
      node.precomputedColor = inheritedColor
    }

    // Propagate to children
    const children = nodeChildrenMap.get(nodeId) ?? []
    for (const childId of children) {
      assignColor(childId, node.precomputedColor)
    }
  }

  // Start DFS from roots
  for (const root of roots) {
    const rootColor = root.message.branchTitle && branchColorMap.has(root.message.branchTitle)
      ? branchColorMap.get(root.message.branchTitle)!
      : MAIN_BRANCH_COLOR
    root.precomputedColor = rootColor

    const children = nodeChildrenMap.get(root.id) ?? []
    for (const childId of children) {
      assignColor(childId, rootColor)
    }
  }
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

  // Apply hierarchical compact nodes filter
  // Uses logarithmic grouping: chains are compacted into groups of ~COMPACT_GROUP_SIZE
  // Clicking a compact node with >COMPACT_GROUP_SIZE hidden nodes shows intermediate groups
  const hasExpandedNodes = options.expandedNodeIds && options.expandedNodeIds.size > 0

  if (options.compactNodes || hasExpandedNodes) {
    // First, identify all linear chains
    const chainsMap = new Map<string, string[]>() // chainStartId -> [nodeIds in chain]
    const nodeToChain = new Map<string, string>() // nodeId -> chainStartId

    // Helper to check if a node is a "significant" node (branch point, branch root, or leaf)
    function isSignificantNode(msg: Message): boolean {
      // Root nodes are significant
      if (msg.parentId === null) return true

      // Branch titled nodes are significant
      if (msg.branchTitle) return true

      // Branch points (multiple children) are significant
      const children = childrenMap.get(msg.id) ?? []
      if (children.length > 1) return true

      // Leaves are significant
      if (children.length === 0) return true

      // Nodes that are children of branch points are significant (branch start)
      const parentChildren = childrenMap.get(msg.parentId!) ?? []
      if (parentChildren.length > 1) return true

      return false
    }

    // Build chains by traversing from each significant node
    for (const msg of filtered) {
      if (!isSignificantNode(msg)) continue

      const children = childrenMap.get(msg.id) ?? []
      if (children.length !== 1) continue // Only start chains from nodes with single child

      // Start a chain from this node
      const chain: string[] = []
      let current = children[0]

      while (current && !isSignificantNode(current)) {
        chain.push(current.id)
        nodeToChain.set(current.id, msg.id)
        const nextChildren = childrenMap.get(current.id) ?? []
        current = nextChildren.length === 1 ? nextChildren[0] : undefined
      }

      if (chain.length > 0) {
        chainsMap.set(msg.id, chain)
      }
    }

    // Hierarchical compaction: determine which nodes to show based on expansion state
    // When a chain is long, we show intermediate "group representatives" instead of all nodes
    function getVisibleNodesInChain(chain: string[], expandedNodeIds: Set<string>): Set<string> {
      const visible = new Set<string>()

      // Find which nodes in the chain are explicitly expanded
      const expandedInChain = chain.filter(id => expandedNodeIds.has(id))

      if (expandedInChain.length === 0) {
        // No expansions in this chain - show nothing (chain start/end are significant nodes)
        return visible
      }

      // For each expanded node, determine what to show
      // If it's a "group representative", show its sub-group representatives
      for (const expandedId of expandedInChain) {
        const indexInChain = chain.indexOf(expandedId)
        if (indexInChain === -1) continue

        // This node is visible
        visible.add(expandedId)

        // Calculate what range this expanded node represents
        // Find the next expanded node or end of chain
        const nextExpandedIndex = expandedInChain
          .map(id => chain.indexOf(id))
          .filter(idx => idx > indexInChain)
          .sort((a, b) => a - b)[0] ?? chain.length

        const rangeLength = nextExpandedIndex - indexInChain - 1

        if (rangeLength <= 0) continue

        if (rangeLength <= COMPACT_GROUP_SIZE) {
          // Small range: all nodes in range should be visible
          for (let i = indexInChain + 1; i < nextExpandedIndex; i++) {
            visible.add(chain[i]!)
          }
        } else {
          // Large range: show group representatives
          const numGroups = Math.min(COMPACT_GROUP_SIZE, Math.ceil(rangeLength / COMPACT_GROUP_SIZE))
          const groupSize = Math.ceil(rangeLength / numGroups)

          for (let g = 0; g < numGroups; g++) {
            const groupStartIndex = indexInChain + 1 + g * groupSize
            if (groupStartIndex < nextExpandedIndex) {
              visible.add(chain[groupStartIndex]!)
            }
          }
        }
      }

      return visible
    }

    // Filter based on mode
    filtered = filtered.filter((msg) => {
      // Always show significant nodes
      if (isSignificantNode(msg)) return true

      // Always show explicitly expanded nodes
      if (options.expandedNodeIds?.has(msg.id)) return true

      // Check if this node is in a chain
      const chainStartId = nodeToChain.get(msg.id)
      if (!chainStartId) return true // Not in a chain, keep it

      if (!options.compactNodes) {
        // Compact mode is off but we have expanded nodes
        // Show only nodes that are visible based on hierarchical expansion
        const chain = chainsMap.get(chainStartId)
        if (!chain) return true

        const visibleInChain = getVisibleNodesInChain(chain, options.expandedNodeIds ?? new Set())
        return visibleInChain.has(msg.id)
      }

      // Compact mode is on - hide all chain nodes (they're represented by the chain start)
      return false
    })
  }

  return filtered
}

/**
 * Find the nearest filtered ancestor for a node
 */
function findFilteredAncestor(
  nodeId: string,
  messageMap: Map<string, Message>,
  filteredSet: Set<string>
): string | null {
  let current = messageMap.get(nodeId)
  while (current && current.parentId) {
    if (filteredSet.has(current.parentId)) {
      return current.parentId
    }
    current = messageMap.get(current.parentId)
  }
  return null
}

/**
 * Compute tree layout positions for messages
 * Uses a simple algorithm:
 * 1. Assign depth (y position) based on tree depth
 * 2. Assign x positions keeping main branch vertical, branches to sides
 * 3. Pre-compute colors for O(1) lookup during render
 *
 * @param messages - All messages in the conversation
 * @param layoutOptions - Layout configuration (spacing, padding, etc.)
 * @param filterOptions - Filtering options (compact mode, etc.)
 * @param branchColorMap - Optional external color map for consistency with other views
 */
export function computeTreeLayout(
  messages: Message[],
  layoutOptions: Partial<LayoutOptions> = {},
  filterOptions: Partial<FilterOptions> = {},
  branchColorMap?: Map<string, string>
): GraphLayout {
  const options = { ...DEFAULT_LAYOUT_OPTIONS, ...layoutOptions }
  const filters = { ...DEFAULT_FILTER_OPTIONS, ...filterOptions }

  if (messages.length === 0) {
    return { nodes: [], edges: [], width: 0, height: 0 }
  }

  // Build adjacency
  const { messageMap, childrenMap } = buildGraphAdjacency(messages)

  // Filter messages
  const filteredMessages = filterMessages(messages, filters, childrenMap, messageMap)
  const filteredSet = new Set(filteredMessages.map((m) => m.id))

  // Build filtered children map with ancestor connections
  // This connects filtered nodes even when intermediate nodes are filtered out
  const filteredChildrenMap = new Map<string, Message[]>()

  // Track collapsed node IDs: which nodes were skipped between each filtered node and its children
  const collapsedNodeIds = new Map<string, string[]>()
  // Track hierarchical group structure for nodes with many collapsed children
  const compactChildGroupsMap = new Map<string, CompactGroup[]>()

  for (const msg of filteredMessages) {
    if (msg.parentId === null) continue

    // Find the nearest filtered ancestor and collect skipped node IDs
    let ancestor: string | null = null
    const skippedIds: string[] = []

    if (filteredSet.has(msg.parentId)) {
      ancestor = msg.parentId
    } else {
      // Collect nodes between this and its filtered ancestor
      let current = messageMap.get(msg.parentId)
      while (current) {
        if (filteredSet.has(current.id)) {
          ancestor = current.id
          break
        }
        skippedIds.push(current.id)
        current = current.parentId ? messageMap.get(current.parentId) : undefined
      }
    }

    if (ancestor) {
      const existing = filteredChildrenMap.get(ancestor) ?? []
      existing.push(msg)
      filteredChildrenMap.set(ancestor, existing)

      // Store the collapsed node IDs on the ancestor
      // If there are multiple children, keep the one with more collapsed nodes
      const currentIds = collapsedNodeIds.get(ancestor) ?? []
      if (skippedIds.length > currentIds.length) {
        collapsedNodeIds.set(ancestor, skippedIds)

        // Build hierarchical groups if there are many collapsed nodes
        if (skippedIds.length > COMPACT_GROUP_SIZE) {
          const groups: CompactGroup[] = []
          const numGroups = Math.min(COMPACT_GROUP_SIZE, Math.ceil(skippedIds.length / COMPACT_GROUP_SIZE))
          const groupSize = Math.ceil(skippedIds.length / numGroups)

          for (let g = 0; g < numGroups; g++) {
            const startIdx = g * groupSize
            const endIdx = Math.min(startIdx + groupSize, skippedIds.length)
            const groupNodeIds = skippedIds.slice(startIdx, endIdx)

            if (groupNodeIds.length > 0) {
              groups.push({
                representativeId: groupNodeIds[0]!,
                nodeIds: groupNodeIds,
                count: groupNodeIds.length,
              })
            }
          }

          compactChildGroupsMap.set(ancestor, groups)
        }
      }
    }
  }

  // Find filtered roots
  const filteredRoots = filteredMessages.filter((m) => {
    if (m.parentId === null) return true
    // Also treat as root if no filtered ancestor exists
    return !filteredSet.has(m.parentId) && !findFilteredAncestor(m.id, messageMap, filteredSet)
  })

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
    // Ensure minimum width of 1
    const width = Math.max(1, totalWidth)
    subtreeWidths.set(nodeId, width)
    return width
  }

  // Calculate widths for all roots
  for (const root of filteredRoots) {
    calculateSubtreeWidth(root.id)
  }

  // Get NODE_RADIUS from options
  const NODE_RADIUS = options.nodeRadius

  // Track occupied horizontal ranges at each depth to prevent overlaps
  const occupiedRanges = new Map<number, Array<{ left: number; right: number }>>()

  function markRangeOccupied(depth: number, left: number, right: number): void {
    const ranges = occupiedRanges.get(depth) ?? []
    ranges.push({ left, right })
    occupiedRanges.set(depth, ranges)
  }

  // Calculate the full horizontal extent of a subtree
  function getSubtreeExtent(nodeId: string): { width: number; leftExtent: number; rightExtent: number } {
    const width = subtreeWidths.get(nodeId) ?? 1
    const halfWidth = (width * options.nodeSpacingX) / 2
    return { width, leftExtent: halfWidth, rightExtent: halfWidth }
  }

  // Position nodes - keep first child (main branch) directly below parent
  const nodes: GraphNode[] = []
  const nodePositions = new Map<string, { x: number; y: number }>()

  // Global counter for alternating branch sides across the entire tree
  let globalBranchCounter = 0

  function positionNode(
    nodeId: string,
    depth: number,
    xPosition: number
  ): { minX: number; maxX: number } {
    const message = messageMap.get(nodeId)
    if (!message || !filteredSet.has(nodeId)) return { minX: xPosition, maxX: xPosition }

    const children = filteredChildrenMap.get(nodeId) ?? []

    // Position this node
    const y = depth * options.nodeSpacingY + options.padding
    nodePositions.set(nodeId, { x: xPosition, y })
    markRangeOccupied(depth, xPosition - NODE_RADIUS, xPosition + NODE_RADIUS)

    const nodeCollapsedIds = collapsedNodeIds.get(nodeId) ?? []
    const nodeCompactGroups = compactChildGroupsMap.get(nodeId)
    nodes.push({
      id: nodeId,
      x: xPosition,
      y,
      message,
      depth,
      isBranchRoot: isBranchRoot(message, childrenMap, messageMap),
      childCount: (childrenMap.get(nodeId) ?? []).length,
      collapsedCount: nodeCollapsedIds.length,
      collapsedNodeIds: nodeCollapsedIds,
      compactChildGroups: nodeCompactGroups,
      precomputedColor: '', // Will be filled by precomputeNodeColors
    })

    let minX = xPosition
    let maxX = xPosition

    // Position children: main branch stays vertical, branches go to sides
    if (children.length > 0) {
      // The main branch child is an untitled continuation (no branchTitle).
      // When ALL children have branchTitle, there is no main continuation —
      // they are all explicit side branches and should fan out to the sides.
      const mainBranchChild = children.find(c => !c.branchTitle) ?? null

      const sideBranches = mainBranchChild
        ? children.filter(c => c.id !== mainBranchChild.id)
        : children // All titled — all are side branches

      // Main branch stays directly below (if one exists)
      if (mainBranchChild) {
        const mainExtent = positionNode(mainBranchChild.id, depth + 1, xPosition)
        minX = Math.min(minX, mainExtent.minX)
        maxX = Math.max(maxX, mainExtent.maxX)
      }

      // Sort side branches by creation time for consistent ordering
      const sortedBranches = [...sideBranches].sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt)
      )

      // Position each side branch with globally alternating left/right
      // This ensures branches across the entire tree alternate sides
      for (let i = 0; i < sortedBranches.length; i++) {
        const child = sortedBranches[i]!
        const childExtent = getSubtreeExtent(child.id)
        const baseOffset = (childExtent.width + 1) * options.nodeSpacingX

        // Use global counter for alternation across entire tree
        // Even = right, Odd = left
        const goRight = globalBranchCounter % 2 === 0
        globalBranchCounter++

        // Calculate offset: first branch on each side is closer, subsequent ones are farther
        // Count how many branches on this side from THIS parent
        const sideIndex = Math.floor(i / 2) + 1

        let childX: number
        if (goRight) {
          childX = xPosition + baseOffset * sideIndex
        } else {
          childX = xPosition - baseOffset * sideIndex
        }

        const branchExtent = positionNode(child.id, depth + 1, childX)
        minX = Math.min(minX, branchExtent.minX)
        maxX = Math.max(maxX, branchExtent.maxX)
      }
    }

    return { minX, maxX }
  }

  // Position all root subtrees
  let currentX = options.padding + 200 // Start with some left margin for branches
  for (const root of filteredRoots) {
    const rootWidth = subtreeWidths.get(root.id) ?? 1
    positionNode(root.id, 0, currentX)
    currentX += (rootWidth + 1) * options.nodeSpacingX
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
  let minX = Infinity
  let maxX = 0
  let maxY = 0
  for (const node of nodes) {
    minX = Math.min(minX, node.x)
    maxX = Math.max(maxX, node.x)
    maxY = Math.max(maxY, node.y)
  }

  // Shift all nodes if any have negative x
  if (minX < options.padding) {
    const shift = options.padding - minX
    for (const node of nodes) {
      node.x += shift
    }
    for (const edge of edges) {
      edge.fromX += shift
      edge.toX += shift
    }
    maxX += shift
  }

  // Pre-compute colors for all nodes in O(n) time
  // This avoids O(n²) color computation during render
  precomputeNodeColors(nodes, childrenMap, branchColorMap)

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
