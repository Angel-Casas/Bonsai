/**
 * Export/Import Service for Bonsai PWA
 * 
 * Provides functionality to:
 * - Export conversations to a versioned JSON format
 * - Import conversations with ID remapping or restore mode
 * - Validate import files before processing
 * 
 * Export Format (v1):
 * {
 *   format: "bonsai-export",
 *   version: 1,
 *   exportedAt: ISO timestamp,
 *   appVersion: "1.0.0",
 *   conversations: [...],
 *   messages: [...],
 *   promptContextConfigs: [...],
 *   messageRevisions: [...]
 * }
 */

import type { BonsaiDatabase } from './database';
import { db as defaultDb, generateId, nowISO } from './database';
import type {
  Conversation,
  Message,
  MessageRevision,
  PromptContextConfig,
} from './types';
import {
  isEncryptionEnabled,
  isLocked,
  encryptContent,
  decryptContent,
  encryptOptionalField,
  decryptOptionalField,
} from './encryption';
import { safeAppendOp } from './opsService';

// ============================================================================
// Types
// ============================================================================

/** Current export format version */
export const EXPORT_FORMAT_VERSION = 1;

/** Export format identifier */
export const EXPORT_FORMAT_ID = 'bonsai-export';

/** Application version for export metadata */
export const APP_VERSION = '1.0.0';

/** Complete export file structure */
export interface BonsaiExportData {
  format: typeof EXPORT_FORMAT_ID;
  version: number;
  exportedAt: string;
  appVersion: string;
  conversations: Conversation[];
  messages: Message[];
  promptContextConfigs: PromptContextConfig[];
  messageRevisions: MessageRevision[];
}

/** Export options */
export interface ExportOptions {
  /** Export a single conversation by ID, or all if not specified */
  conversationId?: string;
}

/** Import mode */
export type ImportMode = 'restore' | 'copy';

/** What to do when IDs conflict during restore */
export type ConflictResolution = 'skip' | 'overwrite';

/** Import options */
export interface ImportOptions {
  /** Import mode: 'restore' preserves IDs, 'copy' generates new IDs */
  mode: ImportMode;
  /** Only used in 'restore' mode when IDs conflict */
  conflictResolution?: ConflictResolution;
}

/** Validation result */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  summary: {
    conversationCount: number;
    messageCount: number;
    configCount: number;
    revisionCount: number;
    formatVersion: number;
    exportedAt: string;
  } | null;
  /** The parsed data if validation succeeded */
  data?: BonsaiExportData;
}

/** Import result */
export interface ImportResult {
  success: boolean;
  error?: string;
  imported: {
    conversations: number;
    messages: number;
    configs: number;
    revisions: number;
  };
  skipped: {
    conversations: number;
    messages: number;
    configs: number;
    revisions: number;
  };
}

// ============================================================================
// Export Functions
// ============================================================================

/**
 * Export conversations to the Bonsai export format
 * 
 * ENCRYPTION BEHAVIOR:
 * - If encryption is enabled and locked, throws an error
 * - Exports decrypted data (plaintext) - the export file is NOT encrypted
 * - Users should be warned that the export is unencrypted
 * 
 * @param options - Export options (single conversation or all)
 * @param database - Database instance (defaults to main DB)
 * @returns Complete export data structure
 */
