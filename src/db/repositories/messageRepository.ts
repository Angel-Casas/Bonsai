/**
 * Message Repository
 * CRUD operations for Message entities + tree traversal helpers
 * 
 * Encryption Integration:
 * - All reads decrypt content if encryption is enabled and unlocked
 * - All writes encrypt content if encryption is enabled and unlocked
 * - Locked state returns placeholder content to prevent ciphertext leakage
 */

import type { BonsaiDatabase } from '../database';
import { db as defaultDb, generateId, nowISO } from '../database';
import type { Message, CreateMessageInput, UpdateMessageInput, EncryptedField } from '../types';
import {
  encryptContent,
  decryptContent,
  encryptOptionalField,
  decryptOptionalField,
} from '../encryption';

/**
 * Decrypt message fields for reading
 */
async function decryptMessage(message: Message): Promise<Message> {
  const decryptedContent = await decryptContent(message.content, message.contentEnc);
  const decryptedBranchTitle = await decryptOptionalField(message.branchTitle, message.branchTitleEnc);
  
  return {
    ...message,
    content: decryptedContent,
    branchTitle: decryptedBranchTitle,
  };
}

/**
 * Encrypt message fields for writing
 */
async function prepareMessageForStorage(
  content: string,
  branchTitle?: string
): Promise<{ content: string; contentEnc?: EncryptedField | null; branchTitle?: string; branchTitleEnc?: EncryptedField | null }> {
  const encryptedContent = await encryptContent(content);
  const encryptedBranchTitle = await encryptOptionalField(branchTitle);
  
  return {
    content: encryptedContent.content,
    contentEnc: encryptedContent.contentEnc ?? null,
    branchTitle: encryptedBranchTitle.value,
    branchTitleEnc: encryptedBranchTitle.valueEnc ?? null,
  };
}

/**
 * Create a new message
 */
export async function createMessage(
  input: CreateMessageInput,
  database: BonsaiDatabase = defaultDb
): Promise<Message> {
  const now = nowISO();
  const encryptedFields = await prepareMessageForStorage(input.content, input.branchTitle);
  
  const message: Message = {
    id: generateId(),
    conversationId: input.conversationId,
    parentId: input.parentId,
    role: input.role,
    content: encryptedFields.content,
    contentEnc: encryptedFields.contentEnc,
    createdAt: now,
    updatedAt: now,
    branchTitle: encryptedFields.branchTitle,
    branchTitleEnc: encryptedFields.branchTitleEnc,
    variantOfMessageId: input.variantOfMessageId,
    deletedAt: input.deletedAt,
  };

  await database.messages.add(message);
  
  // Return decrypted version to caller
  return decryptMessage(message);
}

// Import Dexie for minKey/maxKey
import Dexie from 'dexie';

/**
 * Get a message by ID (returns decrypted content)
 */
export async function getMessage(
  id: string,
  database: BonsaiDatabase = defaultDb
): Promise<Message | undefined> {
  const message = await database.messages.get(id);
  if (!message) return undefined;
  return decryptMessage(message);
}

/**
 * Get a message by ID without decryption (for internal/raw access)
 */
export async function getMessageRaw(
  id: string,
  database: BonsaiDatabase = defaultDb
): Promise<Message | undefined> {
  return database.messages.get(id);
}

/**
 * Decrypt multiple messages
 */
async function decryptMessages(messages: Message[]): Promise<Message[]> {
  return Promise.all(messages.map(decryptMessage));
}

/**
 * Get all messages in a conversation, ordered by createdAt
 * Excludes soft-deleted messages by default
 */
export async function getMessagesByConversation(
  conversationId: string,
  includeDeleted: boolean = false,
  database: BonsaiDatabase = defaultDb
): Promise<Message[]> {
  let messages = await database.messages
    .where('[conversationId+createdAt]')
    .between([conversationId, Dexie.minKey], [conversationId, Dexie.maxKey])
    .toArray();

  if (!includeDeleted) {
    messages = messages.filter((m) => !m.deletedAt);
  }

  return decryptMessages(messages);
}

/**
 * Get children of a message (direct descendants)
 * Excludes soft-deleted messages by default
 */
export async function getChildren(
  messageId: string,
  includeDeleted: boolean = false,
  database: BonsaiDatabase = defaultDb
): Promise<Message[]> {
  let children = await database.messages.where('parentId').equals(messageId).toArray();

  if (!includeDeleted) {
    children = children.filter((m) => !m.deletedAt);
  }

  // Sort by createdAt for consistent ordering
  const sorted = children.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return decryptMessages(sorted);
}

