/**
 * MessageRevision Repository
 * CRUD operations for MessageRevision entities
 * Used to track edit history when messages are modified in place
 */

import type { BonsaiDatabase } from '../database';
import { db as defaultDb, generateId, nowISO } from '../database';
import type { MessageRevision, CreateMessageRevisionInput } from '../types';

/**
 * Create a new message revision
 * Call this before updating a message's content to preserve the previous state
 */
export async function createMessageRevision(
  input: CreateMessageRevisionInput,
  database: BonsaiDatabase = defaultDb
): Promise<MessageRevision> {
  const revision: MessageRevision = {
    id: generateId(),
    messageId: input.messageId,
    previousContent: input.previousContent,
    createdAt: nowISO(),
    reason: input.reason,
  };

  await database.messageRevisions.add(revision);
  return revision;
}

/**
 * Get a revision by ID
 */
export async function getMessageRevision(
  id: string,
  database: BonsaiDatabase = defaultDb
): Promise<MessageRevision | undefined> {
  return database.messageRevisions.get(id);
}

/**
 * Get all revisions for a message, ordered by createdAt (oldest first)
 */
export async function getRevisionsByMessage(
  messageId: string,
  database: BonsaiDatabase = defaultDb
): Promise<MessageRevision[]> {
  return database.messageRevisions
    .where('messageId')
    .equals(messageId)
    .sortBy('createdAt');
}

/**
 * Get the most recent revision for a message
 */
export async function getLatestRevision(
  messageId: string,
  database: BonsaiDatabase = defaultDb
): Promise<MessageRevision | undefined> {
  const revisions = await database.messageRevisions
    .where('messageId')
    .equals(messageId)
    .reverse()
    .sortBy('createdAt');
  
  return revisions[0];
}

/**
 * Delete all revisions for a message
 * Used when permanently deleting a message
 */
export async function deleteRevisionsByMessage(
  messageId: string,
  database: BonsaiDatabase = defaultDb
): Promise<number> {
  return database.messageRevisions.where('messageId').equals(messageId).delete();
}

/**
 * Count revisions for a message
 */
export async function countRevisions(
  messageId: string,
  database: BonsaiDatabase = defaultDb
): Promise<number> {
  return database.messageRevisions.where('messageId').equals(messageId).count();
}
