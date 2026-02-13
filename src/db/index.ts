/**
 * Database module barrel file
 * Main entry point for all database operations
 */

// Core database
export { db, BonsaiDatabase, createTestDatabase, deleteDatabase, generateId, nowISO } from './database';

// Types
export type {
  Conversation,
  Message,
  MessageRevision,
  PromptContextConfig,
  MessageRole,
  OrderingMode,
  CreateConversationInput,
  UpdateConversationInput,
  CreateMessageInput,
  UpdateMessageInput,
  CreateMessageRevisionInput,
  CreatePromptContextConfigInput,
  UpdatePromptContextConfigInput,
} from './types';

// Repositories (namespaced to avoid conflicts)
import * as conversationRepo from './repositories/conversationRepository';
import * as messageRepo from './repositories/messageRepository';
import * as revisionRepo from './repositories/messageRevisionRepository';
import * as contextConfigRepo from './repositories/promptContextConfigRepository';

export { conversationRepo, messageRepo, revisionRepo, contextConfigRepo };

// Pure tree utilities (namespaced)
import * as treeUtils from './treeUtils';
export { treeUtils };

// Context resolver (namespaced)
import * as contextResolver from './contextResolver';
export { contextResolver };

// Direct exports for common context functions
export {
  resolveContext,
  createDefaultContextConfig,
  isMessageOnPath,
  searchMessages,
  type ContextResolverConfig,
  type ContextPreset,
  type ResolvedContext,
  type ContextWarning,
  type ContextWarningType,
} from './contextResolver';

// DB-integrated tree operations
export {
  createBranch,
  createVariant,
  editMessageInPlace,
  deleteSubtree,
  softDeleteSubtree,
  getPathToMessage,
  getAncestors,
  getDescendants,
  hasDescendants,
  getVariants,
  createSeedData,
  type CreateBranchOptions,
  type CreateBranchResult,
  type CreateVariantOptions,
  type EditInPlaceOptions,
  type DeleteSubtreeResult,
  type SeedDataOptions,
} from './treeOperations';

// Also export treeUtils types
export type { TreeResult } from './treeUtils';

// Export/Import functions
export {
  exportData,
  serializeExport,
  generateExportFilename,
  downloadFile,
  validateImportData,
  parseAndValidateImport,
  createIdMapping,
  checkForConflicts,
  importData,
  readFileAsText,
  EXPORT_FORMAT_VERSION,
  EXPORT_FORMAT_ID,
  APP_VERSION,
  type BonsaiExportData,
  type ExportOptions,
  type ImportMode,
  type ConflictResolution,
  type ImportOptions,
  type ValidationResult,
  type ImportResult,
} from './exportImport';

// Sync operations service
export {
  appendOp,
  getPendingOps,
  markAcked,
  getOpStats,
  getOrCreateClientId,
} from './opsService';

// Sync adapter
export {
  LocalOnlySyncAdapter,
  type SyncAdapter,
} from './syncAdapter';

// Sync types
export type {
  SyncOp,
  OpType,
  OpStatus,
} from './types';
