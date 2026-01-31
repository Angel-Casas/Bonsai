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
  userMessageId: string
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
  /** Called on error */
  onError: (error: Error) => void
  /** Called when streaming starts (with assistant message ID) */
  onStart: (assistantMessageId: string) => void
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
 * 2. Build context from resolved snapshot
 * 3. Create assistant message placeholder with 'streaming' status
 * 4. Call NanoGPT streaming API
 * 5. Update content with rate-limited persistence
 * 6. On complete/error/abort, persist final state
 */
export async function sendMessageAndStream(
  options: SendMessageOptions,
  messageMap: Map<string, Message>,
  callbacks: StreamingCallbacks
): Promise<StreamResult> {
  // Step 1: Validate API key
  const apiKey = getApiKey()
  if (!apiKey) {
    throw new MissingApiKeyError()
  }
  
  // Step 2: Build context from resolved snapshot
  const contextMessages = await buildContextMessages(options.userMessageId, messageMap)
  const nanoMessages = messagesToNanoGPTFormat(contextMessages)
  
  // Step 3: Build effective model string
  const baseModel = options.modelOverride ?? options.defaultModel
  const effectiveModel = buildEffectiveModel(baseModel, options.webSearchEnabled, options.searchPreset)
  
  // Step 4: Create assistant message placeholder
  const assistantMessage = await createMessage({
    conversationId: options.conversationId,
    parentId: options.userMessageId,
    role: 'assistant',
    content: '',
    modelRespondedWith: effectiveModel,
    streamingStatus: 'streaming',
  })
  
  callbacks.onStart(assistantMessage.id)
  
  // Step 5: Set up streaming with throttled persistence
  let currentContent = ''
  let isAborted = false
  
  const persistContent = async () => {
    await updateMessage(assistantMessage.id, {
      content: currentContent,
    })
  }
  
  const throttledPersist = createThrottledPersistence(persistContent, PERSISTENCE_THROTTLE_MS)
  
  // Create client and start streaming
  const client = new NanoGPTClient(apiKey)
  const payload = buildChatCompletionPayload(nanoMessages, effectiveModel, true)
  
  const abortController = await client.streamChatCompletion(payload, {
    onToken: (token) => {
      if (isAborted) return
      currentContent += token
      callbacks.onContentUpdate(currentContent)
      throttledPersist.schedule()
    },
    onComplete: async (fullContent) => {
      if (isAborted) return
      currentContent = fullContent
      throttledPersist.cancel()
      
      // Final persist with complete status
      await updateMessage(assistantMessage.id, {
        content: fullContent,
        streamingStatus: 'complete',
      })
      
      callbacks.onComplete(fullContent)
    },
    onError: async (error) => {
      if (isAborted) return
      throttledPersist.cancel()
      
      // Handle authentication errors specially
      const errorMessage = error instanceof AuthenticationError
        ? 'Authentication failed. Please check your API key in Settings.'
        : error.message
      
      // Persist partial content with error status
      await updateMessage(assistantMessage.id, {
        content: currentContent,
        streamingStatus: 'error',
        streamingError: errorMessage,
      })
      
      callbacks.onError(error)
    },
    onRequestId: async (requestId) => {
      await updateMessage(assistantMessage.id, {
        requestId,
      })
    },
  })
  
  // Set up abort handler
  abortController.signal.addEventListener('abort', async () => {
    if (isAborted) return
    isAborted = true
    
    throttledPersist.cancel()
    
    // Persist partial content with aborted status
    await updateMessage(assistantMessage.id, {
      content: currentContent,
      streamingStatus: 'aborted',
    })
    
    callbacks.onAbort?.(currentContent)
  })
  
  return {
    abortController,
    assistantMessageId: assistantMessage.id,
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
