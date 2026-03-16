/**
 * Split View Store Tests
 *
 * Tests for pane state independence, focus logic, and navigation helpers.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSplitViewStore } from './splitViewStore'
import type { Message } from '@/db/types'

// Helper to create mock messages
function createMockMessage(id: string, parentId: string | null): Message {
  const now = new Date().toISOString()
  return {
    id,
    conversationId: 'conv-1',
    parentId,
    role: 'user',
    content: `Message ${id}`,
    createdAt: now,
    updatedAt: now,
  }
}

// Helper to create a message map
function createMessageMap(messages: Message[]): Map<string, Message> {
  return new Map(messages.map(m => [m.id, m]))
}

describe('splitViewStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('initialization', () => {
    it('starts with split view disabled', () => {
      const store = useSplitViewStore()
      expect(store.splitViewEnabled).toBe(false)
      expect(store.paneA.activeMessageId).toBeNull()
      expect(store.paneB.activeMessageId).toBeNull()
      expect(store.focusedPane).toBe('A')
    })
  })

  describe('enableSplitView', () => {
    it('enables split view with current message in both panes', () => {
      const store = useSplitViewStore()
      store.enableSplitView('msg-1')

      expect(store.splitViewEnabled).toBe(true)
      expect(store.paneA.activeMessageId).toBe('msg-1')
      expect(store.paneB.activeMessageId).toBe('msg-1')
      expect(store.focusedPane).toBe('A')
    })

    it('handles null active message', () => {
      const store = useSplitViewStore()
      store.enableSplitView(null)

      expect(store.splitViewEnabled).toBe(true)
      expect(store.paneA.activeMessageId).toBeNull()
      expect(store.paneB.activeMessageId).toBeNull()
    })
  })

  describe('disableSplitView', () => {
    it('disables split view and returns focused pane active message', () => {
      const store = useSplitViewStore()
      store.enableSplitView('msg-1')
      store.setPaneActiveMessage('A', 'msg-a')
      store.setPaneActiveMessage('B', 'msg-b')
      store.setFocusedPane('B')

      const activeId = store.disableSplitView()

      expect(store.splitViewEnabled).toBe(false)
      expect(activeId).toBe('msg-b') // Focused pane was B
      // Pane states are preserved for when split view is re-enabled
      expect(store.paneA.activeMessageId).toBe('msg-a')
      expect(store.paneB.activeMessageId).toBe('msg-b')
    })
  })

  describe('pane state independence', () => {
    it('setting pane A does not affect pane B', () => {
      const store = useSplitViewStore()
      store.enableSplitView('msg-1')
      
      store.setPaneActiveMessage('A', 'msg-a')

      expect(store.paneA.activeMessageId).toBe('msg-a')
      expect(store.paneB.activeMessageId).toBe('msg-1') // Unchanged
    })

    it('setting pane B does not affect pane A', () => {
      const store = useSplitViewStore()
      store.enableSplitView('msg-1')
      
      store.setPaneActiveMessage('B', 'msg-b')

      expect(store.paneA.activeMessageId).toBe('msg-1') // Unchanged
      expect(store.paneB.activeMessageId).toBe('msg-b')
    })

    it('each pane can have completely different positions', () => {
      const store = useSplitViewStore()
      store.enableSplitView('msg-1')
      
      store.setPaneActiveMessage('A', 'branch-a-leaf')
      store.setPaneActiveMessage('B', 'branch-b-leaf')

      expect(store.paneA.activeMessageId).toBe('branch-a-leaf')
      expect(store.paneB.activeMessageId).toBe('branch-b-leaf')
    })
  })

  describe('focus logic', () => {
    it('setFocusedPane changes focus correctly', () => {
      const store = useSplitViewStore()
      store.enableSplitView('msg-1')

      expect(store.focusedPane).toBe('A')
      
      store.setFocusedPane('B')
      expect(store.focusedPane).toBe('B')
      
      store.setFocusedPane('A')
      expect(store.focusedPane).toBe('A')
    })

    it('setFocusedPaneActiveMessage affects only focused pane', () => {
      const store = useSplitViewStore()
      store.enableSplitView('msg-1')
      
      // Focus A and set message
      store.setFocusedPane('A')
      store.setFocusedPaneActiveMessage('msg-a')
      expect(store.paneA.activeMessageId).toBe('msg-a')
      expect(store.paneB.activeMessageId).toBe('msg-1')

      // Focus B and set message
      store.setFocusedPane('B')
      store.setFocusedPaneActiveMessage('msg-b')
      expect(store.paneA.activeMessageId).toBe('msg-a') // Unchanged
      expect(store.paneB.activeMessageId).toBe('msg-b')
    })

    it('isPaneFocused returns correct values', () => {
      const store = useSplitViewStore()
      store.enableSplitView('msg-1')

      expect(store.isPaneFocused('A')).toBe(true)
      expect(store.isPaneFocused('B')).toBe(false)

      store.setFocusedPane('B')
      expect(store.isPaneFocused('A')).toBe(false)
      expect(store.isPaneFocused('B')).toBe(true)
    })
  })

  describe('swapPanes', () => {
    it('swaps pane A and B positions', () => {
      const store = useSplitViewStore()
      store.enableSplitView('msg-1')
      store.setPaneActiveMessage('A', 'msg-a')
      store.setPaneActiveMessage('B', 'msg-b')

      store.swapPanes()

      expect(store.paneA.activeMessageId).toBe('msg-b')
      expect(store.paneB.activeMessageId).toBe('msg-a')
    })

    it('double swap returns to original state', () => {
      const store = useSplitViewStore()
      store.enableSplitView('msg-1')
      store.setPaneActiveMessage('A', 'msg-a')
      store.setPaneActiveMessage('B', 'msg-b')

      store.swapPanes()
      store.swapPanes()

      expect(store.paneA.activeMessageId).toBe('msg-a')
      expect(store.paneB.activeMessageId).toBe('msg-b')
    })
  })

  describe('clonePaneToOther', () => {
    it('clones pane A to pane B', () => {
      const store = useSplitViewStore()
      store.enableSplitView('msg-1')
      store.setPaneActiveMessage('A', 'msg-a')
      store.setPaneActiveMessage('B', 'msg-b')

      store.clonePaneToOther('A')

      expect(store.paneA.activeMessageId).toBe('msg-a')
      expect(store.paneB.activeMessageId).toBe('msg-a')
    })

    it('clones pane B to pane A', () => {
      const store = useSplitViewStore()
      store.enableSplitView('msg-1')
      store.setPaneActiveMessage('A', 'msg-a')
      store.setPaneActiveMessage('B', 'msg-b')

      store.clonePaneToOther('B')

      expect(store.paneA.activeMessageId).toBe('msg-b')
      expect(store.paneB.activeMessageId).toBe('msg-b')
    })
  })

  describe('streaming constraints', () => {
    it('canPaneSend returns true when nothing is streaming', () => {
      const store = useSplitViewStore()
      store.enableSplitView('msg-1')

      expect(store.canPaneSend('A')).toBe(true)
      expect(store.canPaneSend('B')).toBe(true)
    })

    it('canPaneSend returns false when any pane is streaming', () => {
      const store = useSplitViewStore()
      store.enableSplitView('msg-1')
      store.startPaneStreaming('A')

      expect(store.canPaneSend('A')).toBe(false)
      expect(store.canPaneSend('B')).toBe(false)
    })

    it('isPaneStreaming returns correct values', () => {
      const store = useSplitViewStore()
      store.enableSplitView('msg-1')

      expect(store.isPaneStreaming('A')).toBe(false)
      expect(store.isPaneStreaming('B')).toBe(false)

      store.startPaneStreaming('A')
      expect(store.isPaneStreaming('A')).toBe(true)
      expect(store.isPaneStreaming('B')).toBe(false)

      store.stopPaneStreaming()
      expect(store.isPaneStreaming('A')).toBe(false)
      expect(store.isPaneStreaming('B')).toBe(false)
    })
  })

  describe('URL params', () => {
    it('toUrlParams returns empty when split view disabled', () => {
      const store = useSplitViewStore()
      expect(store.toUrlParams()).toEqual({})
    })

    it('toUrlParams returns correct params when enabled', () => {
      const store = useSplitViewStore()
      store.enableSplitView('msg-1')
      store.setPaneActiveMessage('A', 'msg-a')
      store.setPaneActiveMessage('B', 'msg-b')
      store.setFocusedPane('B')

      const params = store.toUrlParams()
      expect(params).toEqual({
        paneA: 'msg-a',
        paneB: 'msg-b',
        focus: 'B',
      })
    })

    it('initFromUrlParams restores state correctly', () => {
      const store = useSplitViewStore()
      
      // Create a simple message map
      const messages = [
        createMockMessage('msg-a', null),
        createMockMessage('msg-b', 'msg-a'),
      ]
      const messageMap = createMessageMap(messages)

      store.initFromUrlParams('msg-a', 'msg-b', 'B', messageMap)

      expect(store.splitViewEnabled).toBe(true)
      expect(store.paneA.activeMessageId).toBe('msg-a')
      expect(store.paneB.activeMessageId).toBe('msg-b')
      expect(store.focusedPane).toBe('B')
    })

    it('initFromUrlParams ignores invalid message IDs', () => {
      const store = useSplitViewStore()
      const messageMap = createMessageMap([createMockMessage('msg-1', null)])

      store.initFromUrlParams('invalid-id', 'msg-1', 'A', messageMap)

      expect(store.paneA.activeMessageId).toBeNull() // Invalid ID ignored
      expect(store.paneB.activeMessageId).toBe('msg-1')
      // Split view should NOT be enabled since paneA is null
      expect(store.splitViewEnabled).toBe(false)
    })
  })

  describe('reset', () => {
    it('resets all state to defaults', () => {
      const store = useSplitViewStore()
      store.enableSplitView('msg-1')
      store.setPaneActiveMessage('A', 'msg-a')
      store.setPaneActiveMessage('B', 'msg-b')
      store.setFocusedPane('B')
      store.startPaneStreaming('A')

      store.reset()

      expect(store.splitViewEnabled).toBe(false)
      expect(store.paneA.activeMessageId).toBeNull()
      expect(store.paneB.activeMessageId).toBeNull()
      expect(store.focusedPane).toBe('A')
      expect(store.streamingPane).toBeNull()
    })
  })

  describe('getPaneTimeline', () => {
    it('returns empty array when pane has no active message', () => {
      const store = useSplitViewStore()
      const messageMap = createMessageMap([createMockMessage('msg-1', null)])

      const timeline = store.getPaneTimeline('A', messageMap)
      expect(timeline).toEqual([])
    })

    it('returns full branch timeline including descendants', () => {
      const store = useSplitViewStore()
      const msg1 = createMockMessage('msg-1', null)
      const msg2 = createMockMessage('msg-2', 'msg-1')
      const msg3 = createMockMessage('msg-3', 'msg-2')
      const msg4 = createMockMessage('msg-4', 'msg-3') // descendant
      const messageMap = createMessageMap([msg1, msg2, msg3, msg4])

      store.enableSplitView('msg-1')
      store.setPaneActiveMessage('A', 'msg-2') // Set active to msg-2

      const timeline = store.getPaneTimeline('A', messageMap)
      // Should include root to active (msg-1, msg-2) plus descendants (msg-3, msg-4)
      expect(timeline.map(m => m.id)).toEqual(['msg-1', 'msg-2', 'msg-3', 'msg-4'])
    })
  })
})
