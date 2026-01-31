/**
 * NanoGPT API Client
 * 
 * Implements OpenAI-compatible chat completions endpoint with SSE streaming.
 * Base URL: https://nano-gpt.com/api/v1
 */

import type { Message, MessageRole } from '@/db/types'

// ============ Types ============

/** NanoGPT message format (OpenAI-compatible) */
export interface NanoGPTMessage {
  role: MessageRole
  content: string
}

/** Request body for chat completions */
export interface ChatCompletionRequest {
  model: string
  messages: NanoGPTMessage[]
  stream?: boolean
  temperature?: number
  max_tokens?: number
}

/** Streaming chunk delta */
export interface StreamDelta {
  content?: string
}

/** Streaming chunk choice */
export interface StreamChoice {
  index: number
  delta: StreamDelta
  finish_reason: string | null
}

/** Streaming response chunk */
export interface StreamChunk {
  id?: string
  object?: string
  created?: number
  model?: string
  choices: StreamChoice[]
}

/** Error response from API */
export interface APIError {
  error: {
    message: string
    type: string
    code?: string
  }
}

/** Streaming event handlers */
export interface StreamCallbacks {
  /** Called when a new content token is received */
  onToken: (token: string) => void
  /** Called when streaming completes successfully */
  onComplete: (fullContent: string) => void
  /** Called on error */
  onError: (error: Error) => void
  /** Called with the request ID if available */
  onRequestId?: (requestId: string) => void
}

/** Model configuration for UI */
export interface ModelConfig {
  id: string
  name: string
  description?: string
  supportsWebSearch?: boolean
}

/** Web search presets */
export type SearchPreset = 'standard' | 'deep'

/** Web search preset configuration */
export interface SearchPresetConfig {
  id: SearchPreset
  name: string
  suffix: string
  description: string
}

// ============ Constants ============

/** Default NanoGPT API base URL */
export const NANOGPT_BASE_URL = 'https://nano-gpt.com/api/v1'

/** Default model for new conversations */
export const DEFAULT_MODEL = 'chatgpt-4o-latest'

