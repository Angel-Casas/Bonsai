/**
 * Conversation Store
 *
 * Pinia store for managing conversation state including:
 * - Active conversation
 * - Message tree for current conversation
 * - Active message cursor (determines the current path/timeline)
 * - Streaming state for assistant responses
 *
 * Active Cursor Model:
 * - activeMessageId: The currently selected message in the tree
 * - Timeline shows: path from root → activeMessageId
 * - New messages are added as children of activeMessageId
 */

import { defineStore } from 'pinia'
import { ref, computed, shallowRef } from 'vue'
import type { Conversation, Message } from '@/db/types'
import type { SearchPreset } from '@/api/nanogpt'
import { DEFAULT_MODEL } from '@/api/nanogpt'
import { 
  sendMessageAndStream, 
  stopStream, 
  MissingApiKeyError,
  classifyError,
  type StreamingError,
} from '@/api/streamingService'
import { hasApiKey } from '@/api/settings'
import {
  listConversations,
  createConversation,
  updateConversation,
  deleteConversation,
  getConversation,
} from '@/db/repositories'
import {
  getMessagesByConversation,
  createMessage,
  updateMessage,
  getMessageMap,
} from '@/db/repositories'
import { getPathToRoot, buildChildrenMap, getLeaves } from '@/db/treeUtils'
import { 
  createBranch, 
  createVariant, 
  editMessageInPlace, 
  deleteSubtree, 
  hasDescendants,
} from '@/db/treeOperations'
import { 
  upsertPromptContextConfig, 
  createDefaultPromptContextConfig,
  setResolvedContext,
} from '@/db/repositories/promptContextConfigRepository'
import { resolveContext, type ContextResolverConfig } from '@/db/contextResolver'

