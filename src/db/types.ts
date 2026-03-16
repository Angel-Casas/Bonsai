/**
 * Data model types for Bonsai PWA
 * These types define the core data structures stored in IndexedDB
 */

/** Encrypted data structure (ciphertext + IV) */
export interface EncryptedField {
  /** Base64-encoded ciphertext */
  ciphertext: string;
  /** Base64-encoded IV */
  iv: string;
}

/** Message role in conversation */
export type MessageRole = 'system' | 'user' | 'assistant';

/** Ordering mode for context assembly */
export type OrderingMode = 'PATH_THEN_PINS' | 'chronological' | 'custom';

/**
 * Conversation - A top-level container for a tree of messages
 */
export interface Conversation {
  /** Unique identifier (UUID) */
  id: string;
  /** Display title (plaintext when unencrypted, empty when encrypted) */
  title: string;
  /** Encrypted title (when encryption is enabled) */
  titleEnc?: EncryptedField | null;
  /** Creation timestamp (ISO 8601) */
  createdAt: string;
  /** Last update timestamp (ISO 8601) */
  updatedAt: string;
  /** Default model for new messages in this conversation */
  defaultModel?: string;
  /** Optional UI state (collapsed branches, scroll position, etc.) */
  uiState?: Record<string, unknown>;
}

/**
 * Message - A single message in the conversation tree
 * Messages form a tree structure via parentId references
 */
export interface Message {
  /** Unique identifier (UUID) */
  id: string;
  /** Parent conversation ID */
  conversationId: string;
  /** Parent message ID (null for root messages) */
  parentId: string | null;
  /** Message role */
  role: MessageRole;
  /** Message content (plaintext when unencrypted, empty when encrypted) */
  content: string;
  /** Encrypted content (when encryption is enabled) */
  contentEnc?: EncryptedField | null;
  /** Creation timestamp (ISO 8601) */
  createdAt: string;
  /** Last update timestamp (ISO 8601) */
  updatedAt: string;
  /** Optional branch title (for labeling branch roots) */
  branchTitle?: string;
  /** Encrypted branch title (when encryption is enabled) */
  branchTitleEnc?: EncryptedField | null;
  /** 
   * If this message is an "edited variant" of another message,
   * this points to the original message ID.
   * Used for "edit as branch" (Option B) semantics.
   */
  variantOfMessageId?: string;
  /** Soft delete timestamp (ISO 8601) - if set, message is considered deleted */
  deletedAt?: string;
  
  // --- Model tracking fields (Milestone 4) ---
  
  /** 
   * For user messages: the exact model string used for the request,
   * including any suffixes like :online for web search mode.
   */
  modelRequested?: string;
  /** Whether web search mode was enabled for this request */
  webSearchMode?: boolean;
  /** The search preset used (e.g., 'standard', 'deep') */
  searchPreset?: 'standard' | 'deep';
  
  /**
   * For assistant messages: the model that actually responded.
   * Usually same as modelRequested on the parent user message.
   */
  modelRespondedWith?: string;
  /** API request ID if returned by NanoGPT (for debugging/tracing) */
  requestId?: string;
  /** 
   * Streaming status for assistant messages:
   * - 'streaming': currently receiving tokens
   * - 'complete': finished successfully  
   * - 'error': failed with error
   * - 'aborted': user stopped generation
   */
  streamingStatus?: 'streaming' | 'complete' | 'error' | 'aborted';
  /** Error message if streaming failed */
  streamingError?: string;
}

/**
 * MessageRevision - Records previous content when a message is edited in place
 */
export interface MessageRevision {
  /** Unique identifier (UUID) */
  id: string;
  /** Message ID this revision belongs to */
  messageId: string;
  /** The previous content before edit (plaintext when unencrypted, empty when encrypted) */
  previousContent: string;
  /** Encrypted previous content (when encryption is enabled) */
  previousContentEnc?: EncryptedField | null;
  /** When the revision was created (edit occurred) */
  createdAt: string;
  /** Reason for the edit (optional, user-provided or system-generated) */
  reason?: string;
}

/**
 * PromptContextConfig - Context configuration for a user message
 * Defines what messages are included in the prompt context
 */
export interface PromptContextConfig {
  /** The user message ID this config belongs to */
  messageId: string;
  /** Whether to inherit the default path from root to this message (usually true) */
  inheritDefaultPath: boolean;
  /** 
   * If set, truncate the path to start from this message ID.
   * Must be on the current path; if not, it's ignored with a warning.
   */
  startFromMessageId: string | null;
  /** Message IDs to exclude from context (even if in default path) */
  excludedMessageIds: string[];
  /** Message IDs to include in context (even if not in default path) */
  pinnedMessageIds: string[];
  /** How to order messages in the final context */
  orderingMode: OrderingMode;
  /** 
   * Snapshot of resolved message IDs that were actually sent.
   * This is computed when the message is sent and stored for reference.
   */
  resolvedContextMessageIds: string[];
}

/**
 * Input types for creating new entities (omit auto-generated fields)
 */

export type CreateConversationInput = Omit<Conversation, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateConversationInput = Partial<Omit<Conversation, 'id' | 'createdAt'>>;

export type CreateMessageInput = Omit<Message, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateMessageInput = Partial<Omit<Message, 'id' | 'conversationId' | 'createdAt'>>;

export type CreateMessageRevisionInput = Omit<MessageRevision, 'id' | 'createdAt'>;

export type CreatePromptContextConfigInput = Omit<PromptContextConfig, 'resolvedContextMessageIds'> & {
  resolvedContextMessageIds?: string[];
};
export type UpdatePromptContextConfigInput = Partial<Omit<PromptContextConfig, 'messageId'>>;

// ============================================================================
// Sync Operations (Milestone 17)
// ============================================================================

/** Operation status for sync */
export type OpStatus = 'pending' | 'acked' | 'failed';

/** All supported operation types */
export type OpType =
  | 'conversation.create'
  | 'conversation.rename'
  | 'conversation.delete'
  | 'message.create'
  | 'message.edit'
  | 'message.deleteSubtree'
  | 'message.createVariant'
  | 'import.completed';

/**
 * SyncOp — A single operation in the append-only operations log.
 *
 * Canonical ordering: createdAt ASC, then id ASC (tie-breaker).
 */
export interface SyncOp {
  /** Unique identifier (UUID) */
  id: string;
  /** When the op was created (ISO 8601) */
  createdAt: string;
  /** Associated conversation (null for global ops like import) */
  conversationId: string | null;
  /** Operation type */
  type: OpType;
  /** JSON-serialized payload (plaintext; empty string when encrypted) */
  payload: string;
  /** Encrypted payload ciphertext (when encryption enabled) */
  payloadEnc?: { ciphertext: string; iv: string } | null;
  /** Sync status */
  status: OpStatus;
  /** Stable device/client identifier */
  clientId: string;
  /** Schema version of this op format (start at 1) */
  schemaVersion: number;
}
