/**
 * Tests for graph layout utilities
 */

import { describe, it, expect } from 'vitest'
import {
  buildGraphAdjacency,
  isBranchRoot,
  filterMessages,
  computeTreeLayout,
  getNodeSnippet,
  formatTimestamp,
  type FilterOptions,
} from './graphLayout'
import type { Message } from '@/db/types'

// Helper to create test messages
function createMessage(
  id: string,
  parentId: string | null,
  role: 'user' | 'assistant' | 'system' = 'user',
  content: string = `Message ${id}`,
  branchTitle?: string
): Message {
  return {
    id,
    conversationId: 'conv-1',
    parentId,
    role,
    content,
    branchTitle,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  }
}

describe('buildGraphAdjacency', () => {
  it('builds correct adjacency for empty message list', () => {
    const result = buildGraphAdjacency([])
    expect(result.messageMap.size).toBe(0)
    expect(result.childrenMap.size).toBe(0)
    expect(result.roots).toHaveLength(0)
  })

  it('builds correct adjacency for single root message', () => {
    const messages = [createMessage('m1', null)]
    const result = buildGraphAdjacency(messages)

    expect(result.messageMap.size).toBe(1)
    expect(result.messageMap.get('m1')).toBeDefined()
    expect(result.roots).toHaveLength(1)
    expect(result.roots[0]!.id).toBe('m1')
  })

  it('builds correct adjacency for linear chain', () => {
    const messages = [
      createMessage('m1', null),
      createMessage('m2', 'm1'),
      createMessage('m3', 'm2'),
    ]
    const result = buildGraphAdjacency(messages)

    expect(result.messageMap.size).toBe(3)
    expect(result.roots).toHaveLength(1)
    expect(result.childrenMap.get('m1')?.map((m) => m.id)).toEqual(['m2'])
    expect(result.childrenMap.get('m2')?.map((m) => m.id)).toEqual(['m3'])
    expect(result.childrenMap.get('m3')).toBeUndefined()
  })

  it('builds correct adjacency for branching tree', () => {
    const messages = [
      createMessage('m1', null),
      createMessage('m2', 'm1'),
      createMessage('m3', 'm1'), // Branch from m1
      createMessage('m4', 'm2'),
    ]
    const result = buildGraphAdjacency(messages)

    expect(result.roots).toHaveLength(1)
    const m1Children = result.childrenMap.get('m1')?.map((m) => m.id) ?? []
    expect(m1Children).toContain('m2')
    expect(m1Children).toContain('m3')
    expect(m1Children).toHaveLength(2)
  })

  it('handles multiple roots', () => {
    const messages = [
      createMessage('m1', null),
      createMessage('m2', null),
      createMessage('m3', 'm1'),
    ]
    const result = buildGraphAdjacency(messages)

    expect(result.roots).toHaveLength(2)
    expect(result.roots.map((r) => r.id)).toContain('m1')
    expect(result.roots.map((r) => r.id)).toContain('m2')
  })
})

describe('isBranchRoot', () => {
  it('returns true for message with branchTitle', () => {
    const messages = [
      createMessage('m1', null),
      createMessage('m2', 'm1', 'user', 'content', 'My Branch'),
    ]
    const { childrenMap, messageMap } = buildGraphAdjacency(messages)

    expect(isBranchRoot(messages[1]!, childrenMap, messageMap)).toBe(true)
  })

  it('returns true for branch point (multiple children)', () => {
    const messages = [
      createMessage('m1', null),
      createMessage('m2', 'm1'),
      createMessage('m3', 'm1'),
    ]
    const { childrenMap, messageMap } = buildGraphAdjacency(messages)

    expect(isBranchRoot(messages[0]!, childrenMap, messageMap)).toBe(true)
  })

  it('returns true for child of branch point (has siblings)', () => {
    const messages = [
      createMessage('m1', null),
      createMessage('m2', 'm1'),
      createMessage('m3', 'm1'),
    ]
    const { childrenMap, messageMap } = buildGraphAdjacency(messages)

    expect(isBranchRoot(messages[1]!, childrenMap, messageMap)).toBe(true)
    expect(isBranchRoot(messages[2]!, childrenMap, messageMap)).toBe(true)
  })

  it('returns false for linear chain node without branchTitle', () => {
    const messages = [
      createMessage('m1', null),
      createMessage('m2', 'm1'),
      createMessage('m3', 'm2'),
    ]
    const { childrenMap, messageMap } = buildGraphAdjacency(messages)

    expect(isBranchRoot(messages[1]!, childrenMap, messageMap)).toBe(false)
  })
})

