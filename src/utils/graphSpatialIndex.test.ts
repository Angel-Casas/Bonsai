import { describe, it, expect } from 'vitest'
import { GraphSpatialIndex, createSpatialIndex, type Rect } from './graphSpatialIndex'
import type { GraphNode, GraphEdge } from './graphLayout'

// Helper to create a test node
function createNode(id: string, x: number, y: number): GraphNode {
  return {
    id,
    x,
    y,
    message: {
      id,
      conversationId: 'conv1',
      parentId: null,
      role: 'user' as const,
      content: 'test',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: undefined,
      branchTitle: undefined,
      variantOfMessageId: undefined,
    },
    depth: 0,
    isBranchRoot: false,
    childCount: 0,
    collapsedCount: 0,
    collapsedNodeIds: [],
    precomputedColor: 'var(--accent)',
  }
}

// Helper to create a test edge
function createEdge(from: string, to: string, fromX: number, fromY: number, toX: number, toY: number): GraphEdge {
  return { from, to, fromX, fromY, toX, toY }
}

describe('GraphSpatialIndex', () => {
  describe('build', () => {
    it('should build index from nodes', () => {
      const index = new GraphSpatialIndex()
      const nodes = [
        createNode('1', 100, 100),
        createNode('2', 200, 100),
        createNode('3', 100, 200),
      ]
      const edges: GraphEdge[] = []

      index.build(nodes, edges)

      expect(index.isEmpty()).toBe(false)
      expect(index.getAllNodes()).toHaveLength(3)
    })

    it('should handle empty nodes', () => {
      const index = new GraphSpatialIndex()
      index.build([], [])

      expect(index.isEmpty()).toBe(true)
      expect(index.getAllNodes()).toHaveLength(0)
    })
  })

  describe('queryViewport', () => {
    it('should return nodes within viewport', () => {
      const nodes = [
        createNode('1', 100, 100),
        createNode('2', 200, 100),
        createNode('3', 500, 500),
      ]
      const index = createSpatialIndex(nodes, [])

      const viewport: Rect = { x: 0, y: 0, width: 300, height: 300 }
      const visible = index.queryViewport(viewport)

      expect(visible).toHaveLength(2)
      expect(visible.map(n => n.id).sort()).toEqual(['1', '2'])
    })

    it('should return empty array for viewport with no nodes', () => {
      const nodes = [
        createNode('1', 100, 100),
        createNode('2', 200, 100),
      ]
      const index = createSpatialIndex(nodes, [])

      const viewport: Rect = { x: 1000, y: 1000, width: 100, height: 100 }
      const visible = index.queryViewport(viewport)

      expect(visible).toHaveLength(0)
    })

    it('should support buffer zone around viewport', () => {
      const nodes = [
        createNode('1', 100, 100),
        createNode('2', 350, 100), // Just outside viewport without buffer
      ]
      const index = createSpatialIndex(nodes, [])

      const viewport: Rect = { x: 0, y: 0, width: 300, height: 300 }

      // Without buffer
      expect(index.queryViewport(viewport, 0)).toHaveLength(1)

      // With buffer of 100
      expect(index.queryViewport(viewport, 100)).toHaveLength(2)
    })
  })

  describe('queryPoint', () => {
    it('should return nodes within radius of point', () => {
      const nodes = [
        createNode('1', 100, 100),
        createNode('2', 110, 100), // 10 pixels away
        createNode('3', 200, 100), // 100 pixels away
      ]
      const index = createSpatialIndex(nodes, [])

      // Query with radius 50 - should get nodes 1 and 2
      const nearby = index.queryPoint(100, 100, 50)
      expect(nearby).toHaveLength(2)
      expect(nearby.map(n => n.id).sort()).toEqual(['1', '2'])

      // Query with radius 5 - should only get node 1
      const veryClose = index.queryPoint(100, 100, 5)
      expect(veryClose).toHaveLength(1)
      expect(veryClose[0]!.id).toBe('1')
    })

    it('should return empty array when no nodes nearby', () => {
      const nodes = [createNode('1', 100, 100)]
      const index = createSpatialIndex(nodes, [])

      const nearby = index.queryPoint(500, 500, 10)
      expect(nearby).toHaveLength(0)
    })
  })

  describe('getVisibleEdges', () => {
    it('should return edges with at least one visible endpoint', () => {
      const nodes = [
        createNode('1', 100, 100),
        createNode('2', 200, 100),
        createNode('3', 500, 500),
      ]
      const edges = [
        createEdge('1', '2', 100, 100, 200, 100),
        createEdge('2', '3', 200, 100, 500, 500),
        createEdge('3', '4', 500, 500, 600, 600), // Node 4 doesn't exist
      ]
      const index = createSpatialIndex(nodes, edges)

      const visibleNodeIds = new Set(['1', '2'])
      const visibleEdges = index.getVisibleEdges(visibleNodeIds, edges)

      // Edge 1-2 (both visible), Edge 2-3 (one visible)
      expect(visibleEdges).toHaveLength(2)
    })
  })

  describe('getNode', () => {
    it('should return node by ID', () => {
      const nodes = [createNode('1', 100, 100)]
      const index = createSpatialIndex(nodes, [])

      const node = index.getNode('1')
      expect(node).toBeDefined()
      expect(node!.id).toBe('1')
    })

    it('should return undefined for non-existent node', () => {
      const index = createSpatialIndex([], [])
      expect(index.getNode('nonexistent')).toBeUndefined()
    })
  })

  describe('large dataset', () => {
    it('should handle 1000+ nodes efficiently', () => {
      // Create 1000 nodes in a grid
      const nodes: GraphNode[] = []
      for (let i = 0; i < 1000; i++) {
        const x = (i % 50) * 100
        const y = Math.floor(i / 50) * 100
        nodes.push(createNode(String(i), x, y))
      }
      const index = createSpatialIndex(nodes, [])

      // Query a small viewport - should be fast
      const start = performance.now()
      const viewport: Rect = { x: 0, y: 0, width: 500, height: 500 }

      for (let i = 0; i < 100; i++) {
        index.queryViewport(viewport)
      }

      const elapsed = performance.now() - start
      // 100 queries should take less than 50ms
      expect(elapsed).toBeLessThan(50)

      // Should return only nodes in viewport
      const visible = index.queryViewport(viewport)
      expect(visible.length).toBeLessThan(100) // Much less than 1000
    })

    it('should support hit detection on large dataset', () => {
      // Create 1000 nodes
      const nodes: GraphNode[] = []
      for (let i = 0; i < 1000; i++) {
        nodes.push(createNode(String(i), i * 10, i * 10))
      }
      const index = createSpatialIndex(nodes, [])

      // Hit test should be fast
      const start = performance.now()
      for (let i = 0; i < 1000; i++) {
        index.queryPoint(500, 500, 25)
      }
      const elapsed = performance.now() - start

      // 1000 hit tests should take less than 100ms
      expect(elapsed).toBeLessThan(100)
    })
  })
})
