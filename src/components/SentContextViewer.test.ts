/**
 * SentContextViewer Component Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import SentContextViewer from './SentContextViewer.vue'
import type { Message } from '@/db/types'

// Mock the repository
vi.mock('@/db/repositories', () => ({
  getPromptContextConfig: vi.fn(),
}))

import { getPromptContextConfig } from '@/db/repositories'
const mockGetPromptContextConfig = vi.mocked(getPromptContextConfig)

describe('SentContextViewer', () => {
  const mockMessages: Message[] = [
    {
      id: 'msg-1',
      conversationId: 'conv-1',
      parentId: null,
      role: 'system',
      content: 'You are a helpful assistant.',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
    {
      id: 'msg-2',
      conversationId: 'conv-1',
      parentId: 'msg-1',
      role: 'user',
      content: 'Hello, how are you?',
      createdAt: '2024-01-01T00:01:00Z',
      updatedAt: '2024-01-01T00:01:00Z',
    },
    {
      id: 'msg-3',
      conversationId: 'conv-1',
      parentId: 'msg-2',
      role: 'assistant',
      content: 'I am doing well, thank you!',
      createdAt: '2024-01-01T00:02:00Z',
      updatedAt: '2024-01-01T00:02:00Z',
    },
  ]

  const messageMap = new Map(mockMessages.map(m => [m.id, m]))

  // Get specific messages with non-null assertion for test convenience
  const userMessage = mockMessages[1]!

  const createMockConfig = (resolvedIds: string[]) => ({
    messageId: 'msg-2',
    inheritDefaultPath: true,
    excludedMessageIds: [],
    pinnedMessageIds: [],
    orderingMode: 'PATH_THEN_PINS' as const,
    startFromMessageId: null,
    resolvedContextMessageIds: resolvedIds,
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders when isOpen is true', async () => {
    mockGetPromptContextConfig.mockResolvedValue(createMockConfig(['msg-1']))

    const wrapper = mount(SentContextViewer, {
      props: {
        message: userMessage,
        messageMap,
        isOpen: true,
      },
    })

    expect(wrapper.find('[data-testid="sent-context-viewer"]').exists()).toBe(true)
    expect(wrapper.find('.modal-title').text()).toBe('Sent Context')
  })

  it('does not render when isOpen is false', () => {
    const wrapper = mount(SentContextViewer, {
      props: {
        message: userMessage,
        messageMap,
        isOpen: false,
      },
    })

    expect(wrapper.find('[data-testid="sent-context-viewer"]').exists()).toBe(false)
  })

  it('shows context messages when available', async () => {
    mockGetPromptContextConfig.mockResolvedValue(createMockConfig(['msg-1', 'msg-2']))

    const wrapper = mount(SentContextViewer, {
      props: {
        message: userMessage,
        messageMap,
        isOpen: true,
      },
    })

    // Wait for async load
    await new Promise(resolve => setTimeout(resolve, 10))
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-testid="context-messages"]').exists()).toBe(true)
    expect(wrapper.find('.context-summary').text()).toContain('2 messages')
  })

  it('shows error when no context snapshot available', async () => {
    mockGetPromptContextConfig.mockResolvedValue(undefined)

    const wrapper = mount(SentContextViewer, {
      props: {
        message: userMessage,
        messageMap,
        isOpen: true,
      },
    })

    // Wait for async load
    await new Promise(resolve => setTimeout(resolve, 10))
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-testid="context-error"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('No context snapshot available')
  })

  it('emits close when close button is clicked', async () => {
    mockGetPromptContextConfig.mockResolvedValue(createMockConfig(['msg-1']))

    const wrapper = mount(SentContextViewer, {
      props: {
        message: userMessage,
        messageMap,
        isOpen: true,
      },
    })

    await wrapper.find('[data-testid="close-context-viewer"]').trigger('click')
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('displays role badges correctly', async () => {
    mockGetPromptContextConfig.mockResolvedValue(createMockConfig(['msg-1', 'msg-2', 'msg-3']))

    const wrapper = mount(SentContextViewer, {
      props: {
        message: userMessage,
        messageMap,
        isOpen: true,
      },
    })

    // Wait for async load
    await new Promise(resolve => setTimeout(resolve, 10))
    await wrapper.vm.$nextTick()

    const badges = wrapper.findAll('.role-badge')
    expect(badges.length).toBe(3)
    expect(badges[0]?.text()).toContain('System')
    expect(badges[1]?.text()).toContain('User')
    expect(badges[2]?.text()).toContain('Assistant')
  })
})