export async function exportData(
  options: ExportOptions = {},
  database: BonsaiDatabase = defaultDb
): Promise<BonsaiExportData> {
  // Block export when encryption is enabled but locked
  if (isEncryptionEnabled() && isLocked()) {
    throw new Error('Cannot export while locked. Please unlock with your passphrase first.');
  }
  
  const { conversationId } = options;

  let conversations: Conversation[];
  let messages: Message[];

  if (conversationId) {
    // Export single conversation
    const conversation = await database.conversations.get(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }
    conversations = [conversation];
    messages = await database.messages
      .where('conversationId')
      .equals(conversationId)
      .toArray();
  } else {
    // Export all conversations
    conversations = await database.conversations.toArray();
    messages = await database.messages.toArray();
  }

  // Get message IDs for filtering related data
  const messageIds = messages.map((m) => m.id);

  // Get related configs and revisions
  let promptContextConfigs: PromptContextConfig[] = [];
  let messageRevisions: MessageRevision[] = [];

  if (messageIds.length > 0) {
    promptContextConfigs = await database.promptContextConfigs
      .where('messageId')
      .anyOf(messageIds)
      .toArray();
    messageRevisions = await database.messageRevisions
      .where('messageId')
      .anyOf(messageIds)
      .toArray();
  }

  // Decrypt data if encryption is enabled (and unlocked)
  const decryptedConversations = await Promise.all(
    conversations.map(async (conv) => {
      const decryptedTitle = await decryptContent(conv.title, conv.titleEnc);
      // Return clean conversation without encrypted fields
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { titleEnc, ...rest } = conv;
      return { ...rest, title: decryptedTitle };
    })
  );

  const decryptedMessages = await Promise.all(
    messages.map(async (msg) => {
      const decryptedContent = await decryptContent(msg.content, msg.contentEnc);
      const decryptedBranchTitle = await decryptOptionalField(msg.branchTitle, msg.branchTitleEnc);
      // Return clean message without encrypted fields
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { contentEnc, branchTitleEnc, ...rest } = msg;
      return { ...rest, content: decryptedContent, branchTitle: decryptedBranchTitle };
    })
  );

  const decryptedRevisions = await Promise.all(
    messageRevisions.map(async (rev) => {
      const decryptedContent = await decryptContent(rev.previousContent, rev.previousContentEnc);
      // Return clean revision without encrypted fields
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { previousContentEnc, ...rest } = rev;
      return { ...rest, previousContent: decryptedContent };
    })
  );

  return {
    format: EXPORT_FORMAT_ID,
    version: EXPORT_FORMAT_VERSION,
    exportedAt: nowISO(),
    appVersion: APP_VERSION,
    conversations: decryptedConversations,
    messages: decryptedMessages,
    promptContextConfigs,
    messageRevisions: decryptedRevisions,
  };
}

/**
 * Serialize export data to JSON string
 * 
 * @param data - Export data structure
 * @returns Pretty-printed JSON string
 */
export function serializeExport(data: BonsaiExportData): string {
  return JSON.stringify(data, null, 2);
}

/**
 * Generate a filename for the export
 * 
 * @param conversationTitle - Optional title for single-conversation export
 * @returns Filename with date and optional title
 */
