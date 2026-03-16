/**
 * Context Resolver
 * 
 * Pure functions for resolving the final context (list of messages)
 * that will be sent to the model based on:
 * - The active path (root → active message)
 * - Optional start anchor (truncate path)
 * - Excluded message IDs
 * - Pinned message IDs from anywhere in the tree
 * 
 * Default ordering: PATH_THEN_PINS
 * - Path messages come first (after truncation/exclusions)
 * - Pinned messages come after (sorted by createdAt, then id)
 */

import type { Message } from './types';
import { getPathToRoot } from './treeUtils';

/**
 * Configuration for context resolution
 */
export interface ContextResolverConfig {
  /** If set, start the path from this message (must be on the path) */
  startFromMessageId: string | null;
  /** Message IDs to exclude from the path */
  excludedMessageIds: string[];
  /** Message IDs to pin (include from anywhere) */
  pinnedMessageIds: string[];
}

/**
 * A saved context preset — a named snapshot of context configuration
 * that can be loaded/restored later. Stored per-conversation in uiState.
 */
export interface ContextPreset {
  /** Unique identifier (UUID) */
  id: string;
  /** User-defined name (e.g., "UI/UX Focus") */
  name: string;
  /** The context configuration snapshot */
  config: ContextResolverConfig;
  /** When the preset was created (ISO 8601) */
  createdAt: string;
}

/**
 * Result of context resolution
 */
export interface ResolvedContext {
  /** Messages included via the branch path (after truncation/exclusions) */
  pathMessages: Message[];
  /** Messages pinned from elsewhere (not on path, deduplicated) */
  pinnedMessages: Message[];
  /** Final ordered list of all context messages (path + pins) */
  resolvedMessages: Message[];
  /** IDs only, for storage */
  resolvedMessageIds: string[];
  /** Warnings about potential issues */
  warnings: ContextWarning[];
  /** Pinned IDs that no longer exist in the conversation (for cleanup) */
  stalePinnedIds: string[];
}

/**
 * Warning types for context resolution
 */
export type ContextWarningType =
  | 'ANCHOR_NOT_ON_PATH'
  | 'ASSISTANT_WITHOUT_USER';

export interface ContextWarning {
  type: ContextWarningType;
  message: string;
  relatedMessageId?: string;
}

/**
 * Resolve the context for a message based on configuration
 * 
 * Algorithm (PATH_THEN_PINS ordering):
 * 1. Build path from root → activeMessageId
 * 2. If startFromMessageId is set and on path, truncate to start there
 * 3. Remove excluded messages from path
 * 4. Build pinned list, removing any that are already in the path
 * 5. Sort pins by createdAt ascending, then id ascending
 * 6. Final context = path + pins
 * 
 * @param activeMessageId - The current cursor position in the tree
 * @param messageMap - Map of all messages in the conversation
 * @param config - Context configuration (anchor, exclusions, pins)
 * @returns Resolved context with messages and warnings
 */
export function resolveContext(
  activeMessageId: string,
  messageMap: Map<string, Message>,
  config: ContextResolverConfig
): ResolvedContext {
  const warnings: ContextWarning[] = [];
  const stalePinnedIds: string[] = [];

  // Step 1: Build full path from root to active message
  let path = getPathToRoot(activeMessageId, messageMap);
  // pathIdSet reserved for future pinned-message validation
  
  // Step 2: Apply start anchor (truncate path)
  if (config.startFromMessageId) {
    const anchorIndex = path.findIndex(m => m.id === config.startFromMessageId);
    if (anchorIndex === -1) {
      // Anchor not on path - warn and ignore
      warnings.push({
        type: 'ANCHOR_NOT_ON_PATH',
        message: `Start anchor message is not on the current path. Ignoring anchor.`,
        relatedMessageId: config.startFromMessageId,
      });
    } else {
      // Truncate: keep from anchor to end
      path = path.slice(anchorIndex);
    }
  }
  
  // Step 3: Apply exclusions
  const excludedSet = new Set(config.excludedMessageIds);
  path = path.filter(m => !excludedSet.has(m.id));
  
  // Step 4: Build pinned list (deduplicate against path)
  const pathIdSetAfterExclusions = new Set(path.map(m => m.id));
  const pinnedMessages: Message[] = [];
  
  for (const pinnedId of config.pinnedMessageIds) {
    // Skip if already in path
    if (pathIdSetAfterExclusions.has(pinnedId)) {
      continue;
    }
    
    const pinnedMessage = messageMap.get(pinnedId);
    if (!pinnedMessage) {
      stalePinnedIds.push(pinnedId);
      continue;
    }
    
    pinnedMessages.push(pinnedMessage);
  }
  
  // Step 5: Sort pinned messages by createdAt ascending, then id ascending
  pinnedMessages.sort((a, b) => {
    const dateCompare = a.createdAt.localeCompare(b.createdAt);
    if (dateCompare !== 0) return dateCompare;
    return a.id.localeCompare(b.id);
  });
  
  // Step 6: Check for coherence warnings
  // Warn if an assistant message is included but its preceding user message is excluded
  const finalMessages = [...path, ...pinnedMessages];
  const finalIdSet = new Set(finalMessages.map(m => m.id));
  
  for (const msg of finalMessages) {
    if (msg.role === 'assistant' && msg.parentId) {
      const parent = messageMap.get(msg.parentId);
      if (parent && parent.role === 'user' && !finalIdSet.has(parent.id)) {
        warnings.push({
          type: 'ASSISTANT_WITHOUT_USER',
          message: `Assistant message included but its preceding user message is excluded. This may affect coherence.`,
          relatedMessageId: msg.id,
        });
      }
    }
  }
  
  return {
    pathMessages: path,
    pinnedMessages,
    resolvedMessages: finalMessages,
    resolvedMessageIds: finalMessages.map(m => m.id),
    warnings,
    stalePinnedIds,
  };
}

/**
 * Create a default context config
 */
export function createDefaultContextConfig(): ContextResolverConfig {
  return {
    startFromMessageId: null,
    excludedMessageIds: [],
    pinnedMessageIds: [],
  };
}

/**
 * Check if a message is on the path from root to target
 */
export function isMessageOnPath(
  messageId: string,
  targetMessageId: string,
  messageMap: Map<string, Message>
): boolean {
  const path = getPathToRoot(targetMessageId, messageMap);
  return path.some(m => m.id === messageId);
}

/**
 * Search messages by content (basic substring match)
 * Used for the pin picker search functionality
 * 
 * @param query - Search string (case-insensitive)
 * @param messageMap - Map of all messages
 * @param limit - Maximum results to return
 * @returns Matching messages sorted by createdAt desc (newest first)
 */
export function searchMessages(
  query: string,
  messageMap: Map<string, Message>,
  limit: number = 20
): Message[] {
  if (!query.trim()) return [];
  
  const normalizedQuery = query.toLowerCase();
  const results: Message[] = [];
  
  for (const message of messageMap.values()) {
    if (message.content.toLowerCase().includes(normalizedQuery)) {
      results.push(message);
    }
  }
  
  // Sort by createdAt descending (newest first)
  results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  
  return results.slice(0, limit);
}
