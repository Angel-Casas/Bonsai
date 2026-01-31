import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises, VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import HomeView from './HomeView.vue'

// Mock the conversationStore to avoid IndexedDB issues in component tests
vi.mock('@/stores/conversationStore', () => ({
  useConversationStore: () => ({
    conversations: [],
    isLoadingConversations: false,
    loadConversations: vi.fn().mockResolvedValue(undefined),
    createNewConversation: vi.fn().mockResolvedValue({ id: 'test-id', title: 'Test' }),
    renameConversation: vi.fn().mockResolvedValue(undefined),
    removeConversation: vi.fn().mockResolvedValue(undefined),
  }),
}))

// Mock the themeStore used by HomeView and TopNavBar
vi.mock('@/stores/themeStore', () => ({
  useThemeStore: () => ({
    isDayMode: false,
    toggleTheme: vi.fn(),
    init: vi.fn(),
  }),
}))

// Mock vue-router - must include all exports used by component tree (HomeView + TopNavBar)
vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
  useRoute: () => ({
    path: '/',
    params: {},
    query: {},
  }),
}))

describe('HomeView', () => {
  let wrapper: VueWrapper

  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('renders the home page with navigation', async () => {
    wrapper = mount(HomeView)
    await flushPromises()

    // HomeView should render with the home-page container
    expect(wrapper.find('.home-page').exists()).toBe(true)
    // TopNavBar is rendered as a child component
    expect(wrapper.findComponent({ name: 'TopNavBar' }).exists()).toBe(true)
  })

  it('renders the empty state with correct messaging', async () => {
    wrapper = mount(HomeView)
    await flushPromises()

    // Empty state should show the new user-friendly messaging
    expect(wrapper.text()).toContain('Start Your First Conversation')
    expect(wrapper.text()).toContain(
      'Create a conversation to begin exploring branching dialogue with focused context control.'
    )
  })

  it('shows empty state when no conversations exist', async () => {
    wrapper = mount(HomeView)

    // Wait for loading to complete
    await flushPromises()

    const emptyState = wrapper.find('[data-testid="empty-state"]')
    expect(emptyState.exists()).toBe(true)
    expect(wrapper.text()).toContain('Start Your First Conversation')
  })

  it('shows new conversation button', async () => {
    wrapper = mount(HomeView)
    await flushPromises()

    const newConversationBtn = wrapper.find('[data-testid="new-conversation-btn"]')
    expect(newConversationBtn.exists()).toBe(true)
    expect(newConversationBtn.text()).toContain('New Conversation')
  })

  it('shows input field when new conversation button is clicked', async () => {
    wrapper = mount(HomeView)
    await flushPromises()

    const newConversationBtn = wrapper.find('[data-testid="new-conversation-btn"]')
    await newConversationBtn.trigger('click')

    const input = wrapper.find('[data-testid="new-conversation-input"]')
    expect(input.exists()).toBe(true)

    const createBtn = wrapper.find('[data-testid="create-conversation-btn"]')
    expect(createBtn.exists()).toBe(true)
  })
})