export const useConversationStore = defineStore('conversation', () => {
  // ========== State ==========

  /** All conversations, ordered by updatedAt desc */
  const conversations = ref<Conversation[]>([])

  /** Currently active conversation */
  const activeConversation = ref<Conversation | null>(null)

  /** All messages in the active conversation */
  const messages = shallowRef<Message[]>([])

  /** Message map for efficient lookups */
  const messageMap = shallowRef<Map<string, Message>>(new Map())

  /** Currently active message ID (cursor position in tree) */
  const activeMessageId = ref<string | null>(null)

  /** Loading states */
  const isLoadingConversations = ref(false)
  const isLoadingMessages = ref(false)

  /** Sidebar visibility for mobile */
  const isSidebarOpen = ref(false)

  // ========== Streaming State ==========
  
  /** Whether we are currently streaming an assistant response */
  const isStreaming = ref(false)
  
  /** Current abort controller for stopping stream */
  const streamAbortController = ref<AbortController | null>(null)
  
  /** ID of the assistant message being streamed */
  const streamingMessageId = ref<string | null>(null)
  
  /** Current streaming content (for optimistic UI updates) */
  const streamingContent = ref('')
  
  /** Streaming error (structured for UI classification) */
  const streamingError = ref<StreamingError | null>(null)

  // ========== Computed ==========

  /** Children map for tree rendering */
  const childrenMap = computed(() => buildChildrenMap(messageMap.value))

  /** Path from root to active message (the timeline) */
  const timeline = computed(() => {
    if (!activeMessageId.value) return []
    return getPathToRoot(activeMessageId.value, messageMap.value)
  })

  /** Root messages (messages with no parent) */
  const rootMessages = computed(() => {
    const roots: Message[] = []
    for (const msg of messageMap.value.values()) {
      if (msg.parentId === null) {
        roots.push(msg)
      }
    }
    return roots.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  })

  /** Active message object */
  const activeMessage = computed(() => {
    if (!activeMessageId.value) return null
    return messageMap.value.get(activeMessageId.value) ?? null
  })

  // ========== Actions ==========

  /**
   * Load all conversations from the database
   */
  async function loadConversations() {
    isLoadingConversations.value = true
    try {
      conversations.value = await listConversations()
    } finally {
      isLoadingConversations.value = false
    }
  }

  /**
   * Create a new conversation
   */
  async function createNewConversation(title: string): Promise<Conversation> {
    const conversation = await createConversation({ title })
    conversations.value = [conversation, ...conversations.value]
    return conversation
  }

  /**
   * Rename a conversation
   */
  async function renameConversation(id: string, title: string): Promise<void> {
    const updated = await updateConversation(id, { title })
    if (updated) {
      const index = conversations.value.findIndex((c) => c.id === id)
      if (index !== -1) {
        conversations.value[index] = updated
      }
      if (activeConversation.value?.id === id) {
        activeConversation.value = updated
      }
    }
  }

  /**
   * Delete a conversation
   */
  async function removeConversation(id: string): Promise<void> {
    await deleteConversation(id)
    conversations.value = conversations.value.filter((c) => c.id !== id)
    if (activeConversation.value?.id === id) {
      activeConversation.value = null
      messages.value = []
      messageMap.value = new Map()
      activeMessageId.value = null
    }
  }

  /**
   * Load a conversation and its messages
   */
  async function loadConversation(id: string): Promise<void> {
    isLoadingMessages.value = true
    try {
      const conversation = await getConversation(id)
      if (!conversation) {
        throw new Error(`Conversation not found: ${id}`)
      }

      activeConversation.value = conversation
      await refreshMessages()

      // Set active message to the latest leaf if no active message
      if (!activeMessageId.value && messages.value.length > 0) {
        const leaves = getLeaves(messageMap.value)
        if (leaves.length > 0) {
          // Pick the most recently created leaf
          const sortedLeaves = leaves.sort((a, b) =>
            b.createdAt.localeCompare(a.createdAt)
          )
          const latestLeaf = sortedLeaves[0]
          if (latestLeaf) {
            activeMessageId.value = latestLeaf.id
          }
        }
      }
    } finally {
      isLoadingMessages.value = false
    }
  }

  /**
   * Refresh messages for the current conversation
   */
  async function refreshMessages(): Promise<void> {
    if (!activeConversation.value) return

    const msgs = await getMessagesByConversation(activeConversation.value.id)
    messages.value = msgs
    messageMap.value = await getMessageMap(activeConversation.value.id)

    // Validate activeMessageId still exists
    if (activeMessageId.value && !messageMap.value.has(activeMessageId.value)) {
      activeMessageId.value = null
    }
  }

  /**
   * Set the active message (cursor position)
   */
  function setActiveMessage(messageId: string | null) {
    if (messageId === null || messageMap.value.has(messageId)) {
      activeMessageId.value = messageId
    }
  }

  /**
   * Add a new user message as child of active message
   * Optionally includes context configuration for hybrid context control
   */
  async function addMessage(
    content: string, 
    role: 'user' | 'assistant' = 'user',
    contextConfig?: ContextResolverConfig
  ): Promise<Message> {
    if (!activeConversation.value) {
      throw new Error('No active conversation')
    }

    const parentId = activeMessageId.value

    const message = await createMessage({
      conversationId: activeConversation.value.id,
      parentId,
      role,
      content,
    })

    // If context config is provided, persist it with the message
    if (contextConfig && role === 'user') {
      // Create the context config for this message
      await upsertPromptContextConfig({
        messageId: message.id,
        inheritDefaultPath: true,
        startFromMessageId: contextConfig.startFromMessageId,
        excludedMessageIds: contextConfig.excludedMessageIds,
        pinnedMessageIds: contextConfig.pinnedMessageIds,
        orderingMode: 'PATH_THEN_PINS',
      })

      // Resolve and store the snapshot of context message IDs
      const resolved = resolveContext(message.id, messageMap.value, contextConfig)
      await setResolvedContext(message.id, resolved.resolvedMessageIds)
    } else if (role === 'user') {
      // Create default context config for user messages
      await createDefaultPromptContextConfig(message.id)
      
      // Compute resolved context with defaults
      const defaultConfig: ContextResolverConfig = {
        startFromMessageId: null,
        excludedMessageIds: [],
        pinnedMessageIds: [],
      }
      const resolved = resolveContext(message.id, messageMap.value, defaultConfig)
      await setResolvedContext(message.id, resolved.resolvedMessageIds)
    }

    // Update conversation updatedAt
    await updateConversation(activeConversation.value.id, {})

    // Refresh messages and set new message as active
    await refreshMessages()
    activeMessageId.value = message.id

    // Update conversation in list
    await loadConversations()

    return message
  }

  /**
   * Create a branch from a specific message
   */
  async function branchFromMessage(
    fromMessageId: string,
    content: string,
    branchTitle?: string
  ): Promise<Message> {
    if (!activeConversation.value) {
      throw new Error('No active conversation')
    }

    const result = await createBranch({
      fromMessageId,
      content,
      role: 'user',
      branchTitle,
    })

    // Update conversation updatedAt
    await updateConversation(activeConversation.value.id, {})

    // Refresh and navigate to new branch
    await refreshMessages()
    activeMessageId.value = result.message.id

    // Update conversation in list
    await loadConversations()

    return result.message
  }

  /**
   * Update a message's branch title
   */
  async function setBranchTitle(messageId: string, branchTitle: string): Promise<void> {
    await updateMessage(messageId, { branchTitle })
    await refreshMessages()
  }

  /**
   * Toggle sidebar visibility
   */
  function toggleSidebar() {
    isSidebarOpen.value = !isSidebarOpen.value
  }

  // ========== Edit/Delete Actions ==========

  /**
   * Check if a message has descendants (children)
   * Used to determine if Option A/B modal is needed for editing
   */
  async function checkHasDescendants(messageId: string): Promise<boolean> {
    return hasDescendants(messageId)
  }

  /**
   * Delete a message and all its descendants (hard delete)
   * 
   * After deletion:
   * - If active message was deleted, move cursor to nearest surviving ancestor
   * - Cleans up related PromptContextConfig and MessageRevision records
   * 
   * @param messageId - ID of message to delete
   * @returns Number of messages deleted
   */
  async function deleteMessageSubtree(messageId: string): Promise<number> {
    if (!activeConversation.value) {
      throw new Error('No active conversation')
    }

    // Don't allow deletion during streaming
    if (isStreaming.value) {
      throw new Error('Cannot delete messages while streaming')
    }

    // Get the message and its parent before deletion
    const message = messageMap.value.get(messageId)
    if (!message) {
      return 0
    }

    const parentId = message.parentId

    // Perform deletion
    const result = await deleteSubtree(messageId)

    // Update conversation updatedAt
    await updateConversation(activeConversation.value.id, {})

    // Refresh messages
    await refreshMessages()

    // If active message was in deleted subtree, move to parent or null
    if (activeMessageId.value && result.deletedIds.includes(activeMessageId.value)) {
      if (parentId && messageMap.value.has(parentId)) {
        activeMessageId.value = parentId
      } else {
        // Find the latest leaf if no parent
        const leaves = getLeaves(messageMap.value)
        if (leaves.length > 0) {
          const sortedLeaves = leaves.sort((a, b) =>
            b.createdAt.localeCompare(a.createdAt)
          )
          activeMessageId.value = sortedLeaves[0]?.id ?? null
        } else {
          activeMessageId.value = null
        }
      }
    }

    return result.deletedCount
  }

  /**
   * Edit a message in place (for messages without descendants or Option A: rewrite history)
   * 
   * Creates a revision record of the previous content.
   * If the message has descendants, they should be deleted first (Option A semantics).
   * 
   * @param messageId - ID of message to edit
   * @param newContent - New content for the message
   * @param reason - Optional reason for the edit (stored in revision)
   */
  async function editMessage(
    messageId: string,
    newContent: string,
    reason?: string
  ): Promise<Message> {
    if (!activeConversation.value) {
      throw new Error('No active conversation')
    }

    // Don't allow editing during streaming (especially the streaming message)
    if (isStreaming.value) {
      throw new Error('Cannot edit messages while streaming')
    }

    const updated = await editMessageInPlace({
      messageId,
      newContent,
      reason,
    })

    // Update conversation updatedAt
    await updateConversation(activeConversation.value.id, {})

    // Refresh messages
    await refreshMessages()

    return updated
  }

  /**
   * Edit a message with descendants using Option A: Rewrite history
   * 
   * 1. Delete all descendants of the message
   * 2. Edit the message in place
   * 3. Record revision with reason indicating rewrite-history
   * 4. Move active cursor to edited message
   * 
   * @param messageId - ID of message to edit
   * @param newContent - New content for the message
   */
  async function editMessageRewriteHistory(
    messageId: string,
    newContent: string
  ): Promise<Message> {
    if (!activeConversation.value) {
      throw new Error('No active conversation')
    }

    // Don't allow editing during streaming
    if (isStreaming.value) {
      throw new Error('Cannot edit messages while streaming')
    }

    // Get children to delete them (not the message itself)
    const children = childrenMap.value.get(messageId) ?? []
    
    // Delete all children's subtrees
    for (const child of children) {
      await deleteSubtree(child.id)
    }

    // Edit the message in place with revision
    const updated = await editMessageInPlace({
      messageId,
      newContent,
      reason: 'rewrite-history',
    })

    // Update conversation updatedAt
    await updateConversation(activeConversation.value.id, {})

    // Refresh messages
    await refreshMessages()

    // Move cursor to the edited message
    activeMessageId.value = messageId

    return updated
  }

  /**
   * Edit a message with descendants using Option B: Create new branch
   * 
   * 1. Do NOT modify the original message
   * 2. Create a variant message with edited content (sibling of original)
   * 3. Set variantOfMessageId to original
   * 4. Navigate to the new variant
   * 
   * Old descendants remain under original message untouched.
   * 
   * @param messageId - ID of original message
   * @param newContent - Content for the variant
   * @param branchTitle - Optional title for the new branch (defaults to "Edited")
   */
  async function editMessageCreateBranch(
    messageId: string,
    newContent: string,
    branchTitle?: string
  ): Promise<Message> {
    if (!activeConversation.value) {
      throw new Error('No active conversation')
    }

    // Don't allow editing during streaming
    if (isStreaming.value) {
      throw new Error('Cannot edit messages while streaming')
    }

    // Create variant (sibling with same parent, references original)
    const variant = await createVariant({
      originalMessageId: messageId,
      content: newContent,
      branchTitle: branchTitle ?? 'Edited',
    })

    // Update conversation updatedAt
    await updateConversation(activeConversation.value.id, {})

    // Refresh messages
    await refreshMessages()

    // Navigate to the new variant
    activeMessageId.value = variant.id

    return variant
  }

  /**
   * Get the count of messages that would be deleted (for confirmation UI)
   * 
   * @param messageId - ID of message to check
   * @returns Number of messages in subtree (including the message itself)
   */
  function getSubtreeCount(messageId: string): number {
    const visited = new Set<string>()
    const stack = [messageId]

    while (stack.length > 0) {
      const id = stack.pop()!
      if (visited.has(id)) continue
      visited.add(id)

      const children = childrenMap.value.get(id) ?? []
      for (const child of children) {
        stack.push(child.id)
      }
    }

    return visited.size
  }

  /**
   * Clear the active conversation
   */
  function clearActiveConversation() {
    activeConversation.value = null
    messages.value = []
    messageMap.value = new Map()
    activeMessageId.value = null
    resetStreamingState()
  }

  // ========== Streaming Actions ==========

  /**
   * Reset streaming state to idle
   */
  function resetStreamingState() {
    isStreaming.value = false
    streamAbortController.value = null
    streamingMessageId.value = null
    streamingContent.value = ''
    streamingError.value = null
  }

  /**
   * Clear the streaming error (for dismiss button)
   */
  function clearStreamingError() {
    streamingError.value = null
  }

  /**
   * Check if we can send a message (has API key)
   */
  function canSendMessage(): boolean {
    return hasApiKey()
  }

  /**
   * Send a user message and get a streaming assistant response
   * 
   * This is the main action that:
   * 1. Creates a user message with resolved context
   * 2. Starts streaming the assistant response
   * 3. Updates UI optimistically
   * 4. Persists with rate limiting
   */
  async function sendMessageWithStreaming(
    content: string,
    contextConfig: ContextResolverConfig | null,
    modelOverride: string | null,
    webSearchEnabled: boolean,
    searchPreset: SearchPreset
  ): Promise<void> {
    if (!activeConversation.value) {
      throw new Error('No active conversation')
    }

    if (!hasApiKey()) {
      // Set the error in store so error banner can display it
      streamingError.value = classifyError(new MissingApiKeyError())
      throw new MissingApiKeyError()
    }

    // Don't allow sending while streaming
    if (isStreaming.value) {
      return
    }

    // Step 1: Add the user message (this also saves context config)
    const userMessage = await addMessage(content, 'user', contextConfig ?? undefined)

    // Step 2: Start streaming
    isStreaming.value = true
    streamingError.value = null
    streamingContent.value = ''

    try {
      const result = await sendMessageAndStream(
        {
          conversationId: activeConversation.value.id,
          userMessageId: userMessage.id,
          modelOverride,
          webSearchEnabled,
          searchPreset,
          defaultModel: activeConversation.value.defaultModel ?? DEFAULT_MODEL,
        },
        messageMap.value,
        {
          onStart: (assistantMessageId) => {
            streamingMessageId.value = assistantMessageId
          },
          onContentUpdate: (newContent) => {
            streamingContent.value = newContent
          },
          onComplete: async (_finalContent) => {
            // Refresh messages to get the final persisted state
            await refreshMessages()
            
            // Navigate to the assistant message
            if (streamingMessageId.value) {
              activeMessageId.value = streamingMessageId.value
            }
            
            resetStreamingState()
          },
          onError: async (error) => {
            // Classify the error for structured UI display
            streamingError.value = classifyError(error)
            
            // Refresh to get the error state persisted
            await refreshMessages()
            
            // Navigate to the assistant message (even if errored)
            if (streamingMessageId.value) {
              activeMessageId.value = streamingMessageId.value
            }
            
            // Keep streaming state for error display, but allow retry
            isStreaming.value = false
            streamAbortController.value = null
          },
          onAbort: async (_partialContent) => {
            // Refresh to get the aborted state persisted
            await refreshMessages()
            
            // Navigate to the assistant message with partial content
            if (streamingMessageId.value) {
              activeMessageId.value = streamingMessageId.value
            }
            
            resetStreamingState()
          },
        }
      )

      streamAbortController.value = result.abortController
    } catch (error) {
      // Handle early errors (before streaming starts)
      streamingError.value = error instanceof Error 
        ? classifyError(error) 
        : { type: 'unknown', message: 'Unknown error' }
      isStreaming.value = false
      throw error
    }
  }

  /**
   * Stop the current streaming response
   */
  function stopStreaming(): void {
    stopStream(streamAbortController.value)
  }

  /**
   * Get the current content of a message, using streaming content if applicable
   * This is used by the UI to show optimistic updates
   */
  function getMessageContent(messageId: string): string {
    // If this is the streaming message, return the streaming content
    if (messageId === streamingMessageId.value && streamingContent.value) {
      return streamingContent.value
    }
    
    // Otherwise, return the persisted content
    const message = messageMap.value.get(messageId)
    return message?.content ?? ''
  }

  /**
   * Check if a message is currently streaming
   */
  function isMessageStreaming(messageId: string): boolean {
    return isStreaming.value && messageId === streamingMessageId.value
  }

  return {
    // State
    conversations,
    activeConversation,
    messages,
    messageMap,
    activeMessageId,
    isLoadingConversations,
    isLoadingMessages,
    isSidebarOpen,

    // Streaming state
    isStreaming,
    streamingMessageId,
    streamingContent,
    streamingError,

    // Computed
    childrenMap,
    timeline,
    rootMessages,
    activeMessage,

    // Actions
    loadConversations,
    createNewConversation,
    renameConversation,
    removeConversation,
    loadConversation,
    refreshMessages,
    setActiveMessage,
    addMessage,
    branchFromMessage,
    setBranchTitle,
    toggleSidebar,
    clearActiveConversation,

    // Streaming actions
    canSendMessage,
    sendMessageWithStreaming,
    stopStreaming,
    getMessageContent,
    isMessageStreaming,
    resetStreamingState,
    clearStreamingError,

    // Edit/Delete actions
    checkHasDescendants,
    deleteMessageSubtree,
    editMessage,
    editMessageRewriteHistory,
    editMessageCreateBranch,
    getSubtreeCount,
  }
})
