import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import MessageTree from './MessageTree.vue'
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
  beforeEach(() => {
    setActivePinia(createPinia())
  })

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
    })

    expect(wrapper.find('[data-testid="message-tree"]').exists()).toBe(true)
    expect(wrapper.find('.empty-tree').exists()).toBe(true)
  })

  it('renders main conversation branch for linear conversation', () => {
    // Create a linear conversation (no branches)
    const root = createMessage('root', 'System prompt', 'system', null)
    const msg1 = createMessage('msg1', 'Hello', 'user', 'root')
    const msg2 = createMessage('msg2', 'Hi there!', 'assistant', 'msg1')

    const messages = [root, msg1, msg2]
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
    })

    // Should render one branch (main conversation)
    const branches = wrapper.findAll('.branch-item')
    expect(branches.length).toBe(1)

    // Branch should show message count
    expect(wrapper.find('.branch-count').text()).toBe('3')

    // Branch should be active
    expect(branches[0]!.classes()).toContain('active')
  })

  it('renders child branches when conversation has branch points', () => {
    // Create a tree with branches:
    // root (system)
    //   └── msg1 (user) - has 2 children but only msg3 has a title
    //       ├── msg2 (assistant) - untitled, part of main path
    //       └── msg3 (assistant, titled "Alternative") - shown as child branch
    //
    // Expected tree structure:
    // - Main conversation (root → msg1 → msg2) - follows untitled path
    //   └── "Alternative" (msg3) - explicitly titled branch
    const root = createMessage('root', 'System prompt', 'system', null)
    const msg1 = createMessage('msg1', 'Hello', 'user', 'root')
    const msg2 = createMessage('msg2', 'Hi there!', 'assistant', 'msg1')
    const msg3 = createMessage('msg3', 'Alternative response', 'assistant', 'msg1', 'Alternative')

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
    })

    // Should render main branch + 1 titled child branch
    // (untitled msg2 is part of main branch, not a separate item)
    const branches = wrapper.findAll('.branch-item')
    expect(branches.length).toBe(2)

    // Only the titled branch should have 'child' class
    const childBranches = wrapper.findAll('.branch-item.child')
    expect(childBranches.length).toBe(1)
  })

  it('emits select event when clicking a branch', async () => {
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
    })

    // Click on the branch
    await wrapper.find('.branch-item').trigger('click')

    // Check that select event was emitted (with the leaf message ID)
    expect(wrapper.emitted('select')).toBeTruthy()
    expect(wrapper.emitted('select')![0]).toEqual(['msg1'])
  })

  it('highlights active branch', () => {
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
    })

    // Main branch and one child branch should be active
    const activeBranches = wrapper.findAll('.branch-item.active')
    expect(activeBranches.length).toBeGreaterThan(0)
  })

  it('displays branch title when available', () => {
    const root = createMessage('root', 'System prompt', 'system', null)
    const msg1 = createMessage('msg1', 'Hello', 'user', 'root')
    const msg2 = createMessage('msg2', 'Response', 'assistant', 'msg1')
    const branchMsg = createMessage('branch', 'Branch content', 'user', 'msg1', 'My Custom Branch')

    const messages = [root, msg1, msg2, branchMsg]
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
    })

    // Should show the custom branch title
    expect(wrapper.text()).toContain('My Custom Branch')
  })

  it('shows message count for each branch', () => {
    // Linear conversation with 4 messages
    const root = createMessage('root', 'System prompt', 'system', null)
    const msg1 = createMessage('msg1', 'Hello', 'user', 'root')
    const msg2 = createMessage('msg2', 'Hi', 'assistant', 'msg1')
    const msg3 = createMessage('msg3', 'How are you?', 'user', 'msg2')

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
        activeMessageId: 'msg3',
        timelineIds: new Set(['root', 'msg1', 'msg2', 'msg3']),
      },
    })

    // Branch should show count of 4
    expect(wrapper.find('.branch-count').text()).toBe('4')
  })
})
