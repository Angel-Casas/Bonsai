/**
 * Pure Tree Utilities
 * 
 * Framework-agnostic pure functions for tree operations on the message tree.
 * These functions operate on Maps/arrays of messages without direct DB access,
 * making them easy to test and reuse.
 * 
 * For DB-integrated operations, see treeOperations.ts
 */

import type { Message } from './types';

/**
 * Result type for tree operations that may fail
 */
export type TreeResult<T> = { success: true; data: T } | { success: false; error: string };

/**
 * Get all ancestors of a message, from immediate parent to root
 * Returns messages in order: [parent, grandparent, ..., root]
 * 
 * @param messageId - The message to get ancestors for
 * @param messageMap - Map of all messages in the conversation
 * @returns Array of ancestor messages, ordered from parent to root
 */
export function getAncestors(messageId: string, messageMap: Map<string, Message>): Message[] {
  const ancestors: Message[] = [];
  let current = messageMap.get(messageId);

  if (!current) {
    return ancestors;
  }

  while (current.parentId !== null) {
    const parent = messageMap.get(current.parentId);
    if (!parent) {
      // Orphaned message - parent doesn't exist
      break;
    }
    ancestors.push(parent);
    current = parent;
  }

  return ancestors;
}

/**
 * Get the path from root to a message (inclusive)
 * Returns messages in chronological order: [root, ..., grandparent, parent, message]
 * This is the "default context" path for a message.
 * 
 * @param messageId - The target message
 * @param messageMap - Map of all messages in the conversation
 * @returns Array of messages from root to target, or empty if message not found
 */
export function getPathToRoot(messageId: string, messageMap: Map<string, Message>): Message[] {
  const message = messageMap.get(messageId);
  if (!message) {
    return [];
  }

  const ancestors = getAncestors(messageId, messageMap);
  // Reverse to get root-to-message order, then add the message itself
  return [...ancestors.reverse(), message];
}

/**
 * Get all descendants of a message (the entire subtree)
 * Uses BFS for level-order traversal
 * 
 * @param messageId - The root of the subtree
 * @param messageMap - Map of all messages in the conversation
 * @returns Array of all descendant messages (not including the root)
 */
export function getDescendants(messageId: string, messageMap: Map<string, Message>): Message[] {
  const descendants: Message[] = [];
  const queue: string[] = [messageId];

  // Build a children lookup for efficiency
  const childrenMap = buildChildrenMap(messageMap);

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const children = childrenMap.get(currentId) ?? [];

    for (const child of children) {
      descendants.push(child);
      queue.push(child.id);
    }
  }

  return descendants;
}

/**
 * Get the entire subtree including the root message
 * 
 * @param messageId - The root of the subtree
 * @param messageMap - Map of all messages in the conversation
 * @returns Array including root and all descendants, or empty if root not found
 */
export function getSubtree(messageId: string, messageMap: Map<string, Message>): Message[] {
  const root = messageMap.get(messageId);
  if (!root) {
    return [];
  }

  return [root, ...getDescendants(messageId, messageMap)];
}

/**
 * Build a map of parent ID to children for efficient lookups
 */
