/**
 * Tree Operations
 * 
 * DB-integrated tree operations that combine pure tree utilities
 * with repository functions. These are the high-level operations
 * that application code should typically use.
 */

import type { BonsaiDatabase } from './database';
import { db as defaultDb, nowISO } from './database';
import type { Message, MessageRole, CreateMessageInput } from './types';
import * as messageRepo from './repositories/messageRepository';
import * as revisionRepo from './repositories/messageRevisionRepository';
import * as contextConfigRepo from './repositories/promptContextConfigRepository';
import * as treeUtils from './treeUtils';

/**
 * Options for creating a branch
 */
export interface CreateBranchOptions {
  /** Parent message to branch from */
  fromMessageId: string;
  /** Content for the new branch root message */
  content: string;
  /** Role of the new message (defaults to 'user') */
  role?: MessageRole;
  /** Optional title for the branch */
  branchTitle?: string;
  /** If this is a variant of an existing message, reference it here */
  variantOfMessageId?: string;
  /** Additional metadata */
  metadata?: {
    /** Conversation ID (required if not inferrable) */
    conversationId?: string;
  };
}

/**
 * Result of branch creation
 */
export interface CreateBranchResult {
  /** The newly created message (branch root) */
  message: Message;
  /** The parent message branched from */
  parent: Message;
}

/**
 * Create a new branch from an existing message
 * This is the primary branching operation - creates a new child message
 * that serves as the root of a new branch.
 * 
 * @param options - Branch creation options
 * @param database - Database instance (defaults to main db)
 * @returns The created branch result or throws on error
 */
export async function createBranch(
  options: CreateBranchOptions,
  database: BonsaiDatabase = defaultDb
): Promise<CreateBranchResult> {
  const parent = await messageRepo.getMessage(options.fromMessageId, database);
  if (!parent) {
    throw new Error(`Parent message not found: ${options.fromMessageId}`);
  }

  const input: CreateMessageInput = {
    conversationId: options.metadata?.conversationId ?? parent.conversationId,
    parentId: options.fromMessageId,
    role: options.role ?? 'user',
    content: options.content,
    branchTitle: options.branchTitle,
    variantOfMessageId: options.variantOfMessageId,
  };

  const message = await messageRepo.createMessage(input, database);

  return { message, parent };
}

/**
 * Options for creating a variant message (edit-as-branch)
 */
export interface CreateVariantOptions {
  /** The original message this is a variant of */
  originalMessageId: string;
  /** New content for the variant */
  content: string;
  /** Optional branch title */
  branchTitle?: string;
}

/**
 * Create a variant message (for edit-as-branch / Option B semantics)
 * 
 * A variant is a new message that:
 * 1. Has the same parent as the original
 * 2. Has variantOfMessageId pointing to the original
 * 3. Is a sibling of the original, creating a new branch
 * 
 * This implements "Option B" from the edit rules: keep existing future
 * messages and create a new branch from the edited message.
 */
export async function createVariant(
  options: CreateVariantOptions,
  database: BonsaiDatabase = defaultDb
): Promise<Message> {
  const original = await messageRepo.getMessage(options.originalMessageId, database);
  if (!original) {
    throw new Error(`Original message not found: ${options.originalMessageId}`);
  }

  const input: CreateMessageInput = {
    conversationId: original.conversationId,
    parentId: original.parentId, // Same parent as original = sibling
    role: original.role,
    content: options.content,
    branchTitle: options.branchTitle ?? `Edit of message`,
    variantOfMessageId: options.originalMessageId,
  };

  return messageRepo.createMessage(input, database);
}

/**
 * Options for editing a message in place
 */
export interface EditInPlaceOptions {
  /** Message ID to edit */
  messageId: string;
  /** New content */
  newContent: string;
  /** Reason for the edit (stored in revision) */
  reason?: string;
}