export function generateExportFilename(conversationTitle?: string): string {
  const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  if (conversationTitle) {
    // Sanitize title for filename
    const sanitized = conversationTitle
      .replace(/[^a-zA-Z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 50);
    return `bonsai-export-${date}-${sanitized}.json`;
  }
  return `bonsai-export-${date}.json`;
}

/**
 * Trigger a file download in the browser
 * 
 * @param content - File content as string
 * @param filename - Name for the downloaded file
 */
export function downloadFile(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate an import file before processing
 * 
 * @param data - Parsed JSON data (unknown type for validation)
 * @returns Validation result with errors and summary
 */
export function validateImportData(data: unknown): ValidationResult {
  const errors: string[] = [];

  // Check if data is an object
  if (!data || typeof data !== 'object') {
    return {
      isValid: false,
      errors: ['Import file must be a JSON object'],
      summary: null,
    };
  }

  const obj = data as Record<string, unknown>;

  // Check format identifier
  if (obj.format !== EXPORT_FORMAT_ID) {
    errors.push(`Invalid format: expected "${EXPORT_FORMAT_ID}", got "${obj.format}"`);
  }

  // Check version
  if (typeof obj.version !== 'number' || obj.version < 1) {
    errors.push(`Invalid version: ${obj.version}`);
  } else if (obj.version > EXPORT_FORMAT_VERSION) {
    errors.push(`Export version ${obj.version} is newer than supported version ${EXPORT_FORMAT_VERSION}`);
  }

  // Check required arrays
  if (!Array.isArray(obj.conversations)) {
    errors.push('Missing or invalid "conversations" array');
  }
  if (!Array.isArray(obj.messages)) {
    errors.push('Missing or invalid "messages" array');
  }
  if (!Array.isArray(obj.promptContextConfigs)) {
    errors.push('Missing or invalid "promptContextConfigs" array');
  }
  if (!Array.isArray(obj.messageRevisions)) {
    errors.push('Missing or invalid "messageRevisions" array');
  }

  // Check exportedAt
  if (typeof obj.exportedAt !== 'string') {
    errors.push('Missing or invalid "exportedAt" timestamp');
  }

  if (errors.length > 0) {
    return {
      isValid: false,
      errors,
      summary: null,
    };
  }

  // Validate array contents (basic type checks)
  const conversations = obj.conversations as unknown[];
  const messages = obj.messages as unknown[];
  const configs = obj.promptContextConfigs as unknown[];
  const revisions = obj.messageRevisions as unknown[];

  // Validate conversations
  for (let i = 0; i < conversations.length; i++) {
    const conv = conversations[i];
    if (!conv || typeof conv !== 'object') {
      errors.push(`conversations[${i}]: not an object`);
      continue;
    }
    const c = conv as Record<string, unknown>;
    if (typeof c.id !== 'string') errors.push(`conversations[${i}]: missing or invalid id`);
    if (typeof c.title !== 'string') errors.push(`conversations[${i}]: missing or invalid title`);
    if (typeof c.createdAt !== 'string') errors.push(`conversations[${i}]: missing or invalid createdAt`);
  }

  // Validate messages
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg || typeof msg !== 'object') {
      errors.push(`messages[${i}]: not an object`);
      continue;
    }
    const m = msg as Record<string, unknown>;
    if (typeof m.id !== 'string') errors.push(`messages[${i}]: missing or invalid id`);
    if (typeof m.conversationId !== 'string') errors.push(`messages[${i}]: missing or invalid conversationId`);
    if (!['system', 'user', 'assistant'].includes(m.role as string)) {
      errors.push(`messages[${i}]: invalid role "${m.role}"`);
    }
    if (typeof m.content !== 'string') errors.push(`messages[${i}]: missing or invalid content`);
  }

  // Validate configs
  for (let i = 0; i < configs.length; i++) {
    const cfg = configs[i];
    if (!cfg || typeof cfg !== 'object') {
      errors.push(`promptContextConfigs[${i}]: not an object`);
      continue;
    }
    const c = cfg as Record<string, unknown>;
    if (typeof c.messageId !== 'string') errors.push(`promptContextConfigs[${i}]: missing or invalid messageId`);
  }

  // Validate revisions
  for (let i = 0; i < revisions.length; i++) {
    const rev = revisions[i];
    if (!rev || typeof rev !== 'object') {
      errors.push(`messageRevisions[${i}]: not an object`);
      continue;
    }
    const r = rev as Record<string, unknown>;
    if (typeof r.id !== 'string') errors.push(`messageRevisions[${i}]: missing or invalid id`);
    if (typeof r.messageId !== 'string') errors.push(`messageRevisions[${i}]: missing or invalid messageId`);
  }

  // Limit error reporting to first 20 errors
  const reportedErrors = errors.slice(0, 20);
  if (errors.length > 20) {
    reportedErrors.push(`... and ${errors.length - 20} more errors`);
  }

  const isValid = errors.length === 0;
  return {
    isValid,
    errors: reportedErrors,
    summary: {
      conversationCount: conversations.length,
      messageCount: messages.length,
      configCount: configs.length,
      revisionCount: revisions.length,
      formatVersion: obj.version as number,
      exportedAt: obj.exportedAt as string,
    },
    // Include parsed data if valid
    data: isValid ? (data as BonsaiExportData) : undefined,
  };
}

/**
 * Parse and validate an import file
 * 
 * @param jsonString - Raw JSON string from file
 * @returns Validation result
 */