/**
 * Get root messages of a conversation (messages with no parent)
 * Excludes soft-deleted messages by default
 */
export async function getRootMessages(
  conversationId: string,
  includeDeleted: boolean = false,
  database: BonsaiDatabase = defaultDb
): Promise<Message[]> {
  // Query messages where parentId is null
  // Note: Dexie indexes null values, so we can query directly
  let messages = await database.messages
    .where('conversationId')
    .equals(conversationId)
    .filter((m) => m.parentId === null)
    .toArray();

  if (!includeDeleted) {
    messages = messages.filter((m) => !m.deletedAt);
  }

  // Sort by createdAt for consistent ordering
  const sorted = messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return decryptMessages(sorted);
}

/**
 * Update a message
 * Returns the updated message (decrypted) or undefined if not found
 */
export async function updateMessage(
  id: string,
  updates: UpdateMessageInput,
  database: BonsaiDatabase = defaultDb
): Promise<Message | undefined> {
  // If content or branchTitle is being updated, encrypt them
  const encryptedUpdates: UpdateMessageInput & { contentEnc?: EncryptedField | null; branchTitleEnc?: EncryptedField | null } = {
    ...updates,
    updatedAt: nowISO(),
  };
  
  if (updates.content !== undefined) {
    const encryptedContent = await encryptContent(updates.content);
    encryptedUpdates.content = encryptedContent.content;
    encryptedUpdates.contentEnc = encryptedContent.contentEnc ?? null;
  }
  
  if (updates.branchTitle !== undefined) {
    const encryptedBranchTitle = await encryptOptionalField(updates.branchTitle);
    encryptedUpdates.branchTitle = encryptedBranchTitle.value;
    encryptedUpdates.branchTitleEnc = encryptedBranchTitle.valueEnc ?? null;
  }

  const count = await database.messages.update(id, encryptedUpdates);
  if (count === 0) {
    return undefined;
  }

  const updated = await database.messages.get(id);
  if (!updated) return undefined;
  return decryptMessage(updated);
}

/**
 * Soft delete a message (set deletedAt timestamp)
 * Returns the updated message or undefined if not found
 */
export async function softDeleteMessage(
  id: string,
  database: BonsaiDatabase = defaultDb
): Promise<Message | undefined> {
  return updateMessage(id, { deletedAt: nowISO() }, database);
}

/**
 * Hard delete a message (permanent removal)
 * Does NOT delete children - use deleteSubtree for that
 * Returns true if deleted, false if not found
 */
export async function hardDeleteMessage(
  id: string,
  database: BonsaiDatabase = defaultDb
): Promise<boolean> {
  const count = await database.messages.where('id').equals(id).delete();
  return count > 0;
}

/**
 * Get all variant messages (messages that are variants of the given message)
 */
export async function getVariants(
  messageId: string,
  includeDeleted: boolean = false,
  database: BonsaiDatabase = defaultDb
): Promise<Message[]> {
  let variants = await database.messages.where('variantOfMessageId').equals(messageId).toArray();

  if (!includeDeleted) {
    variants = variants.filter((m) => !m.deletedAt);
  }

  const sorted = variants.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return decryptMessages(sorted);
}

/**
 * Count messages in a conversation
 */
export async function countMessages(
  conversationId: string,
  includeDeleted: boolean = false,
  database: BonsaiDatabase = defaultDb
): Promise<number> {
  if (includeDeleted) {
    return database.messages.where('conversationId').equals(conversationId).count();
  }

  return database.messages
    .where('conversationId')
    .equals(conversationId)
    .filter((m) => !m.deletedAt)
    .count();
}

/**
 * Check if a message has any children (including deleted ones)
 */
export async function hasChildren(
  messageId: string,
  database: BonsaiDatabase = defaultDb
): Promise<boolean> {
  const count = await database.messages.where('parentId').equals(messageId).count();
  return count > 0;
}

/**
 * Get all messages in a conversation as a map for efficient lookups
 * Useful for tree operations
 */
export async function getMessageMap(
  conversationId: string,
  includeDeleted: boolean = false,
  database: BonsaiDatabase = defaultDb
): Promise<Map<string, Message>> {
  const messages = await getMessagesByConversation(conversationId, includeDeleted, database);
  return new Map(messages.map((m) => [m.id, m]));
}
