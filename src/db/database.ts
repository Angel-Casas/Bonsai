/**
 * Dexie Database Schema for Bonsai PWA
 * 
 * This module defines the IndexedDB database using Dexie.
 * All storage operations are centralized here to allow future encryption layer integration.
 * 
 * Migration Strategy:
 * - Each schema version is defined explicitly in the version() chain
 * - Migrations can include data transformations via upgrade() callbacks
 * - Never modify existing version definitions; always add new versions
 */

import Dexie, { type Table } from 'dexie';
import type {
  Conversation,
  Message,
  MessageRevision,
  PromptContextConfig,
} from './types';

/**
 * BonsaiDatabase - Main database class
 * 
 * Tables:
 * - conversations: Top-level conversation containers
 * - messages: Tree of messages (linked via parentId)
 * - messageRevisions: Edit history for messages
 * - promptContextConfigs: Context configuration per user message
 * 
 * Indices:
 * - messages.conversationId: Query all messages in a conversation
 * - messages.parentId: Query children of a message
 * - messages.[conversationId+createdAt]: Chronological ordering within conversation
 * - messages.variantOfMessageId: Query variants of a message
 * - messageRevisions.messageId: Query revisions for a message
 * - promptContextConfigs.messageId: Primary key (1:1 with user messages)
 */
export class BonsaiDatabase extends Dexie {
  conversations!: Table<Conversation, string>;
  messages!: Table<Message, string>;
  messageRevisions!: Table<MessageRevision, string>;
  promptContextConfigs!: Table<PromptContextConfig, string>;

  constructor(databaseName: string = 'BonsaiDB') {
    super(databaseName);

    /**
     * Version 1 - Initial Schema
     * 
     * Schema notation:
     * - First field before comma is the primary key
     * - & prefix = unique index
     * - * prefix = multi-entry index (for arrays)
     * - [field1+field2] = compound index
     * - ++ = auto-increment (not used here, we use UUIDs)
     */
    this.version(1).stores({
      // Conversations: id is primary key
      conversations: 'id, createdAt, updatedAt',

      // Messages: id is primary key, with indices for tree traversal
      messages: 'id, conversationId, parentId, [conversationId+createdAt], variantOfMessageId, deletedAt',

      // MessageRevisions: id is primary key, indexed by messageId
      messageRevisions: 'id, messageId, createdAt',

      // PromptContextConfigs: messageId is primary key (1:1 relationship)
      promptContextConfigs: 'messageId',
    });

    /**
     * Version 2 - Add startFromMessageId to PromptContextConfig
     * 
     * Schema is unchanged (startFromMessageId is not indexed).
     * Upgrade adds startFromMessageId: null to existing records.
     */
    this.version(2).stores({
      // Same schema - no index changes needed
      conversations: 'id, createdAt, updatedAt',
      messages: 'id, conversationId, parentId, [conversationId+createdAt], variantOfMessageId, deletedAt',
      messageRevisions: 'id, messageId, createdAt',
      promptContextConfigs: 'messageId',
    }).upgrade(async tx => {
      // Add startFromMessageId to existing configs
      await tx.table('promptContextConfigs').toCollection().modify(config => {
        if (config.startFromMessageId === undefined) {
          config.startFromMessageId = null;
        }
        // Also update orderingMode to new default if using old value
        if (config.orderingMode === 'chronological') {
          config.orderingMode = 'PATH_THEN_PINS';
        }
      });
    });

    /**
     * Version 3 - Add encrypted field variants for encryption-at-rest
     * 
     * No new indices needed (encrypted fields are not searched).
     * Fields added: contentEnc, contentIv, branchTitleEnc, branchTitleIv, titleEnc, titleIv, previousContentEnc, previousContentIv
     * These are nullable and only populated when encryption is enabled.
     */
    this.version(3).stores({
      conversations: 'id, createdAt, updatedAt',
      messages: 'id, conversationId, parentId, [conversationId+createdAt], variantOfMessageId, deletedAt',
      messageRevisions: 'id, messageId, createdAt',
      promptContextConfigs: 'messageId',
    });
    // No upgrade needed - fields are optional and will be populated when encryption is enabled
  }
}

/**
 * Default database instance
 * Use this for normal application operations.
 * Tests should create their own instances with unique names.
 */
export const db = new BonsaiDatabase();

/**
 * Create a fresh database instance for testing
 * Each test can get an isolated database to avoid interference.
 * 
 * @param name - Unique name for the test database
 * @returns A new BonsaiDatabase instance
 */
export function createTestDatabase(name: string): BonsaiDatabase {
  return new BonsaiDatabase(name);
}

/**
 * Delete a database completely
 * Useful for test cleanup.
 * 
 * @param name - Name of the database to delete
 */
export async function deleteDatabase(name: string): Promise<void> {
  await Dexie.delete(name);
}

/**
 * Generate a UUID v4
 * Used for all entity IDs.
 * 
 * Note: In future, if we need deterministic IDs for testing,
 * this could be made injectable.
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Get current ISO timestamp
 * Centralized for consistency and future testability.
 */
export function nowISO(): string {
  return new Date().toISOString();
}