/** Available models (can be extended) */
export const AVAILABLE_MODELS: ModelConfig[] = [
  { id: 'chatgpt-4o-latest', name: 'GPT-4o', description: 'Latest GPT-4o', supportsWebSearch: true },
  { id: 'gpt-4.1', name: 'GPT-4.1', description: 'GPT-4.1', supportsWebSearch: true },
  { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', description: 'Faster, cheaper GPT-4.1', supportsWebSearch: true },
  { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano', description: 'Fastest GPT-4.1', supportsWebSearch: true },
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', description: 'Anthropic Claude Sonnet 4', supportsWebSearch: true },
  { id: 'claude-3-7-sonnet-20250219', name: 'Claude 3.7 Sonnet', description: 'Claude 3.7 Sonnet', supportsWebSearch: true },
  { id: 'gemini-2.5-pro-preview-05-06', name: 'Gemini 2.5 Pro', description: 'Google Gemini 2.5 Pro', supportsWebSearch: true },
  { id: 'gemini-2.5-flash-preview-05-20', name: 'Gemini 2.5 Flash', description: 'Fast Gemini model', supportsWebSearch: true },
  { id: 'deepseek-chat', name: 'DeepSeek Chat', description: 'DeepSeek V3', supportsWebSearch: true },
  { id: 'deepseek-reasoner', name: 'DeepSeek R1', description: 'DeepSeek reasoning model', supportsWebSearch: true },
]

/** Web search presets */
export const SEARCH_PRESETS: SearchPresetConfig[] = [
  { id: 'standard', name: 'Standard', suffix: ':online', description: 'Basic web search' },
  { id: 'deep', name: 'Deep', suffix: ':online/linkup-deep', description: 'Comprehensive deep search' },
]

// ============ Helpers ============

/**
 * Build the effective model string with optional web search suffix
 */
export function buildEffectiveModel(
  baseModel: string,
  webSearchEnabled: boolean,
  searchPreset: SearchPreset = 'standard'
): string {
  if (!webSearchEnabled) {
    return baseModel
  }
  const preset = SEARCH_PRESETS.find(p => p.id === searchPreset) ?? SEARCH_PRESETS[0]
  return `${baseModel}${preset?.suffix ?? ':online'}`
}

/**
 * Convert Bonsai Message[] to NanoGPT message format
 */
export function messagesToNanoGPTFormat(messages: Message[]): NanoGPTMessage[] {
  return messages.map(msg => ({
    role: msg.role,
    content: msg.content,
  }))
}

/**
 * Build the full request payload for NanoGPT chat completions
 */
export function buildChatCompletionPayload(
  messages: NanoGPTMessage[],
  model: string,
  stream: boolean = true
): ChatCompletionRequest {
  return {
    model,
    messages,
    stream,
  }
}

// ============ SSE Parser ============

/**
 * Parse a single SSE data line into a StreamChunk
 * Returns null for non-data lines, [DONE], or malformed data
 */
export function parseSSELine(line: string): StreamChunk | null {
  // Skip empty lines and comments
  if (!line || line.startsWith(':')) {
    return null
  }

  // Handle data: prefix
  if (!line.startsWith('data:')) {
    return null
  }

  // Extract JSON after "data:" prefix
  const jsonStr = line.slice(5).trim()
  
  // Check for stream end marker
  if (jsonStr === '[DONE]') {
    return null
  }

  try {
    const parsed = JSON.parse(jsonStr) as StreamChunk
    return parsed
  } catch {
    // Silently ignore malformed JSON (as per spec)
    return null
  }
}

/**
 * Extract content from a stream chunk
 */
export function extractContentFromChunk(chunk: StreamChunk): string {
  return chunk.choices?.[0]?.delta?.content ?? ''
}

// ============ API Client ============

/**
 * NanoGPT API Client class
 */
export class NanoGPTClient {
  private baseUrl: string
  private apiKey: string

  constructor(apiKey: string, baseUrl: string = NANOGPT_BASE_URL) {
    this.apiKey = apiKey
    this.baseUrl = baseUrl
  }

  /**
   * Create a streaming chat completion
   * Returns an AbortController that can be used to cancel the request
   */
  async streamChatCompletion(
    payload: ChatCompletionRequest,
    callbacks: StreamCallbacks
  ): Promise<AbortController> {
    const abortController = new AbortController()
    
    // Start streaming in background
    this.doStreamRequest(payload, callbacks, abortController.signal)
      .catch(err => {
        if (err.name !== 'AbortError') {
          callbacks.onError(err)
        }
      })
    
    return abortController
  }

  private async doStreamRequest(
    payload: ChatCompletionRequest,
    callbacks: StreamCallbacks,
    signal: AbortSignal
  ): Promise<void> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify({ ...payload, stream: true }),
      signal,
    })

    // Handle HTTP errors
    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`
      try {
        const errorBody = await response.json() as APIError
        errorMessage = errorBody.error?.message ?? errorMessage
      } catch {
        // Ignore JSON parse errors for error response
      }
      
      // Special handling for auth errors (401 Unauthorized, 403 Forbidden)
      if (response.status === 401 || response.status === 403) {
        throw new AuthenticationError(errorMessage, response.status)
      }
      throw new Error(errorMessage)
    }

    // Extract request ID if present in headers
    const requestId = response.headers.get('x-request-id')
    if (requestId && callbacks.onRequestId) {
      callbacks.onRequestId(requestId)
    }

    // Read the stream
    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('Response body is not readable')
    }

    const decoder = new TextDecoder()
    let fullContent = ''
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        // Decode chunk and add to buffer
        buffer += decoder.decode(value, { stream: true })
        
        // Process complete lines
        const lines = buffer.split('\n')
        // Keep the last potentially incomplete line in buffer
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const chunk = parseSSELine(line)
          if (chunk) {
            const content = extractContentFromChunk(chunk)
            if (content) {
              fullContent += content
              callbacks.onToken(content)
            }
          }
        }
      }

      // Process any remaining buffer
      if (buffer) {
        const chunk = parseSSELine(buffer)
        if (chunk) {
          const content = extractContentFromChunk(chunk)
          if (content) {
            fullContent += content
            callbacks.onToken(content)
          }
        }
      }

      callbacks.onComplete(fullContent)
    } finally {
      reader.releaseLock()
    }
  }
}

/**
 * Custom error for authentication failures (401/403)
 */
export class AuthenticationError extends Error {
  /** HTTP status code (401 or 403) */
  readonly status: number

  constructor(message: string, status: number = 401) {
    super(message)
    this.name = 'AuthenticationError'
    this.status = status
  }
}
