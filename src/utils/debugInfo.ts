/**
 * Debug Info Utility
 *
 * Collects non-sensitive diagnostics for support purposes.
 * MUST NOT include: API key, conversation content, encryption salts/hashes
 */

import { version } from '../../package.json'
import { db } from '@/db'
import { isEncryptionEnabled, isLocked } from '@/db/encryption'

export interface DebugInfo {
  appVersion: string
  buildMode: string
  dbSchemaVersion: number
  dbName: string
  encryptionEnabled: boolean
  isLocked: boolean
  conversationCount: number
  messageCount: number
  serviceWorkerStatus: string
  userAgent: string
  timestamp: string
}

/**
 * Collects non-sensitive debug information for support.
 * Safe to copy and share publicly.
 */
export async function collectDebugInfo(): Promise<DebugInfo> {
  // Get database counts
  let conversationCount = 0
  let messageCount = 0

  try {
    conversationCount = await db.conversations.count()
    messageCount = await db.messages.count()
  } catch {
    // DB might be locked or unavailable
  }

  // Get service worker status
  let serviceWorkerStatus = 'unsupported'
  if ('serviceWorker' in navigator) {
    const registration = await navigator.serviceWorker.getRegistration()
    if (registration) {
      if (registration.active) {
        serviceWorkerStatus = 'active'
      } else if (registration.installing) {
        serviceWorkerStatus = 'installing'
      } else if (registration.waiting) {
        serviceWorkerStatus = 'waiting'
      }
    } else {
      serviceWorkerStatus = 'not registered'
    }
  }

  return {
    appVersion: version,
    buildMode: import.meta.env.MODE,
    dbSchemaVersion: db.verno,
    dbName: db.name,
    encryptionEnabled: isEncryptionEnabled(),
    isLocked: isLocked(),
    conversationCount,
    messageCount,
    serviceWorkerStatus,
    userAgent: navigator.userAgent,
    timestamp: new Date().toISOString(),
  }
}

/**
 * Formats debug info as a copyable text block.
 */
export function formatDebugInfo(info: DebugInfo): string {
  return `Bonsai Debug Info
==================
App Version: ${info.appVersion}
Build Mode: ${info.buildMode}
Database: ${info.dbName} (schema v${info.dbSchemaVersion})
Encryption: ${info.encryptionEnabled ? 'enabled' : 'disabled'}${info.encryptionEnabled ? (info.isLocked ? ' (locked)' : ' (unlocked)') : ''}
Conversations: ${info.conversationCount}
Messages: ${info.messageCount}
Service Worker: ${info.serviceWorkerStatus}
User Agent: ${info.userAgent}
Collected: ${info.timestamp}`
}

/**
 * Validates that debug info does not contain secrets.
 * Used in tests to ensure safety.
 */
export function validateNoSecrets(text: string): boolean {
  const secretPatterns = [
    /apiKey/i,
    /api_key/i,
    /password/i,
    /passphrase/i,
    /secret/i,
    /salt/i,
    /iv[=:]/i,
    /ciphertext/i,
    /keyHash/i,
    /token/i,
  ]

  return !secretPatterns.some(pattern => pattern.test(text))
}
