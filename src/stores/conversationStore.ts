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
import { buildChildrenMap, getLeaves, getFullBranchTimeline } from '@/db/treeUtils'
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
import { resolveContext, type ContextResolverConfig, type ContextPreset } from '@/db/contextResolver'
import { nowISO, generateId } from '@/db'
import { safeAppendOp } from '@/db/opsService'

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

  // ========== Animation State ==========

  /** Message IDs created during this session (for entrance animations) */
  const newMessageIds = ref<Set<string>>(new Set())

  // ========== Context Configuration State ==========

  /** Message IDs excluded from context for the current conversation */
  const excludedMessageIds = ref<Set<string>>(new Set())

  /** Message IDs pinned into context from outside the current path */
  const contextPinnedMessageIds = ref<string[]>([])

  /** Start context from this message (anchor) instead of root */
  const contextStartFromMessageId = ref<string | null>(null)

  // ========== Context Presets State ==========

  /** Saved context presets for the current conversation */
  const contextPresets = ref<ContextPreset[]>([])

  /** ID of the currently active (loaded) preset, or null if none */
  const activePresetId = ref<string | null>(null)

  /** Snapshot of config at the moment a preset was loaded (for detecting modifications) */
  const activePresetSnapshot = ref<ContextResolverConfig | null>(null)

  // ========== Computed ==========

  /** Children map for tree rendering */
  const childrenMap = computed(() => buildChildrenMap(messageMap.value))

  /** Full branch timeline: path from root through active message to leaf */
  const timeline = computed(() => {
    if (!activeMessageId.value) return []
    return getFullBranchTimeline(activeMessageId.value, messageMap.value)
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

  /** Name of the active preset (for display), or null */
  const activePresetName = computed<string | null>(() => {
    if (!activePresetId.value) return null
    return contextPresets.value.find(p => p.id === activePresetId.value)?.name ?? null
  })

  /** Whether the current context config differs from the loaded preset's snapshot */
  const isActivePresetModified = computed<boolean>(() => {
    if (!activePresetId.value || !activePresetSnapshot.value) return false
    const current = {
      startFromMessageId: contextStartFromMessageId.value,
      excludedMessageIds: Array.from(excludedMessageIds.value).sort(),
      pinnedMessageIds: [...contextPinnedMessageIds.value].sort(),
    }
    const snapshot = {
      startFromMessageId: activePresetSnapshot.value.startFromMessageId,
      excludedMessageIds: [...activePresetSnapshot.value.excludedMessageIds].sort(),
      pinnedMessageIds: [...activePresetSnapshot.value.pinnedMessageIds].sort(),
    }
    return JSON.stringify(current) !== JSON.stringify(snapshot)
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
    safeAppendOp('conversation.create', { conversationId: conversation.id, title }, conversation.id)
    conversations.value = [conversation, ...conversations.value]
    return conversation
  }

  /**
   * Rename a conversation
   */
  async function renameConversation(id: string, title: string): Promise<void> {
    const updated = await updateConversation(id, { title })
    if (updated) {
      safeAppendOp('conversation.rename', { conversationId: id, title }, id)
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
   * Set the default model for a conversation
   */
  async function setConversationDefaultModel(id: string, defaultModel: string): Promise<void> {
    const updated = await updateConversation(id, { defaultModel })
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
    safeAppendOp('conversation.delete', { conversationId: id }, id)
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
    newMessageIds.value = new Set()
    try {
      const conversation = await getConversation(id)
      if (!conversation) {
        throw new Error(`Conversation not found: ${id}`)
      }

      activeConversation.value = conversation

      // Restore context config from conversation uiState (persisted across sessions)
      const saved = conversation.uiState?.contextConfig as {
        excludedMessageIds?: string[]
        pinnedMessageIds?: string[]
        startFromMessageId?: string | null
      } | undefined
      excludedMessageIds.value = new Set(saved?.excludedMessageIds ?? [])
      contextPinnedMessageIds.value = saved?.pinnedMessageIds ?? []
      contextStartFromMessageId.value = saved?.startFromMessageId ?? null

      // Restore context presets
      const savedPresets = conversation.uiState?.contextPresets as ContextPreset[] | undefined
      contextPresets.value = savedPresets ?? []
      activePresetId.value = (conversation.uiState?.activePresetId as string | null) ?? null
      if (activePresetId.value) {
        const active = contextPresets.value.find(p => p.id === activePresetId.value)
        activePresetSnapshot.value = active
          ? JSON.parse(JSON.stringify(active.config))
          : null
        if (!active) activePresetId.value = null
      } else {
        activePresetSnapshot.value = null
      }

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
      // Active message was deleted - try to select a new one
      if (messageMap.value.size > 0) {
        // Pick the latest leaf message as the new active message
        const leaves = getLeaves(messageMap.value)
        if (leaves.length > 0) {
          // Sort by createdAt descending and pick the most recent
          leaves.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          activeMessageId.value = leaves[0]!.id
        } else {
          activeMessageId.value = null
        }
      } else {
        activeMessageId.value = null
      }
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
    contextConfig?: ContextResolverConfig,
    branchTitle?: string,
    parentIdOverride?: string | null
  ): Promise<Message> {
    if (!activeConversation.value) {
      throw new Error('No active conversation')
    }

    const parentId = parentIdOverride !== undefined ? parentIdOverride : activeMessageId.value

    const message = await createMessage({
      conversationId: activeConversation.value.id,
      parentId,
      role,
      content,
      branchTitle,
    })

    // If context config is provided, persist it with the message
    if (contextConfig && role === 'user') {
      // Create the context config for this message
      await upsertPromptContextConfig({
        messageId: message.id,
        inheritDefaultPath: true,
        startFromMessageId: contextConfig.startFromMessageId,
        excludedMessageIds: [...contextConfig.excludedMessageIds],
        pinnedMessageIds: [...contextConfig.pinnedMessageIds],
        orderingMode: 'PATH_THEN_PINS',
      })

      // Resolve context from PARENT (which is in messageMap), then append new message
      // The new message isn't in messageMap yet, so we can't use getPathToRoot on it
      let resolvedIds: string[] = []
      if (parentId) {
        const resolved = resolveContext(parentId, messageMap.value, contextConfig)
        resolvedIds = [...resolved.resolvedMessageIds]
      }
      resolvedIds.push(message.id) // Always include the new user message
      await setResolvedContext(message.id, resolvedIds)
    } else if (role === 'user') {
      // Create default context config for user messages
      await createDefaultPromptContextConfig(message.id)

      // Resolve context from PARENT with defaults, then append new message
      const defaultConfig: ContextResolverConfig = {
        startFromMessageId: null,
        excludedMessageIds: [],
        pinnedMessageIds: [],
      }
      let resolvedIds: string[] = []
      if (parentId) {
        const resolved = resolveContext(parentId, messageMap.value, defaultConfig)
        resolvedIds = [...resolved.resolvedMessageIds]
      }
      resolvedIds.push(message.id) // Always include the new user message
      await setResolvedContext(message.id, resolvedIds)
    }

    // Update conversation updatedAt
    await updateConversation(activeConversation.value.id, {})

    // Refresh messages and set new message as active
    await refreshMessages()
    activeMessageId.value = message.id

    // Auto-exclude new messages whose parent is excluded (propagate branch exclusions)
    if (parentId && excludedMessageIds.value.has(parentId)) {
      const newSet = new Set(excludedMessageIds.value)
      newSet.add(message.id)
      excludedMessageIds.value = newSet
      saveContextConfig()
    }
    // Propagate to all saved presets that exclude the parent
    if (parentId) {
      await propagateExclusionToPresets(parentId, message.id)
    }

    // Track for entrance animation
    newMessageIds.value = new Set([...newMessageIds.value, message.id])

    // Update conversation in list
    await loadConversations()

    safeAppendOp('message.create', {
      messageId: message.id,
      conversationId: activeConversation.value.id,
      parentId,
      role,
      content,
      branchTitle,
    }, activeConversation.value.id)

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

    safeAppendOp('message.create', {
      messageId: result.message.id,
      conversationId: activeConversation.value.id,
      parentId: fromMessageId,
      role: 'user',
      content,
      branchTitle,
    }, activeConversation.value.id)

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

    safeAppendOp('message.deleteSubtree', {
      messageId,
      deletedCount: result.deletedCount,
    }, activeConversation.value.id)

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

    safeAppendOp('message.edit', {
      messageId,
      content: newContent,
      reason,
    }, activeConversation.value.id)

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

    for (const child of children) {
      safeAppendOp('message.deleteSubtree', {
        messageId: child.id,
        deletedCount: 0,
      }, activeConversation.value.id)
    }

    // Edit the message in place with revision
    const updated = await editMessageInPlace({
      messageId,
      newContent,
      reason: 'rewrite-history',
    })

    safeAppendOp('message.edit', {
      messageId,
      content: newContent,
      reason: 'rewrite-history',
    }, activeConversation.value.id)

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

    safeAppendOp('message.createVariant', {
      messageId: variant.id,
      variantOfMessageId: messageId,
      content: newContent,
      branchTitle: branchTitle ?? 'Edited',
    }, activeConversation.value.id)

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
    newMessageIds.value = new Set()
    excludedMessageIds.value = new Set()
    contextPinnedMessageIds.value = []
    contextStartFromMessageId.value = null
    contextPresets.value = []
    activePresetId.value = null
    activePresetSnapshot.value = null
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

  function clearNewMessageId(messageId: string) {
    const next = new Set(newMessageIds.value)
    next.delete(messageId)
    newMessageIds.value = next
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
    searchPreset: SearchPreset,
    branchTitle?: string | null
  ): Promise<void> {
    if (!activeConversation.value) {
      throw new Error('No active conversation')
    }

    if (!hasApiKey()) {
      // Set the error in store so error banner can display it
      streamingError.value = classifyError(new MissingApiKeyError())
      return
    }

    // Don't allow sending while streaming
    if (isStreaming.value) {
      return
    }

    // Step 1: Resolve context from PARENT (current active message)
    // This happens BEFORE creating the user message
    const parentId = activeMessageId.value
    const config = contextConfig ?? {
      startFromMessageId: null,
      excludedMessageIds: [],
      pinnedMessageIds: [],
    }

    let resolvedMessages: Message[] = []
    if (parentId) {
      const resolved = resolveContext(parentId, messageMap.value, config)
      resolvedMessages = resolved.resolvedMessages
    }

    // Create a virtual user message to include in context (not persisted yet)
    const virtualUserMessage: Message = {
      id: 'pending-user-message',
      conversationId: activeConversation.value.id,
      parentId,
      role: 'user',
      content,
      createdAt: nowISO(),
      updatedAt: nowISO(),
      deletedAt: undefined,
      contentEnc: null,
      branchTitle: branchTitle ?? undefined,
    }

    // Context = resolved path messages + virtual user message
    const contextMessages = [...resolvedMessages, virtualUserMessage]

    // Step 2: Create user message eagerly so it appears immediately in the timeline.
    // This gives instant feedback: the branch is created, highlighted, and navigated to.
    // If an error occurs later during streaming, the user can resend.
    let userMessage: Message
    try {
      userMessage = await addMessage(
        content,
        'user',
        contextConfig ?? undefined,
        branchTitle ?? undefined,
        parentId
      )
    } catch (error) {
      // Route creation errors to streamingError (which IS displayed in the error banner)
      streamingError.value = error instanceof Error
        ? classifyError(error)
        : { type: 'unknown', message: 'Failed to create message' }
      return
    }

    // Step 3: Start streaming
    isStreaming.value = true
    streamingError.value = null
    streamingContent.value = ''

    try {
      const result = await sendMessageAndStream(
        {
          conversationId: activeConversation.value.id,
          parentMessageId: parentId,
          userMessageContent: content,
          contextMessages,
          modelOverride,
          webSearchEnabled,
          searchPreset,
          defaultModel: activeConversation.value.defaultModel ?? DEFAULT_MODEL,
        },
        messageMap.value,
        {
          // User message already created — just return its ID
          onCreateUserMessage: async () => {
            return userMessage.id
          },
          // Called after assistant message is created
          onAssistantCreated: async (assistantMessageId) => {
            streamingMessageId.value = assistantMessageId
            newMessageIds.value = new Set([...newMessageIds.value, assistantMessageId])
            // Refresh so the assistant message appears in messageMap/timeline during streaming
            await refreshMessages()
            // Navigate to the assistant message so the timeline includes it
            activeMessageId.value = assistantMessageId
            // Auto-exclude if parent (user message) is excluded
            if (excludedMessageIds.value.has(userMessage.id)) {
              const newSet = new Set(excludedMessageIds.value)
              newSet.add(assistantMessageId)
              excludedMessageIds.value = newSet
              saveContextConfig()
            }
            // Propagate to all saved presets that exclude the user message
            await propagateExclusionToPresets(userMessage.id, assistantMessageId)
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
              // Clear from newMessageIds so the message stays rendered as plain text
              // instead of switching to the TextReveal entrance animation
              const next = new Set(newMessageIds.value)
              next.delete(streamingMessageId.value)
              newMessageIds.value = next
            }

            resetStreamingState()
          },
          onError: async (error, isEarlyError) => {
            // Classify the error for structured UI display
            streamingError.value = classifyError(error)

            if (isEarlyError) {
              // No assistant message was created - user message is kept so user can retry.
              // Just reset streaming state (but keep the error)
              isStreaming.value = false
              streamAbortController.value = null
              streamingMessageId.value = null
              streamingContent.value = ''
            } else {
              // Messages exist - refresh to get error state
              await refreshMessages()

              // Navigate to the assistant message (even if errored)
              if (streamingMessageId.value) {
                activeMessageId.value = streamingMessageId.value
              }

              // Keep streaming state for error display, but allow retry
              isStreaming.value = false
              streamAbortController.value = null
            }
          },
          onAbort: async (_partialContent) => {
            // Refresh to get the aborted state persisted
            await refreshMessages()

            // Navigate to the assistant message with partial content
            if (streamingMessageId.value) {
              activeMessageId.value = streamingMessageId.value
              const next = new Set(newMessageIds.value)
              next.delete(streamingMessageId.value)
              newMessageIds.value = next
            }

            resetStreamingState()
          },
        }
      )

      streamAbortController.value = result.abortController
    } catch (error) {
      // Early error before streaming started - user message exists but no assistant message
      streamingError.value = error instanceof Error
        ? classifyError(error)
        : { type: 'unknown', message: 'Unknown error' }
      isStreaming.value = false
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

  // ========== Context Exclusion Actions ==========

  /** Persist current context config to the conversation's uiState in the DB */
  async function saveContextConfig(): Promise<void> {
    if (!activeConversation.value) return
    const convId = activeConversation.value.id
    const contextConfig = {
      excludedMessageIds: Array.from(excludedMessageIds.value),
      pinnedMessageIds: [...contextPinnedMessageIds.value],
      startFromMessageId: contextStartFromMessageId.value,
    }
    // Build a plain object — IndexedDB's structured clone cannot handle Vue proxies
    const existingUiState = activeConversation.value.uiState
    const uiState: Record<string, unknown> = existingUiState
      ? JSON.parse(JSON.stringify(existingUiState))
      : {}
    uiState.contextConfig = contextConfig
    uiState.activePresetId = activePresetId.value
    activeConversation.value = {
      ...activeConversation.value,
      uiState,
    }
    await updateConversation(convId, { uiState })
  }

  /**
   * Toggle a message's exclusion from context
   */
  function toggleMessageExclusion(messageId: string): void {
    const newSet = new Set(excludedMessageIds.value)
    if (newSet.has(messageId)) {
      newSet.delete(messageId)
    } else {
      newSet.add(messageId)
    }
    excludedMessageIds.value = newSet
    saveContextConfig()
  }

  /**
   * Check if a message is excluded from context
   */
  function isMessageExcluded(messageId: string): boolean {
    return excludedMessageIds.value.has(messageId)
  }

  /**
   * Clear all exclusions for the current conversation
   */
  function clearExclusions(): void {
    excludedMessageIds.value = new Set()
  }

  /**
   * Toggle a pinned message in/out of the context pins list
   */
  function toggleContextPin(messageId: string): void {
    if (contextPinnedMessageIds.value.includes(messageId)) {
      contextPinnedMessageIds.value = contextPinnedMessageIds.value.filter(id => id !== messageId)
    } else {
      contextPinnedMessageIds.value = [...contextPinnedMessageIds.value, messageId]
    }
    saveContextConfig()
  }

  /**
   * Batch-update both exclusions and pins in one operation (single persist).
   * Used by the ContextBuilder when toggling off-path messages or entire branches.
   */
  function setContextState(newExcluded: Set<string>, newPinned: string[]): void {
    excludedMessageIds.value = newExcluded
    contextPinnedMessageIds.value = newPinned
    saveContextConfig()
  }

  /**
   * Set or clear the context start anchor
   */
  function setContextAnchor(messageId: string | null): void {
    contextStartFromMessageId.value = messageId
    saveContextConfig()
  }

  /**
   * Reset all context configuration (exclusions, pins, anchor)
   */
  function clearAllContextConfig(): void {
    excludedMessageIds.value = new Set()
    contextPinnedMessageIds.value = []
    contextStartFromMessageId.value = null
    activePresetId.value = null
    activePresetSnapshot.value = null
    saveContextConfig()
  }

  /**
   * Propagate exclusion to all saved presets that exclude the parent message.
   * If parentId is in a preset's excludedMessageIds, add newMessageId to it too.
   */
  async function propagateExclusionToPresets(parentId: string, newMessageId: string): Promise<void> {
    let modified = false
    const updated = contextPresets.value.map(preset => {
      if (preset.config.excludedMessageIds.includes(parentId)) {
        modified = true
        return {
          ...preset,
          config: {
            ...preset.config,
            excludedMessageIds: [...preset.config.excludedMessageIds, newMessageId],
          },
        }
      }
      return preset
    })
    if (modified) {
      contextPresets.value = updated
      await persistPresets()
    }
  }

  // ========== Context Preset Actions ==========

  /** Persist presets and active preset ID to conversation uiState */
  async function persistPresets(): Promise<void> {
    if (!activeConversation.value) return
    const convId = activeConversation.value.id
    const existingUiState = activeConversation.value.uiState
    const uiState: Record<string, unknown> = existingUiState
      ? JSON.parse(JSON.stringify(existingUiState))
      : {}
    uiState.contextPresets = contextPresets.value.map(p => ({
      id: p.id,
      name: p.name,
      config: JSON.parse(JSON.stringify(p.config)),
      createdAt: p.createdAt,
    }))
    uiState.activePresetId = activePresetId.value
    activeConversation.value = { ...activeConversation.value, uiState }
    await updateConversation(convId, { uiState })
  }

  /** Save current context config as a new named preset */
  async function savePreset(name: string): Promise<ContextPreset> {
    const config: ContextResolverConfig = {
      startFromMessageId: contextStartFromMessageId.value,
      excludedMessageIds: Array.from(excludedMessageIds.value),
      pinnedMessageIds: [...contextPinnedMessageIds.value],
    }
    const preset: ContextPreset = {
      id: generateId(),
      name,
      config,
      createdAt: nowISO(),
    }
    contextPresets.value = [...contextPresets.value, preset]
    activePresetId.value = preset.id
    activePresetSnapshot.value = JSON.parse(JSON.stringify(config))
    await persistPresets()
    return preset
  }

  /** Load a preset, replacing the current context config */
  function loadPreset(presetId: string): void {
    const preset = contextPresets.value.find(p => p.id === presetId)
    if (!preset) return
    contextStartFromMessageId.value = preset.config.startFromMessageId ?? null
    activePresetId.value = preset.id
    activePresetSnapshot.value = JSON.parse(JSON.stringify(preset.config))
    // Use setContextState for the same reactive path that works for toggles
    setContextState(
      new Set([...preset.config.excludedMessageIds]),
      [...preset.config.pinnedMessageIds],
    )
  }

  /** Update an existing preset with the current context config */
  async function updatePresetFromCurrent(presetId: string): Promise<void> {
    const idx = contextPresets.value.findIndex(p => p.id === presetId)
    if (idx === -1) return
    const updatedConfig: ContextResolverConfig = {
      startFromMessageId: contextStartFromMessageId.value,
      excludedMessageIds: Array.from(excludedMessageIds.value),
      pinnedMessageIds: [...contextPinnedMessageIds.value],
    }
    const updated = [...contextPresets.value]
    updated[idx] = { ...updated[idx]!, config: updatedConfig }
    contextPresets.value = updated
    activePresetSnapshot.value = JSON.parse(JSON.stringify(updatedConfig))
    await persistPresets()
  }

  /** Rename a preset */
  async function renamePreset(presetId: string, newName: string): Promise<void> {
    const idx = contextPresets.value.findIndex(p => p.id === presetId)
    if (idx === -1) return
    const updated = [...contextPresets.value]
    updated[idx] = { ...updated[idx]!, name: newName }
    contextPresets.value = updated
    await persistPresets()
  }

  /** Delete a preset */
  async function deletePreset(presetId: string): Promise<void> {
    contextPresets.value = contextPresets.value.filter(p => p.id !== presetId)
    if (activePresetId.value === presetId) {
      activePresetId.value = null
      activePresetSnapshot.value = null
    }
    await persistPresets()
  }

  /** Deactivate the active preset without changing the current config */
  function deactivatePreset(): void {
    activePresetId.value = null
    activePresetSnapshot.value = null
    saveContextConfig()
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

    // Context configuration state
    excludedMessageIds,
    contextPinnedMessageIds,
    contextStartFromMessageId,
    toggleMessageExclusion,
    isMessageExcluded,
    clearExclusions,
    toggleContextPin,
    setContextState,
    setContextAnchor,
    clearAllContextConfig,

    // Context presets
    contextPresets,
    activePresetId,
    activePresetName,
    isActivePresetModified,
    savePreset,
    loadPreset,
    updatePresetFromCurrent,
    renamePreset,
    deletePreset,
    deactivatePreset,

    // Computed
    childrenMap,
    timeline,
    rootMessages,
    activeMessage,

    // Actions
    loadConversations,
    createNewConversation,
    renameConversation,
    setConversationDefaultModel,
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

    // Animation state
    newMessageIds,
    clearNewMessageId,

    // Edit/Delete actions
    checkHasDescendants,
    deleteMessageSubtree,
    editMessage,
    editMessageRewriteHistory,
    editMessageCreateBranch,
    getSubtreeCount,
  }
})