export function buildChildrenMap(messageMap: Map<string, Message>): Map<string, Message[]> {
  const childrenMap = new Map<string, Message[]>();

  for (const message of messageMap.values()) {
    if (message.parentId !== null) {
      const siblings = childrenMap.get(message.parentId) ?? [];
      siblings.push(message);
      childrenMap.set(message.parentId, siblings);
    }
  }

  // Sort children by createdAt for consistent ordering
  for (const [, children] of childrenMap) {
    children.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  return childrenMap;
}

/**
 * Get direct children of a message
 */
export function getChildren(messageId: string, messageMap: Map<string, Message>): Message[] {
  const children: Message[] = [];

  for (const message of messageMap.values()) {
    if (message.parentId === messageId) {
      children.push(message);
    }
  }

  // Sort by createdAt for consistent ordering
  return children.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Check if a message has any children
 */
export function hasChildren(messageId: string, messageMap: Map<string, Message>): boolean {
  for (const message of messageMap.values()) {
    if (message.parentId === messageId) {
      return true;
    }
  }
  return false;
}

/**
 * Get IDs for subtree deletion
 * Returns all IDs that would need to be deleted (root + all descendants)
 * 
 * @param messageId - Root of subtree to delete
 * @param messageMap - Map of all messages
 * @returns Array of message IDs to delete
 */
export function getSubtreeIds(messageId: string, messageMap: Map<string, Message>): string[] {
  const subtree = getSubtree(messageId, messageMap);
  return subtree.map((m) => m.id);
}

/**
 * Validate that a message can be created as a child of a parent
 * Checks for:
 * - Parent exists (if parentId provided)
 * - No circular references
 * 
 * @param parentId - The proposed parent ID (null for root)
 * @param messageMap - Map of existing messages
 * @returns Validation result
 */
export function validateParent(
  parentId: string | null,
  messageMap: Map<string, Message>
): TreeResult<void> {
  if (parentId === null) {
    return { success: true, data: undefined };
  }

  const parent = messageMap.get(parentId);
  if (!parent) {
    return { success: false, error: `Parent message not found: ${parentId}` };
  }

  return { success: true, data: undefined };
}

/**
 * Get siblings of a message (other children of the same parent)
 * Does not include the message itself
 */
export function getSiblings(messageId: string, messageMap: Map<string, Message>): Message[] {
  const message = messageMap.get(messageId);
  if (!message) {
    return [];
  }

  const siblings: Message[] = [];
  for (const m of messageMap.values()) {
    if (m.parentId === message.parentId && m.id !== messageId) {
      siblings.push(m);
    }
  }

  return siblings.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Get the depth of a message in the tree (0 = root)
 */
export function getDepth(messageId: string, messageMap: Map<string, Message>): number {
  return getAncestors(messageId, messageMap).length;
}

/**
 * Check if a message is an ancestor of another
 */
export function isAncestor(
  potentialAncestorId: string,
  messageId: string,
  messageMap: Map<string, Message>
): boolean {
  const ancestors = getAncestors(messageId, messageMap);
  return ancestors.some((a) => a.id === potentialAncestorId);
}

/**
 * Check if a message is a descendant of another
 */
export function isDescendant(
  potentialDescendantId: string,
  messageId: string,
  messageMap: Map<string, Message>
): boolean {
  const descendants = getDescendants(messageId, messageMap);
  return descendants.some((d) => d.id === potentialDescendantId);
}

/**
 * Get all root messages (messages with no parent)
 */
export function getRoots(messageMap: Map<string, Message>): Message[] {
  const roots: Message[] = [];

  for (const message of messageMap.values()) {
    if (message.parentId === null) {
      roots.push(message);
    }
  }

  return roots.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Get all leaf messages (messages with no children)
 */
export function getLeaves(messageMap: Map<string, Message>): Message[] {
  const childrenMap = buildChildrenMap(messageMap);
  const leaves: Message[] = [];

  for (const message of messageMap.values()) {
    if (!childrenMap.has(message.id)) {
      leaves.push(message);
    }
  }

  return leaves.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Find all branch points (messages with more than one child)
 */
export function getBranchPoints(messageMap: Map<string, Message>): Message[] {
  const childrenMap = buildChildrenMap(messageMap);
  const branchPoints: Message[] = [];

  for (const [parentId, children] of childrenMap) {
    if (children.length > 1) {
      const parent = messageMap.get(parentId);
      if (parent) {
        branchPoints.push(parent);
      }
    }
  }

  return branchPoints.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Get variants of a message (other messages with variantOfMessageId pointing to same original)
 */
export function getVariantsOf(
  messageId: string,
  messageMap: Map<string, Message>
): Message[] {
  const variants: Message[] = [];

  for (const message of messageMap.values()) {
    if (message.variantOfMessageId === messageId) {
      variants.push(message);
    }
  }

  return variants.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Check if a message is a variant of another
 */
export function isVariantOf(message: Message, originalId: string): boolean {
  return message.variantOfMessageId === originalId;
}

/**
 * Get the original message that a variant is based on
 */
export function getOriginalOfVariant(
  variantId: string,
  messageMap: Map<string, Message>
): Message | undefined {
  const variant = messageMap.get(variantId);
  if (!variant?.variantOfMessageId) {
    return undefined;
  }

  return messageMap.get(variant.variantOfMessageId);
}

/**
 * Get the main branch descendants of a message
 * Follows the main branch (child without branchTitle) until reaching a leaf node
 * or a point where all children are explicit branches.
 *
 * @param messageId - The starting message ID
 * @param messageMap - Map of all messages in the conversation
 * @returns Array of messages along the main branch (not including the starting message)
 */
export function getMainBranchDescendants(
  messageId: string,
  messageMap: Map<string, Message>
): Message[] {
  const descendants: Message[] = [];
  const childrenMap = buildChildrenMap(messageMap);

  let currentId: string | null = messageId;

  while (currentId) {
    const children: Message[] = childrenMap.get(currentId) ?? [];
    if (children.length === 0) break;

    // Find the main branch child (without branchTitle)
    // If all children have branchTitle, stop - they are all explicit sub-branches
    // that the user should select separately in the tree
    const mainChild: Message | undefined = children.find((c: Message) => !c.branchTitle);
    if (!mainChild) {
      // All children are explicit branches - stop here
      break;
    }

    descendants.push(mainChild);
    currentId = mainChild.id;
  }

  return descendants;
}

/**
 * Get the full timeline: path from root to message, plus main branch descendants
 * This shows the complete conversation path through the selected message.
 *
 * @param messageId - The active/selected message ID
 * @param messageMap - Map of all messages in the conversation
 * @returns Array of messages from root to leaf (through the selected message)
 */
export function getFullBranchTimeline(
  messageId: string,
  messageMap: Map<string, Message>
): Message[] {
  const pathToRoot = getPathToRoot(messageId, messageMap);
  const descendants = getMainBranchDescendants(messageId, messageMap);
  return [...pathToRoot, ...descendants];
}
