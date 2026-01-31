/**
 * Conversation Repository
 * CRUD operations for Conversation entities
 * 
 * Encryption Integration:
 * - All reads decrypt title if encryption is enabled and unlocked
 * - All writes encrypt title if encryption is enabled and unlocked
 * - Locked state returns placeholder title to prevent ciphertext leakage
 */

import type { BonsaiDatabase } from '../database';
import { db as defaultDb, generateId, nowISO } from '../database';
import type { Conversation, CreateConversationInput, UpdateConversationInput, EncryptedField } from '../types';
import {
  encryptContent,
  decryptContent,
} from '../encryption';

/**
 * Decrypt conversation fields for reading
 */
async function decryptConversation(conversation: Conversation): Promise<Conversation> {
  const decryptedTitle = await decryptContent(conversation.title, conversation.titleEnc);
  
  return {
    ...conversation,
    title: decryptedTitle,
  };
}

/**
 * Decrypt multiple conversations
 */
async function decryptConversations(conversations: Conversation[]): Promise<Conversation[]> {
  return Promise.all(conversations.map(decryptConversation));
}

/**
 * Create a new conversation
 */
export async function createConversation(
  input: CreateConversationInput,
  database: BonsaiDatabase = defaultDb
): Promise<Conversation> {
  const now = nowISO();
  const encryptedTitle = await encryptContent(input.title);
  
  const conversation: Conversation = {
    id: generateId(),
    title: encryptedTitle.content,
    titleEnc: encryptedTitle.contentEnc ?? null,
    createdAt: now,
    updatedAt: now,
    defaultModel: input.defaultModel,
    uiState: input.uiState,
  };

  await database.conversations.add(conversation);
  
  // Return decrypted version to caller
  return decryptConversation(conversation);
}

/**
 * Get a conversation by ID (returns decrypted title)
 */
export async function getConversation(
  id: string,
  database: BonsaiDatabase = defaultDb
): Promise<Conversation | undefined> {
  const conversation = await database.conversations.get(id);
  if (!conversation) return undefined;
  return decryptConversation(conversation);
}

/**
 * Get all conversations, ordered by updatedAt descending (most recent first)
 */
export async function listConversations(
  database: BonsaiDatabase = defaultDb
): Promise<Conversation[]> {
  const conversations = await database.conversations.orderBy('updatedAt').reverse().toArray();
  return decryptConversations(conversations);
}

/**
 * Update a conversation
 * Returns the updated conversation (decrypted) or undefined if not found
 */
export async function updateConversation(
  id: string,
  updates: UpdateConversationInput,
  database: BonsaiDatabase = defaultDb
): Promise<Conversation | undefined> {
  const encryptedUpdates: UpdateConversationInput & { titleEnc?: EncryptedField | null } = {
    ...updates,
    updatedAt: nowISO(),
  };
  
  // If title is being updated, encrypt it
  if (updates.title !== undefined) {
    const encryptedTitle = await encryptContent(updates.title);
    encryptedUpdates.title = encryptedTitle.content;
    encryptedUpdates.titleEnc = encryptedTitle.contentEnc ?? null;
  }

  const count = await database.conversations.update(id, encryptedUpdates);
  if (count === 0) {
    return undefined;
  }

  const updated = await database.conversations.get(id);
  if (!updated) return undefined;
  return decryptConversation(updated);
}

/**
 * Delete a conversation and all its messages
 * Returns true if deleted, false if not found
 */
export async function deleteConversation(
  id: string,
  database: BonsaiDatabase = defaultDb
): Promise<boolean> {
  return database.transaction('rw', [database.conversations, database.messages, database.messageRevisions, database.promptContextConfigs], async () => {
    const conversation = await database.conversations.get(id);
    if (!conversation) {
      return false;
    }

    // Get all messages in this conversation
    const messages = await database.messages.where('conversationId').equals(id).toArray();
    const messageIds = messages.map((m) => m.id);

    // Delete all related data
    if (messageIds.length > 0) {
      await database.messageRevisions.where('messageId').anyOf(messageIds).delete();
      await database.promptContextConfigs.where('messageId').anyOf(messageIds).delete();
    }
    await database.messages.where('conversationId').equals(id).delete();
    await database.conversations.delete(id);

    return true;
  });
}

/**
 * Count total conversations
 */
export async function countConversations(
  database: BonsaiDatabase = defaultDb
): Promise<number> {
  return database.conversations.count();
}