export function parseAndValidateImport(jsonString: string): ValidationResult {
  let data: unknown;
  try {
    data = JSON.parse(jsonString);
  } catch (e) {
    return {
      isValid: false,
      errors: [`Invalid JSON: ${e instanceof Error ? e.message : 'parse error'}`],
      summary: null,
    };
  }

  return validateImportData(data);
}

// ============================================================================
// Import Functions
// ============================================================================

/**
 * Create ID mapping for import-as-copy mode
 * Generates new IDs for all entities and remaps references
 * 
 * @param data - Export data to remap
 * @returns Object with ID mapping and remapped data
 */
export function createIdMapping(data: BonsaiExportData): {
  idMap: Map<string, string>;
  remappedData: BonsaiExportData;
} {
  const idMap = new Map<string, string>();

  // Generate new IDs for all entities
  for (const conv of data.conversations) {
    idMap.set(conv.id, generateId());
  }
  for (const msg of data.messages) {
    idMap.set(msg.id, generateId());
  }
  for (const rev of data.messageRevisions) {
    idMap.set(rev.id, generateId());
  }

  // Helper to remap an ID, returning original if not in map (shouldn't happen for valid data)
  const remap = (id: string | null | undefined): string | null | undefined => {
    if (id === null || id === undefined) return id;
    return idMap.get(id) ?? id;
  };

  // Remap conversations
  const conversations = data.conversations.map((conv) => ({
    ...conv,
    id: idMap.get(conv.id) ?? conv.id,
  }));

  // Remap messages
  const messages = data.messages.map((msg) => ({
    ...msg,
    id: idMap.get(msg.id) ?? msg.id,
    conversationId: remap(msg.conversationId) as string,
    parentId: remap(msg.parentId) as string | null,
    variantOfMessageId: remap(msg.variantOfMessageId) as string | undefined,
  }));

  // Remap configs - need to remap messageId and all ID arrays
  const promptContextConfigs = data.promptContextConfigs.map((cfg) => ({
    ...cfg,
    messageId: remap(cfg.messageId) as string,
    startFromMessageId: remap(cfg.startFromMessageId) as string | null,
    excludedMessageIds: cfg.excludedMessageIds.map((id) => remap(id) as string),
    pinnedMessageIds: cfg.pinnedMessageIds.map((id) => remap(id) as string),
    resolvedContextMessageIds: cfg.resolvedContextMessageIds.map((id) => remap(id) as string),
  }));

  // Remap revisions
  const messageRevisions = data.messageRevisions.map((rev) => ({
    ...rev,
    id: idMap.get(rev.id) ?? rev.id,
    messageId: remap(rev.messageId) as string,
  }));

  return {
    idMap,
    remappedData: {
      ...data,
      conversations,
      messages,
      promptContextConfigs,
      messageRevisions,
    },
  };
}

/**
 * Check for ID conflicts with existing data
 * 
 * @param data - Export data to check
 * @param database - Database instance
 * @returns Object with arrays of conflicting IDs by type
 */
export async function checkForConflicts(
  data: BonsaiExportData,
  database: BonsaiDatabase = defaultDb
): Promise<{
  conversations: string[];
  messages: string[];
  configs: string[];
  revisions: string[];
  hasConflicts: boolean;
}> {
  const conflicts = {
    conversations: [] as string[],
    messages: [] as string[],
    configs: [] as string[],
    revisions: [] as string[],
    hasConflicts: false,
  };

  // Check conversation IDs
  for (const conv of data.conversations) {
    const existing = await database.conversations.get(conv.id);
    if (existing) {
      conflicts.conversations.push(conv.id);
    }
  }

  // Check message IDs
  for (const msg of data.messages) {
    const existing = await database.messages.get(msg.id);
    if (existing) {
      conflicts.messages.push(msg.id);
    }
  }

  // Check config IDs (primary key is messageId)
  for (const cfg of data.promptContextConfigs) {
    const existing = await database.promptContextConfigs.get(cfg.messageId);
    if (existing) {
      conflicts.configs.push(cfg.messageId);
    }
  }

  // Check revision IDs
  for (const rev of data.messageRevisions) {
    const existing = await database.messageRevisions.get(rev.id);
    if (existing) {
      conflicts.revisions.push(rev.id);
    }
  }

  conflicts.hasConflicts =
    conflicts.conversations.length > 0 ||
    conflicts.messages.length > 0 ||
    conflicts.configs.length > 0 ||
    conflicts.revisions.length > 0;

  return conflicts;
}