describe('filterMessages', () => {
  const createTestTree = () => [
    createMessage('m1', null),
    createMessage('m2', 'm1'),
    createMessage('m3', 'm2'),
    createMessage('m4', 'm2'), // Branch at m2
    createMessage('m5', 'm3'),
  ]

  it('returns all messages when no filters applied', () => {
    const messages = createTestTree()
    const { childrenMap, messageMap } = buildGraphAdjacency(messages)
    const options: FilterOptions = {
      branchRootsOnly: false,
      maxDepth: null,
      collapseLinearChains: false,
      compactNodes: false,
    }

    const result = filterMessages(messages, options, childrenMap, messageMap)
    expect(result).toHaveLength(5)
  })

  it('filters by maxDepth', () => {
    const messages = createTestTree()
    const { childrenMap, messageMap } = buildGraphAdjacency(messages)
    const options: FilterOptions = {
      branchRootsOnly: false,
      maxDepth: 2,
      collapseLinearChains: false,
      compactNodes: false,
    }

    const result = filterMessages(messages, options, childrenMap, messageMap)
    // Depth 0: m1, Depth 1: m2, Depth 2: m3, m4
    expect(result.map((m) => m.id)).toContain('m1')
    expect(result.map((m) => m.id)).toContain('m2')
    expect(result.map((m) => m.id)).toContain('m3')
    expect(result.map((m) => m.id)).toContain('m4')
    expect(result.map((m) => m.id)).not.toContain('m5')
  })

  it('filters branchRootsOnly keeps roots, branch points, leaves, and siblings', () => {
    const messages = createTestTree()
    const { childrenMap, messageMap } = buildGraphAdjacency(messages)
    const options: FilterOptions = {
      branchRootsOnly: true,
      maxDepth: null,
      collapseLinearChains: false,
      compactNodes: false,
    }

    const result = filterMessages(messages, options, childrenMap, messageMap)
    const ids = result.map((m) => m.id)

    // m1: root - keep
    // m2: branch point (has 2 children) - keep
    // m3: sibling of m4 - keep
    // m4: sibling of m3 - keep
    // m5: leaf - keep
    expect(ids).toContain('m1')
    expect(ids).toContain('m2')
    expect(ids).toContain('m3')
    expect(ids).toContain('m4')
    expect(ids).toContain('m5')
  })
})

describe('computeTreeLayout', () => {
  it('returns empty layout for empty messages', () => {
    const result = computeTreeLayout([])
    expect(result.nodes).toHaveLength(0)
    expect(result.edges).toHaveLength(0)
    expect(result.width).toBe(0)
    expect(result.height).toBe(0)
  })

  it('computes layout for single node', () => {
    const messages = [createMessage('m1', null)]
    const result = computeTreeLayout(messages)

    expect(result.nodes).toHaveLength(1)
    expect(result.edges).toHaveLength(0)
    const firstNode = result.nodes[0]
    expect(firstNode).toBeDefined()
    expect(firstNode!.id).toBe('m1')
    expect(firstNode!.depth).toBe(0)
  })

  it('computes deterministic layout for same input', () => {
    const messages = [
      createMessage('m1', null),
      createMessage('m2', 'm1'),
      createMessage('m3', 'm1'),
    ]

    const result1 = computeTreeLayout(messages)
    const result2 = computeTreeLayout(messages)

    // Same positions
    expect(result1.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y }))).toEqual(
      result2.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y }))
    )
  })

  it('creates edges between parent and children', () => {
    const messages = [
      createMessage('m1', null),
      createMessage('m2', 'm1'),
      createMessage('m3', 'm2'),
    ]
    const result = computeTreeLayout(messages)

    expect(result.edges).toHaveLength(2)
    expect(result.edges.some((e) => e.from === 'm1' && e.to === 'm2')).toBe(true)
    expect(result.edges.some((e) => e.from === 'm2' && e.to === 'm3')).toBe(true)
  })

  it('respects depth filter in layout', () => {
    const messages = [
      createMessage('m1', null),
      createMessage('m2', 'm1'),
      createMessage('m3', 'm2'),
      createMessage('m4', 'm3'),
    ]
    const result = computeTreeLayout(messages, {}, { maxDepth: 1 })

    // Only m1 (depth 0) and m2 (depth 1)
    expect(result.nodes).toHaveLength(2)
    expect(result.nodes.map((n) => n.id)).toContain('m1')
    expect(result.nodes.map((n) => n.id)).toContain('m2')
  })

  it('assigns correct depths to nodes', () => {
    const messages = [
      createMessage('m1', null),
      createMessage('m2', 'm1'),
      createMessage('m3', 'm2'),
    ]
    const result = computeTreeLayout(messages)

    const nodeMap = new Map(result.nodes.map((n) => [n.id, n]))
    expect(nodeMap.get('m1')?.depth).toBe(0)
    expect(nodeMap.get('m2')?.depth).toBe(1)
    expect(nodeMap.get('m3')?.depth).toBe(2)
  })

  it('identifies branch roots correctly', () => {
    const messages = [
      createMessage('m1', null),
      createMessage('m2', 'm1'),
      createMessage('m3', 'm1'), // Branch
      createMessage('m4', 'm2', 'user', 'content', 'Named Branch'),
    ]
    const result = computeTreeLayout(messages)

    const nodeMap = new Map(result.nodes.map((n) => [n.id, n]))
    expect(nodeMap.get('m1')?.isBranchRoot).toBe(true) // Has multiple children
    expect(nodeMap.get('m2')?.isBranchRoot).toBe(true) // Sibling of m3
    expect(nodeMap.get('m3')?.isBranchRoot).toBe(true) // Sibling of m2
    expect(nodeMap.get('m4')?.isBranchRoot).toBe(true) // Has branchTitle
  })
})

describe('getNodeSnippet', () => {
  it('returns full content if shorter than maxLength', () => {
    expect(getNodeSnippet('Hello', 100)).toBe('Hello')
  })

  it('truncates content with ellipsis if longer than maxLength', () => {
    const content = 'This is a very long message that should be truncated'
    const result = getNodeSnippet(content, 20)
    expect(result).toBe('This is a very lo...')
    expect(result.length).toBe(20)
  })

  it('handles exact length content', () => {
    const content = '12345'
    expect(getNodeSnippet(content, 5)).toBe('12345')
  })
})

describe('formatTimestamp', () => {
  it('formats ISO timestamp to readable format', () => {
    const result = formatTimestamp('2024-01-15T14:30:00.000Z')
    // Format varies by locale, just check it's not empty
    expect(result).toBeTruthy()
    expect(result.length).toBeGreaterThan(0)
  })
})
