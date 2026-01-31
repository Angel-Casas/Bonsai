import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import MessageTree from './MessageTree.vue'
import MessageTreeNode from './MessageTreeNode.vue'
import type { Message } from '@/db/types'
import { buildChildrenMap } from '@/db/treeUtils'

// Helper to create test messages
function createMessage(
  id: string,
  content: string,
  role: Message['role'] = 'user',
  parentId: string | null = null,
  branchTitle?: string
): Message {
  return {
    id,
    conversationId: 'conv-1',
    parentId,
    role,
    content,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    branchTitle,
  }
}

describe('MessageTree', () => {
  it('renders empty state when no messages', () => {
    const messages: Message[] = []
    const messageMap = new Map<string, Message>()
    const childrenMap = buildChildrenMap(messageMap)
    const rootMessages: Message[] = []

    const wrapper = mount(MessageTree, {
      props: {
        messages,
        messageMap,
        childrenMap,
        rootMessages,
        activeMessageId: null,
        timelineIds: new Set<string>(),
      },
      global: {
        components: { MessageTreeNode },
      },
    })

    expect(wrapper.find('[data-testid="message-tree"]').exists()).toBe(true)
    expect(wrapper.findAllComponents(MessageTreeNode)).toHaveLength(0)
  })

  it('renders correct hierarchical structure from seeded data', () => {
    // Create a tree structure:
    // root (system)
    //   └── msg1 (user)
    //       ├── msg2 (assistant)
    //       │   └── msg3 (user)
    //       └── msg4 (user, branch)
    const root = createMessage('root', 'System prompt', 'system', null)
    const msg1 = createMessage('msg1', 'Hello', 'user', 'root')
    const msg2 = createMessage('msg2', 'Hi there!', 'assistant', 'msg1')
    const msg3 = createMessage('msg3', 'How are you?', 'user', 'msg2')
    const msg4 = createMessage('msg4', 'Alternative', 'user', 'msg1', 'Alternative Branch')

    const messages = [root, msg1, msg2, msg3, msg4]
    const messageMap = new Map(messages.map((m) => [m.id, m]))
    const childrenMap = buildChildrenMap(messageMap)
    const rootMessages = [root]

    const wrapper = mount(MessageTree, {
      props: {
        messages,
        messageMap,
        childrenMap,
        rootMessages,
        activeMessageId: 'msg3',
        timelineIds: new Set(['root', 'msg1', 'msg2', 'msg3']),
      },
      global: {
        components: { MessageTreeNode },
      },
    })

    // Should render all 5 nodes
    expect(wrapper.findAll('[data-testid^="tree-node-"]')).toHaveLength(5)

    // Check specific nodes exist
    expect(wrapper.find('[data-testid="tree-node-root"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="tree-node-msg1"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="tree-node-msg2"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="tree-node-msg3"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="tree-node-msg4"]').exists()).toBe(true)
  })

  it('emits select event when clicking a tree node', async () => {
    const root = createMessage('root', 'System prompt', 'system', null)
    const msg1 = createMessage('msg1', 'Hello', 'user', 'root')

    const messages = [root, msg1]
    const messageMap = new Map(messages.map((m) => [m.id, m]))
    const childrenMap = buildChildrenMap(messageMap)
    const rootMessages = [root]

    const wrapper = mount(MessageTree, {
      props: {
        messages,
        messageMap,
        childrenMap,
        rootMessages,
        activeMessageId: 'root',
        timelineIds: new Set(['root']),
      },
      global: {
        components: { MessageTreeNode },
      },
    })

    // Click on msg1
    await wrapper.find('[data-testid="tree-node-msg1"]').trigger('click')

    // Check that select event was emitted with correct message ID
    expect(wrapper.emitted('select')).toBeTruthy()
    expect(wrapper.emitted('select')![0]).toEqual(['msg1'])
  })

  it('highlights active message node', () => {
    const root = createMessage('root', 'System prompt', 'system', null)
    const msg1 = createMessage('msg1', 'Hello', 'user', 'root')

    const messages = [root, msg1]
    const messageMap = new Map(messages.map((m) => [m.id, m]))
    const childrenMap = buildChildrenMap(messageMap)
    const rootMessages = [root]

    const wrapper = mount(MessageTree, {
      props: {
        messages,
        messageMap,
        childrenMap,
        rootMessages,
        activeMessageId: 'msg1',
        timelineIds: new Set(['root', 'msg1']),
      },
      global: {
        components: { MessageTreeNode },
      },
    })

    // Active node should have is-active class
    const activeNode = wrapper.find('[data-testid="tree-node-msg1"]')
    expect(activeNode.classes()).toContain('is-active')

    // Non-active node in path should have is-in-path class
    const pathNode = wrapper.find('[data-testid="tree-node-root"]')
    expect(pathNode.classes()).toContain('is-in-path')
  })

  it('shows branch indicator for nodes with multiple children', () => {
    const root = createMessage('root', 'System prompt', 'system', null)
    const msg1 = createMessage('msg1', 'Hello', 'user', 'root')
    const msg2 = createMessage('msg2', 'Response 1', 'assistant', 'msg1')
    const msg3 = createMessage('msg3', 'Response 2', 'assistant', 'msg1', 'Alternative')

    const messages = [root, msg1, msg2, msg3]
    const messageMap = new Map(messages.map((m) => [m.id, m]))
    const childrenMap = buildChildrenMap(messageMap)
    const rootMessages = [root]

    const wrapper = mount(MessageTree, {
      props: {
        messages,
        messageMap,
        childrenMap,
        rootMessages,
        activeMessageId: 'msg2',
        timelineIds: new Set(['root', 'msg1', 'msg2']),
      },
      global: {
        components: { MessageTreeNode },
      },
    })

    // msg1 should show branch indicator (has 2 children)
    const msg1Node = wrapper.find('[data-testid="tree-node-msg1"]')
    expect(msg1Node.text()).toContain('↳2')
  })

  it('displays branch title when available', () => {
    const root = createMessage('root', 'System prompt', 'system', null)
    const msg1 = createMessage('msg1', 'Hello', 'user', 'root')
    const branchMsg = createMessage('branch', 'Branch content', 'user', 'root', 'My Branch')

    const messages = [root, msg1, branchMsg]
    const messageMap = new Map(messages.map((m) => [m.id, m]))
    const childrenMap = buildChildrenMap(messageMap)
    const rootMessages = [root]

    const wrapper = mount(MessageTree, {
      props: {
        messages,
        messageMap,
        childrenMap,
        rootMessages,
        activeMessageId: 'msg1',
        timelineIds: new Set(['root', 'msg1']),
      },
      global: {
        components: { MessageTreeNode },
      },
    })

    // Branch node should show branch title
    const branchNode = wrapper.find('[data-testid="tree-node-branch"]')
    expect(branchNode.text()).toContain('My Branch')
  })
})