/**
 * Import data into the database
 * 
 * ENCRYPTION BEHAVIOR:
 * - If encryption is enabled and locked, throws an error
 * - If encryption is enabled and unlocked, encrypts data on import
 * - Import file is expected to be plaintext (from a decrypted export)
 * 
 * @param data - Validated export data to import
 * @param options - Import options (mode and conflict resolution)
 * @param database - Database instance
 * @returns Import result with counts
 */
export async function importData(
  data: BonsaiExportData,
  options: ImportOptions,
  database: BonsaiDatabase = defaultDb
): Promise<ImportResult> {
  // Block import when encryption is enabled but locked
  if (isEncryptionEnabled() && isLocked()) {
    return {
      success: false,
      error: 'Cannot import while locked. Please unlock with your passphrase first.',
      imported: { conversations: 0, messages: 0, configs: 0, revisions: 0 },
      skipped: { conversations: 0, messages: 0, configs: 0, revisions: 0 },
    };
  }
  
  const result: ImportResult = {
    success: false,
    imported: {
      conversations: 0,
      messages: 0,
      configs: 0,
      revisions: 0,
    },
    skipped: {
      conversations: 0,
      messages: 0,
      configs: 0,
      revisions: 0,
    },
  };

  try {
    // If copy mode, remap all IDs first
    let dataToImport = data;
    if (options.mode === 'copy') {
      const { remappedData } = createIdMapping(data);
      dataToImport = remappedData;
    }

    // Encrypt data if encryption is enabled
    const encryptedConversations = await Promise.all(
      dataToImport.conversations.map(async (conv): Promise<Conversation> => {
        const encrypted = await encryptContent(conv.title);
        return {
          ...conv,
          title: encrypted.content,
          titleEnc: encrypted.contentEnc ?? null,
        };
      })
    );

    const encryptedMessages = await Promise.all(
      dataToImport.messages.map(async (msg): Promise<Message> => {
        const encryptedContent = await encryptContent(msg.content);
        const encryptedBranchTitle = await encryptOptionalField(msg.branchTitle);
        return {
          ...msg,
          content: encryptedContent.content,
          contentEnc: encryptedContent.contentEnc ?? null,
          branchTitle: encryptedBranchTitle.value,
          branchTitleEnc: encryptedBranchTitle.valueEnc ?? null,
        };
      })
    );

    const encryptedRevisions = await Promise.all(
      dataToImport.messageRevisions.map(async (rev): Promise<MessageRevision> => {
        const encrypted = await encryptContent(rev.previousContent);
        return {
          ...rev,
          previousContent: encrypted.content,
          previousContentEnc: encrypted.contentEnc ?? null,
        };
      })
    );

    // Check for conflicts in restore mode
    let conflicts: Awaited<ReturnType<typeof checkForConflicts>> | null = null;
    if (options.mode === 'restore') {
      conflicts = await checkForConflicts(dataToImport, database);
      if (conflicts.hasConflicts && !options.conflictResolution) {
        return {
          ...result,
          success: false,
          error: 'ID conflicts detected. Please specify a conflict resolution strategy.',
        };
      }
    }

    // Use a transaction for atomicity
    await database.transaction(
      'rw',
      [database.conversations, database.messages, database.promptContextConfigs, database.messageRevisions],
      async () => {
        // Import conversations
        for (const conv of encryptedConversations) {
          const isConflict = conflicts?.conversations.includes(conv.id);
          if (isConflict) {
            if (options.conflictResolution === 'skip') {
              result.skipped.conversations++;
              continue;
            } else if (options.conflictResolution === 'overwrite') {
              await database.conversations.put(conv);
              result.imported.conversations++;
              continue;
            }
          }
          await database.conversations.add(conv);
          result.imported.conversations++;
        }

        // Import messages
        for (const msg of encryptedMessages) {
          const isConflict = conflicts?.messages.includes(msg.id);
          if (isConflict) {
            if (options.conflictResolution === 'skip') {
              result.skipped.messages++;
              continue;
            } else if (options.conflictResolution === 'overwrite') {
              await database.messages.put(msg);
              result.imported.messages++;
              continue;
            }
          }
          await database.messages.add(msg);
          result.imported.messages++;
        }

        // Import configs (no encryption needed)
        for (const cfg of dataToImport.promptContextConfigs) {
          const isConflict = conflicts?.configs.includes(cfg.messageId);
          if (isConflict) {
            if (options.conflictResolution === 'skip') {
              result.skipped.configs++;
              continue;
            } else if (options.conflictResolution === 'overwrite') {
              await database.promptContextConfigs.put(cfg);
              result.imported.configs++;
              continue;
            }
          }
          await database.promptContextConfigs.add(cfg);
          result.imported.configs++;
        }

        // Import revisions
        for (const rev of encryptedRevisions) {
          const isConflict = conflicts?.revisions.includes(rev.id);
          if (isConflict) {
            if (options.conflictResolution === 'skip') {
              result.skipped.revisions++;
              continue;
            } else if (options.conflictResolution === 'overwrite') {
              await database.messageRevisions.put(rev);
              result.imported.revisions++;
              continue;
            }
          }
          await database.messageRevisions.add(rev);
          result.imported.revisions++;
        }
      }
    );

    // Emit sync op for import
    safeAppendOp('import.completed', {
      conversationCount: result.imported.conversations,
      messageCount: result.imported.messages,
      mode: options.mode,
    });

    result.success = true;
    return result;
  } catch (error) {
    return {
      ...result,
      success: false,
      error: error instanceof Error ? error.message : 'Import failed',
    };
  }
}

