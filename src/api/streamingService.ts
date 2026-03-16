/**
 * Streaming Service
 * 
 * Handles the complete flow of sending a message and streaming the response:
 * 1. Creates assistant message placeholder
 * 2. Builds NanoGPT payload from resolved context
 * 3. Streams response with rate-limited persistence
 * 4. Handles errors and abort
 * 
 * Persistence Strategy:
 * - Buffer content in memory as it streams
 * - Update UI optimistically on each token
 * - Persist to IndexedDB at most every 500ms
 * - Always persist on completion or abort
 * - Partial content is safely persisted on tab crash
 */

import { 
  NanoGPTClient, 
  AuthenticationError,
  messagesToNanoGPTFormat,
  buildChatCompletionPayload,
  buildEffectiveModel,
  type SearchPreset,
} from './nanogpt'
import { getApiKey } from './settings'
import type { Message } from '@/db/types'
import { createMessage, updateMessage } from '@/db/repositories'
import { getPromptContextConfig } from '@/db/repositories/promptContextConfigRepository'

/** Throttle interval for persistence (ms) */
export const PERSISTENCE_THROTTLE_MS = 500

/** Error type classification for UI */
export type StreamingErrorType = 'auth' | 'network' | 'unknown'

/** Structured streaming error for UI display */
export interface StreamingError {
  /** Error type for UI classification */
  type: StreamingErrorType
  /** HTTP status code if available */
  status?: number
  /** User-friendly error message */
  message: string
}

/** Streaming state for UI */
export interface StreamingState {
  isStreaming: boolean
  assistantMessageId: string | null
  content: string
  error: StreamingError | null
}

/**
 * Classify an error into a structured StreamingError
 */
export function classifyError(error: Error): StreamingError {
  if (error instanceof AuthenticationError) {
    return {
      type: 'auth',
      status: error.status,
      message: `Authentication error (${error.status}). Check your NanoGPT API key.`,
    }
  }
  
  if (error instanceof MissingApiKeyError) {
    return {
      type: 'auth',
      message: 'API key not configured. Please add your NanoGPT API key in Settings.',
    }
  }
  
  // Check for network-related errors
  if (error.name === 'TypeError' && error.message.includes('fetch')) {
    return {
      type: 'network',
      message: 'Network error. Please check your connection and try again.',
    }
  }
  
  // Default to unknown error with sanitized message
  return {
    type: 'unknown',
    message: 'Request failed. Please try again.',
  }
}

/** Options for sending a message */
export interface SendMessageOptions {
  conversationId: string
  /** Parent message ID (where the new message branches from) */
  parentMessageId: string | null
  /** The user message content (not yet persisted) */
  userMessageContent: string
  /** Pre-resolved context messages to send to API (includes pending user message at the end) */
  contextMessages: Message[]
  modelOverride: string | null
  webSearchEnabled: boolean
  searchPreset: SearchPreset
  defaultModel: string
}

/** Callbacks for streaming updates */
export interface StreamingCallbacks {
  /** Called when content updates (every token) */
  onContentUpdate: (content: string) => void
  /** Called when streaming completes successfully */
  onComplete: (finalContent: string) => void
  /** Called on error. isEarlyError=true means no content was streamed and messages were cleaned up */
  onError: (error: Error, isEarlyError: boolean) => void
  /** Called when streaming is about to start. Must create and return the user message ID. */
  onCreateUserMessage: () => Promise<string>
  /** Called after assistant message is created */
  onAssistantCreated: (assistantMessageId: string) => void
  /** Called when streaming is aborted */
  onAbort?: (partialContent: string) => void
}

/** Result of starting a stream */
export interface StreamResult {
  /** AbortController to cancel the stream */
  abortController: AbortController
  /** ID of the created assistant message */
  assistantMessageId: string
}

/**
 * Error thrown when API key is missing
 */
export class MissingApiKeyError extends Error {
  constructor() {
    super('API key not configured. Please set your NanoGPT API key in Settings.')
    this.name = 'MissingApiKeyError'
  }
}

/**
 * Create a throttled function that calls the given function at most once per interval
 * Also flushes on demand
 */
export function createThrottledPersistence(
  fn: () => Promise<void>,
  intervalMs: number = PERSISTENCE_THROTTLE_MS
): { schedule: () => void; flush: () => Promise<void>; cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let pendingFlush: Promise<void> | null = null
  let needsFlush = false

  const flush = async () => {
    if (timeoutId) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
    if (pendingFlush) {
      await pendingFlush
    }
    if (needsFlush) {
      needsFlush = false
      pendingFlush = fn().finally(() => {
        pendingFlush = null
      })
      await pendingFlush
    }
  }

  const schedule = () => {
    needsFlush = true
    if (!timeoutId && !pendingFlush) {
      timeoutId = setTimeout(() => {
        timeoutId = null
        flush().catch(console.error)
      }, intervalMs)
    }
  }

  const cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
    needsFlush = false
  }

  return { schedule, flush, cancel }
}

/**
 * Build the context messages from the resolved context snapshot
 * 
 * This function retrieves the resolvedContextMessageIds from the user message's
 * PromptContextConfig and fetches those messages in order.
 */