/**
 * Edit a message in place, recording the previous content as a revision.
 * 
 * This implements "Option A" semantics for messages WITHOUT descendants,
 * or for any in-place edit where we want to preserve history.
 * 
 * Note: Caller should check hasDescendants() first if Option A/B prompt is needed.
 */
export async function editMessageInPlace(
  options: EditInPlaceOptions,
  database: BonsaiDatabase = defaultDb
): Promise<Message> {
  const message = await messageRepo.getMessage(options.messageId, database);
  if (!message) {
    throw new Error(`Message not found: ${options.messageId}`);
  }

  // Record the revision before editing
  await revisionRepo.createMessageRevision(
    {
      messageId: options.messageId,
      previousContent: message.content,
      reason: options.reason,
    },
    database
  );

  // Update the message
  const updated = await messageRepo.updateMessage(
    options.messageId,
    { content: options.newContent },
    database
  );

  if (!updated) {
    throw new Error(`Failed to update message: ${options.messageId}`);
  }

  return updated;
}

/**
 * Result of subtree deletion
 */
export interface DeleteSubtreeResult {
  /** Number of messages deleted */
  deletedCount: number;
  /** IDs of deleted messages */
  deletedIds: string[];
}

/**
 * Delete a message and all its descendants (hard delete)
 * Also cleans up related revisions and context configs.
 * 
 * @param messageId - Root of subtree to delete
 * @param database - Database instance
 * @returns Deletion result
 */
export async function deleteSubtree(
  messageId: string,
  database: BonsaiDatabase = defaultDb
): Promise<DeleteSubtreeResult> {
  // Get all messages in the conversation to build the tree
  const message = await messageRepo.getMessage(messageId, database);
  if (!message) {
    return { deletedCount: 0, deletedIds: [] };
  }

  const messageMap = await messageRepo.getMessageMap(message.conversationId, true, database);
  const idsToDelete = treeUtils.getSubtreeIds(messageId, messageMap);

  if (idsToDelete.length === 0) {
    return { deletedCount: 0, deletedIds: [] };
  }

  // Delete in a transaction
  await database.transaction(
    'rw',
    [database.messages, database.messageRevisions, database.promptContextConfigs],
    async () => {
      // Delete revisions for all messages
      for (const id of idsToDelete) {
        await revisionRepo.deleteRevisionsByMessage(id, database);
        await contextConfigRepo.deletePromptContextConfig(id, database);
      }

      // Delete messages
      await database.messages.bulkDelete(idsToDelete);
    }
  );

  return { deletedCount: idsToDelete.length, deletedIds: idsToDelete };
}

/**
 * Soft delete a message and all its descendants
 * Sets deletedAt timestamp instead of removing from database.
 * 
 * @param messageId - Root of subtree to soft delete
 * @param database - Database instance
 * @returns Number of messages soft-deleted
 */
export async function softDeleteSubtree(
  messageId: string,
  database: BonsaiDatabase = defaultDb
): Promise<number> {
  const message = await messageRepo.getMessage(messageId, database);
  if (!message) {
    return 0;
  }

  const messageMap = await messageRepo.getMessageMap(message.conversationId, true, database);
  const idsToDelete = treeUtils.getSubtreeIds(messageId, messageMap);
  const now = nowISO();

  await database.transaction('rw', database.messages, async () => {
    for (const id of idsToDelete) {
      await database.messages.update(id, { deletedAt: now, updatedAt: now });
    }
  });

  return idsToDelete.length;
}

/**
 * Get the path from root to a message (the default context)
 * 
 * @param messageId - Target message
 * @param database - Database instance
 * @returns Array of messages from root to target
 */
export async function getPathToMessage(
  messageId: string,
  database: BonsaiDatabase = defaultDb
): Promise<Message[]> {
  const message = await messageRepo.getMessage(messageId, database);
  if (!message) {
    return [];
  }

  const messageMap = await messageRepo.getMessageMap(message.conversationId, false, database);
  return treeUtils.getPathToRoot(messageId, messageMap);
}