// ============================================================================
// Markdown Export Functions
// ============================================================================

/**
 * Format a role name for markdown display
 */
function formatRole(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

/**
 * Internal: load and decrypt messages for a conversation, returning the message map
 */
async function loadConversationMessages(
  conversationId: string,
  database: BonsaiDatabase
): Promise<{ messageMap: Map<string, Message>; allMessages: Message[] }> {
  const allMessages = await database.messages
    .where('conversationId')
    .equals(conversationId)
    .toArray();

  const messageMap = new Map<string, Message>();
  for (const msg of allMessages) {
    messageMap.set(msg.id, msg);
  }

  return { messageMap, allMessages };
}

/**
 * Internal: walk from a message to root, returning the path in root→leaf order
 */
function walkToRoot(leafId: string, messageMap: Map<string, Message>): Message[] {
  const path: Message[] = [];
  let current = messageMap.get(leafId);
  if (!current) return path;

  while (current) {
    path.unshift(current);
    if (current.parentId === null) break;
    current = messageMap.get(current.parentId);
  }
  return path;
}

/**
 * Internal: format an array of messages as markdown lines
 */
async function formatMessagesAsMarkdown(
  messages: Message[]
): Promise<string[]> {
  const lines: string[] = [];
  for (const msg of messages) {
    const decryptedContent = await decryptContent(msg.content, msg.contentEnc);
    lines.push(`### ${formatRole(msg.role)}`);
    lines.push('');
    lines.push(decryptedContent);
    lines.push('');
    lines.push('---');
    lines.push('');
  }
  return lines;
}

/**
 * Export a single branch (path from root to a leaf message) as a markdown string
 *
 * @param options - conversationId and leafMessageId identifying the branch
 * @param database - Database instance (defaults to main DB)
 * @returns Markdown string of the branch
 */
export async function exportBranchAsMarkdown(
  options: { conversationId: string; leafMessageId: string },
  database: BonsaiDatabase = defaultDb
): Promise<string> {
  if (isEncryptionEnabled() && isLocked()) {
    throw new Error('Cannot export while locked. Please unlock with your passphrase first.');
  }

  const { conversationId, leafMessageId } = options;

  const conversation = await database.conversations.get(conversationId);
  if (!conversation) {
    throw new Error(`Conversation not found: ${conversationId}`);
  }

  const decryptedTitle = await decryptContent(conversation.title, conversation.titleEnc);
  const { messageMap } = await loadConversationMessages(conversationId, database);

  const branchPath = walkToRoot(leafMessageId, messageMap);
  if (branchPath.length === 0) {
    throw new Error(`Message not found: ${leafMessageId}`);
  }

  const date = new Date().toISOString().split('T')[0];
  const lines: string[] = [];
  lines.push(`# ${decryptedTitle}`);
  lines.push('');
  lines.push(`> Exported from Bonsai on ${date}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(...await formatMessagesAsMarkdown(branchPath));

  return lines.join('\n');
}

/**
 * Export an entire conversation as markdown.
 * Each branch (root-to-leaf path) is rendered as a separate section.
 * If the conversation is linear (single branch), it exports as one flat document.
 *
 * @param conversationId - The conversation to export
 * @param database - Database instance (defaults to main DB)
 * @returns Markdown string of the full conversation
 */
export async function exportConversationAsMarkdown(
  conversationId: string,
  database: BonsaiDatabase = defaultDb
): Promise<string> {
  if (isEncryptionEnabled() && isLocked()) {
    throw new Error('Cannot export while locked. Please unlock with your passphrase first.');
  }

  const conversation = await database.conversations.get(conversationId);
  if (!conversation) {
    throw new Error(`Conversation not found: ${conversationId}`);
  }

  const decryptedTitle = await decryptContent(conversation.title, conversation.titleEnc);
  const { messageMap, allMessages } = await loadConversationMessages(conversationId, database);

  // Find all leaf messages (not a parent of any other message)
  const parentIds = new Set<string>();
  for (const msg of allMessages) {
    if (msg.parentId !== null) {
      parentIds.add(msg.parentId);
    }
  }
  const leaves = allMessages
    .filter(msg => !parentIds.has(msg.id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const date = new Date().toISOString().split('T')[0];
  const lines: string[] = [];
  lines.push(`# ${decryptedTitle}`);
  lines.push('');
  lines.push(`> Exported from Bonsai on ${date}`);
  lines.push('');

  if (leaves.length <= 1) {
    // Linear conversation - single flat section
    const path = leaves.length === 1 ? walkToRoot(leaves[0]!.id, messageMap) : [];
    lines.push('---');
    lines.push('');
    lines.push(...await formatMessagesAsMarkdown(path));
  } else {
    // Branched conversation - one section per branch
    for (let i = 0; i < leaves.length; i++) {
      const branchPath = walkToRoot(leaves[i]!.id, messageMap);
      const branchLabel = findBranchLabel(branchPath) || `Branch ${i + 1}`;
      lines.push(`## ${branchLabel}`);
      lines.push('');
      lines.push(...await formatMessagesAsMarkdown(branchPath));
    }
  }

  return lines.join('\n');
}

/**
 * Export all conversations as a single markdown document.
 * Each conversation is a top-level heading, with branches as sub-sections.
 *
 * @param database - Database instance (defaults to main DB)
 * @returns Markdown string of all conversations
 */
export async function exportAllAsMarkdown(
  database: BonsaiDatabase = defaultDb
): Promise<string> {
  if (isEncryptionEnabled() && isLocked()) {
    throw new Error('Cannot export while locked. Please unlock with your passphrase first.');
  }

  const allConversations = await database.conversations.toArray();
  // Sort by updatedAt descending (most recent first)
  allConversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const date = new Date().toISOString().split('T')[0];
  const lines: string[] = [];
  lines.push('# Bonsai Export');
  lines.push('');
  lines.push(`> Exported from Bonsai on ${date} · ${allConversations.length} conversation${allConversations.length !== 1 ? 's' : ''}`);
  lines.push('');

  for (const conv of allConversations) {
    const decryptedTitle = await decryptContent(conv.title, conv.titleEnc);
    const { messageMap, allMessages } = await loadConversationMessages(conv.id, database);

    // Find leaves
    const parentIds = new Set<string>();
    for (const msg of allMessages) {
      if (msg.parentId !== null) {
        parentIds.add(msg.parentId);
      }
    }
    const leaves = allMessages
      .filter(msg => !parentIds.has(msg.id))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    lines.push(`## ${decryptedTitle}`);
    lines.push('');

    if (leaves.length <= 1) {
      const path = leaves.length === 1 ? walkToRoot(leaves[0]!.id, messageMap) : [];
      lines.push(...await formatMessagesAsMarkdown(path));
    } else {
      for (let i = 0; i < leaves.length; i++) {
        const branchPath = walkToRoot(leaves[i]!.id, messageMap);
        const branchLabel = findBranchLabel(branchPath) || `Branch ${i + 1}`;
        lines.push(`### ${branchLabel}`);
        lines.push('');
        lines.push(...await formatMessagesAsMarkdown(branchPath));
      }
    }
  }

  return lines.join('\n');
}

/**
 * Find the last (deepest) branchTitle on a root→leaf path.
 * This gives the most specific label for the branch the leaf belongs to.
 */
function findBranchLabel(path: Message[]): string | null {
  let label: string | null = null;
  for (const msg of path) {
    if (msg.branchTitle) {
      label = msg.branchTitle;
    }
  }
  return label;
}

/**
 * Get leaf messages (branch tips) for a conversation.
 * Each leaf represents a unique branch that can be exported.
 *
 * @param conversationId - The conversation to get leaves for
 * @param database - Database instance (defaults to main DB)
 * @returns Array of leaf messages with decrypted content preview
 */
export interface LeafInfo {
  id: string;
  role: string;
  contentPreview: string;
  depth: number;
  /** The deepest branchTitle found on the path from root to this leaf, or null */
  branchTitle: string | null;
}

export async function getConversationLeaves(
  conversationId: string,
  database: BonsaiDatabase = defaultDb
): Promise<LeafInfo[]> {
  if (isEncryptionEnabled() && isLocked()) {
    throw new Error('Cannot read branches while locked. Please unlock with your passphrase first.');
  }

  const { messageMap, allMessages } = await loadConversationMessages(conversationId, database);

  const parentIds = new Set<string>();
  for (const msg of allMessages) {
    if (msg.parentId !== null) {
      parentIds.add(msg.parentId);
    }
  }

  const leaves: LeafInfo[] = [];
  for (const msg of allMessages) {
    if (!parentIds.has(msg.id)) {
      const path = walkToRoot(msg.id, messageMap);
      const depth = path.length - 1;
      const branchTitle = findBranchLabel(path);

      const decryptedContent = await decryptContent(msg.content, msg.contentEnc);
      const preview = decryptedContent.length > 80
        ? decryptedContent.substring(0, 80) + '...'
        : decryptedContent;

      leaves.push({ id: msg.id, role: msg.role, contentPreview: preview, depth, branchTitle });
    }
  }

  leaves.sort((a, b) => b.depth - a.depth);
  return leaves;
}

/**
 * Generate a filename for a markdown export
 */
export function generateMarkdownFilename(conversationTitle: string, isBranch?: boolean): string {
  const date = new Date().toISOString().split('T')[0];
  const sanitized = conversationTitle
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 50);
  const prefix = isBranch ? 'bonsai-branch' : 'bonsai-export';
  return `${prefix}-${date}-${sanitized}.md`;
}

/**
 * Trigger a markdown file download in the browser
 */
export function downloadMarkdownFile(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Read a file and return its contents as a string
 * 
 * @param file - File object from file input
 * @returns Promise resolving to file contents
 */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}