export async function buildContextMessages(
  userMessageId: string,
  messageMap: Map<string, Message>
): Promise<Message[]> {
  // Get the stored context config for this user message
  const config = await getPromptContextConfig(userMessageId)
  
  if (!config || !config.resolvedContextMessageIds || config.resolvedContextMessageIds.length === 0) {
    // Fallback: if no resolved context, just include the user message itself
    const userMessage = messageMap.get(userMessageId)
    return userMessage ? [userMessage] : []
  }
  
  // Fetch messages in the exact order they were resolved
  const messages: Message[] = []
  for (const id of config.resolvedContextMessageIds) {
    const msg = messageMap.get(id)
    if (msg) {
      messages.push(msg)
    }
  }
  
  return messages
}

/**
 * Send a message and stream the assistant response
 *
 * Flow:
 * 1. Validate API key exists
 * 2. Use pre-resolved context messages
 * 3. Start streaming API call
 * 4. On first success signal (requestId or token), create user & assistant messages
 * 5. Update content with rate-limited persistence
 * 6. On complete/error/abort, persist final state
 *
 * Key: Messages are NOT created until we know the API call succeeded,
 * preventing the "message appears then disappears" glitch on early errors.
 */
export async function sendMessageAndStream(
  options: SendMessageOptions,
  _messageMap: Map<string, Message>, // Kept for signature compatibility
  callbacks: StreamingCallbacks
): Promise<StreamResult> {
  // Step 1: Validate API key
  const apiKey = getApiKey()
  if (!apiKey) {
    throw new MissingApiKeyError()
  }

  // Step 2: Use pre-resolved context messages (includes pending user message)
  const nanoMessages = messagesToNanoGPTFormat(options.contextMessages)

  // Step 3: Build effective model string
  const baseModel = options.modelOverride ?? options.defaultModel
  const effectiveModel = buildEffectiveModel(baseModel, options.webSearchEnabled, options.searchPreset)

  // Messages will be created on first success signal
  let userMessageId: string | null = null
  let assistantMessageId: string | null = null
  let messageCreationPromise: Promise<void> | null = null
  let currentContent = ''
  let isAborted = false
  let throttledPersist: ReturnType<typeof createThrottledPersistence> | null = null

  // Create messages when we know the API call succeeded.
  // Uses a Promise (not a boolean) so concurrent callers properly wait for completion.
  const ensureMessagesCreated = async () => {
    if (!messageCreationPromise) {
      messageCreationPromise = (async () => {
        // Let the store create and persist the user message
        userMessageId = await callbacks.onCreateUserMessage()

        // Create assistant message as child of user message
        const assistantMessage = await createMessage({
          conversationId: options.conversationId,
          parentId: userMessageId,
          role: 'assistant',
          content: currentContent, // May already have some content
          modelRespondedWith: effectiveModel,
          streamingStatus: 'streaming',
        })
        assistantMessageId = assistantMessage.id

        // Notify store of assistant message
        callbacks.onAssistantCreated(assistantMessageId)

        // Set up throttled persistence now that we have the message
        throttledPersist = createThrottledPersistence(async () => {
          if (assistantMessageId) {
            await updateMessage(assistantMessageId, { content: currentContent })
          }
        }, PERSISTENCE_THROTTLE_MS)
      })()
    }
    return messageCreationPromise
  }

  // Create client and start streaming
  const client = new NanoGPTClient(apiKey)
  const payload = buildChatCompletionPayload(nanoMessages, effectiveModel, true)

  const abortController = await client.streamChatCompletion(payload, {
    onToken: (token) => {
      if (isAborted) return
      currentContent += token

      // Create messages on first token (fire and forget)
      if (!messageCreationPromise) {
        ensureMessagesCreated().catch(console.error)
      }

      callbacks.onContentUpdate(currentContent)
      throttledPersist?.schedule()
    },
    onComplete: async (fullContent) => {
      if (isAborted) return
      currentContent = fullContent
      throttledPersist?.cancel()

      // Ensure messages exist (in case onComplete fires without tokens)
      await ensureMessagesCreated()

      // Final persist with complete status
      if (assistantMessageId) {
        await updateMessage(assistantMessageId, {
          content: fullContent,
          streamingStatus: 'complete',
        })
      }

      callbacks.onComplete(fullContent)
    },
    onError: async (error) => {
      if (isAborted) return
      throttledPersist?.cancel()

      // Early error = message creation was never initiated = nothing to clean up
      const isEarlyError = !messageCreationPromise

      if (!isEarlyError && assistantMessageId) {
        // Messages exist - update with error state
        const errorMessage = error instanceof AuthenticationError
          ? 'Authentication failed. Please check your API key in Settings.'
          : error.message

        await updateMessage(assistantMessageId, {
          content: currentContent,
          streamingStatus: 'error',
          streamingError: errorMessage,
        })
      }
      // If early error, no messages were created, no cleanup needed

      callbacks.onError(error, isEarlyError)
    },
    onRequestId: async (requestId) => {
      // Request ID means server accepted - create messages
      await ensureMessagesCreated()
      if (assistantMessageId) {
        await updateMessage(assistantMessageId, { requestId })
      }
    },
  })

  // Set up abort handler
  abortController.signal.addEventListener('abort', async () => {
    if (isAborted) return
    isAborted = true

    throttledPersist?.cancel()

    if (assistantMessageId) {
      await updateMessage(assistantMessageId, {
        content: currentContent,
        streamingStatus: 'aborted',
      })
    }

    callbacks.onAbort?.(currentContent)
  })

  return {
    abortController,
    assistantMessageId: assistantMessageId ?? '',
  }
}

/**
 * Stop an ongoing stream
 */
export function stopStream(abortController: AbortController | null): void {
  if (abortController) {
    abortController.abort()
  }
}
