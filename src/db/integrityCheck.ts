/**
 * Data Integrity Check
 * 
 * Non-destructive integrity check for the database.
 * Detects:
 * - Messages referencing missing parents
 * - PromptContextConfigs referencing missing messages
 * - Orphaned revisions (revisions for deleted messages)
 */

import { db } from './database'

export interface IntegrityIssue {
  type: 'orphan_message' | 'orphan_config' | 'orphan_revision' | 'missing_parent'
  severity: 'warning' | 'error'
  description: string
  entityId: string
  details?: Record<string, unknown>
}

export interface IntegrityCheckResult {
  isHealthy: boolean
  issues: IntegrityIssue[]
  stats: {
    totalConversations: number
    totalMessages: number
    totalConfigs: number
    totalRevisions: number
    checkedAt: string
  }
}

/**
 * Run a non-destructive integrity check on the database
 */
export async function runIntegrityCheck(): Promise<IntegrityCheckResult> {
  const issues: IntegrityIssue[] = []
  
  // Gather all data
  const conversations = await db.conversations.toArray()
  const messages = await db.messages.toArray()
  const configs = await db.promptContextConfigs.toArray()
  const revisions = await db.messageRevisions.toArray()
  
  // Build lookup maps
  const conversationIds = new Set(conversations.map(c => c.id))
  const messageIds = new Set(messages.map(m => m.id))
  
  // Check 1: Messages referencing non-existent conversations
  for (const message of messages) {
    if (!conversationIds.has(message.conversationId)) {
      issues.push({
        type: 'orphan_message',
        severity: 'error',
        description: `Message references non-existent conversation`,
        entityId: message.id,
        details: { conversationId: message.conversationId },
      })
    }
  }
  
  // Check 2: Messages referencing non-existent parents
  for (const message of messages) {
    if (message.parentId !== null && !messageIds.has(message.parentId)) {
      issues.push({
        type: 'missing_parent',
        severity: 'error',
        description: `Message references non-existent parent`,
        entityId: message.id,
        details: { parentId: message.parentId },
      })
    }
  }
  
  // Check 3: PromptContextConfigs referencing non-existent messages
  for (const config of configs) {
    if (!messageIds.has(config.messageId)) {
      issues.push({
        type: 'orphan_config',
        severity: 'warning',
        description: `PromptContextConfig references non-existent message`,
        entityId: config.messageId,
      })
    }
    
    // Check pinned message references
    for (const pinnedId of config.pinnedMessageIds || []) {
      if (!messageIds.has(pinnedId)) {
        issues.push({
          type: 'orphan_config',
          severity: 'warning',
          description: `PromptContextConfig has pinned message that doesn't exist`,
          entityId: config.messageId,
          details: { pinnedMessageId: pinnedId },
        })
      }
    }
    
    // Check excluded message references
    for (const excludedId of config.excludedMessageIds || []) {
      if (!messageIds.has(excludedId)) {
        issues.push({
          type: 'orphan_config',
          severity: 'warning',
          description: `PromptContextConfig has excluded message that doesn't exist`,
          entityId: config.messageId,
          details: { excludedMessageId: excludedId },
        })
      }
    }
  }
  
  // Check 4: MessageRevisions referencing non-existent messages
  for (const revision of revisions) {
    if (!messageIds.has(revision.messageId)) {
      issues.push({
        type: 'orphan_revision',
        severity: 'warning',
        description: `MessageRevision references non-existent message`,
        entityId: revision.id,
        details: { messageId: revision.messageId },
      })
    }
  }
  
  return {
    isHealthy: issues.length === 0,
    issues,
    stats: {
      totalConversations: conversations.length,
      totalMessages: messages.length,
      totalConfigs: configs.length,
      totalRevisions: revisions.length,
      checkedAt: new Date().toISOString(),
    },
  }
}

/**
 * Get the current database schema version
 */
export function getSchemaVersion(): number {
  return db.verno
}

/**
 * Get database name
 */
export function getDatabaseName(): string {
  return db.name
}