/**
 * Get ancestors of a message
 * 
 * @param messageId - Target message
 * @param database - Database instance
 * @returns Array of ancestors from parent to root
 */
export async function getAncestors(
  messageId: string,
  database: BonsaiDatabase = defaultDb
): Promise<Message[]> {
  const message = await messageRepo.getMessage(messageId, database);
  if (!message) {
    return [];
  }

  const messageMap = await messageRepo.getMessageMap(message.conversationId, false, database);
  return treeUtils.getAncestors(messageId, messageMap);
}

/**
 * Get all descendants of a message
 * 
 * @param messageId - Root message
 * @param database - Database instance
 * @returns Array of all descendant messages
 */
export async function getDescendants(
  messageId: string,
  database: BonsaiDatabase = defaultDb
): Promise<Message[]> {
  const message = await messageRepo.getMessage(messageId, database);
  if (!message) {
    return [];
  }

  const messageMap = await messageRepo.getMessageMap(message.conversationId, false, database);
  return treeUtils.getDescendants(messageId, messageMap);
}

/**
 * Check if a message has descendants
 * 
 * @param messageId - Message to check
 * @param database - Database instance
 * @returns true if message has children
 */
export async function hasDescendants(
  messageId: string,
  database: BonsaiDatabase = defaultDb
): Promise<boolean> {
  return messageRepo.hasChildren(messageId, database);
}

/**
 * Get all variants of a message
 * 
 * @param messageId - Original message
 * @param database - Database instance
 * @returns Array of variant messages
 */
export async function getVariants(
  messageId: string,
  database: BonsaiDatabase = defaultDb
): Promise<Message[]> {
  return messageRepo.getVariants(messageId, false, database);
}

/**
 * Seed data for development/testing
 */
export interface SeedDataOptions {
  conversationTitle?: string;
  messageCount?: number;
  branchCount?: number;
}

/**
 * Create seed data for development/debugging
 * Creates a conversation with a branching message tree.
 * 
 * @param options - Seed options
 * @param database - Database instance
 * @returns Created conversation ID
 */
export async function createSeedData(
  options: SeedDataOptions = {},
  database: BonsaiDatabase = defaultDb
): Promise<string> {
  const { conversationTitle = 'Seed Conversation', messageCount = 5, branchCount = 2 } = options;

  // Import conversation repo here to avoid circular deps
  const { createConversation } = await import('./repositories/conversationRepository');

  // Create conversation
  const conversation = await createConversation({ title: conversationTitle }, database);

  // Create root message (system)
  const root = await messageRepo.createMessage(
    {
      conversationId: conversation.id,
      parentId: null,
      role: 'system',
      content: 'You are a helpful assistant.',
    },
    database
  );

  // Create a chain of user/assistant messages
  let currentParentId = root.id;
  const messageIds: string[] = [root.id];

  for (let i = 0; i < messageCount; i++) {
    const isUser = i % 2 === 0;
    const msg = await messageRepo.createMessage(
      {
        conversationId: conversation.id,
        parentId: currentParentId,
        role: isUser ? 'user' : 'assistant',
        content: isUser ? `User message ${Math.floor(i / 2) + 1}` : `Assistant response ${Math.floor(i / 2) + 1}`,
      },
      database
    );
    messageIds.push(msg.id);
    currentParentId = msg.id;
  }

  // Create branches
  for (let b = 0; b < branchCount && messageIds.length > 2; b++) {
    // Branch from a random point (not the last message)
    const branchPointIndex = Math.floor(Math.random() * (messageIds.length - 2)) + 1;
    const branchPointId = messageIds[branchPointIndex];

    if (branchPointId) {
      await createBranch(
        {
          fromMessageId: branchPointId,
          content: `Branch ${b + 1} message`,
          branchTitle: `Branch ${b + 1}`,
        },
        database
      );
    }
  }

  return conversation.id;
}
