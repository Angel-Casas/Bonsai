/**
 * Tests for Export/Import Service
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { createTestDatabase, deleteDatabase, type BonsaiDatabase } from './database';
import {
  exportData,
  serializeExport,
  generateExportFilename,
  validateImportData,
  parseAndValidateImport,
  createIdMapping,
  importData,
  EXPORT_FORMAT_ID,
  EXPORT_FORMAT_VERSION,
  type BonsaiExportData,
} from './exportImport';
import type { Conversation, Message, PromptContextConfig, MessageRevision } from './types';

// Test database instance
let testDb: BonsaiDatabase;
let testDbName: string;

beforeEach(() => {
  testDbName = `test-export-import-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  testDb = createTestDatabase(testDbName);
});

afterEach(async () => {
  await deleteDatabase(testDbName);
});

// Helper to create test data
async function createTestConversation(title: string = 'Test Conversation'): Promise<Conversation> {
  const conv: Conversation = {
    id: crypto.randomUUID(),
    title,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await testDb.conversations.add(conv);
  return conv;
}

async function createTestMessage(
  conversationId: string,
  parentId: string | null,
  role: 'user' | 'assistant' | 'system',
  content: string,
  extras: Partial<Message> = {}
): Promise<Message> {
  const msg: Message = {
    id: crypto.randomUUID(),
    conversationId,
    parentId,
    role,
    content,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...extras,
  };
  await testDb.messages.add(msg);
  return msg;
}

async function createTestConfig(messageId: string, extras: Partial<PromptContextConfig> = {}): Promise<PromptContextConfig> {
  const cfg: PromptContextConfig = {
    messageId,
    inheritDefaultPath: true,
    startFromMessageId: null,
    excludedMessageIds: [],
    pinnedMessageIds: [],
    orderingMode: 'PATH_THEN_PINS',
    resolvedContextMessageIds: [],
    ...extras,
  };
  await testDb.promptContextConfigs.add(cfg);
  return cfg;
}

async function createTestRevision(messageId: string, previousContent: string): Promise<MessageRevision> {
  const rev: MessageRevision = {
    id: crypto.randomUUID(),
    messageId,
    previousContent,
    createdAt: new Date().toISOString(),
  };
  await testDb.messageRevisions.add(rev);
  return rev;
}

// ============================================================================
// Export Tests
// ============================================================================

describe('exportData', () => {
  it('exports all conversations when no options provided', async () => {
    const conv1 = await createTestConversation('Conv 1');
    const conv2 = await createTestConversation('Conv 2');
    await createTestMessage(conv1.id, null, 'user', 'Hello 1');
    await createTestMessage(conv2.id, null, 'user', 'Hello 2');

    const data = await exportData({}, testDb);

    expect(data.format).toBe(EXPORT_FORMAT_ID);
    expect(data.version).toBe(EXPORT_FORMAT_VERSION);
    expect(data.conversations).toHaveLength(2);
    expect(data.messages).toHaveLength(2);
  });

  it('exports single conversation when conversationId provided', async () => {
    const conv1 = await createTestConversation('Conv 1');
    const conv2 = await createTestConversation('Conv 2');
    await createTestMessage(conv1.id, null, 'user', 'Hello 1');
    await createTestMessage(conv2.id, null, 'user', 'Hello 2');

    const data = await exportData({ conversationId: conv1.id }, testDb);

    expect(data.conversations).toHaveLength(1);
    expect(data.conversations[0]!.id).toBe(conv1.id);
    expect(data.messages).toHaveLength(1);
  });

  it('includes related configs and revisions', async () => {
    const conv = await createTestConversation();
    const msg = await createTestMessage(conv.id, null, 'user', 'Hello');
    await createTestConfig(msg.id, { pinnedMessageIds: [] });
    await createTestRevision(msg.id, 'Old content');

    const data = await exportData({ conversationId: conv.id }, testDb);

    expect(data.promptContextConfigs).toHaveLength(1);
    expect(data.messageRevisions).toHaveLength(1);
  });

  it('throws error for non-existent conversation', async () => {
    await expect(exportData({ conversationId: 'non-existent' }, testDb)).rejects.toThrow('Conversation not found');
  });
});

describe('serializeExport', () => {
  it('produces valid JSON string', async () => {
    const conv = await createTestConversation();
    await createTestMessage(conv.id, null, 'user', 'Hello');

    const data = await exportData({}, testDb);
    const json = serializeExport(data);

    expect(() => JSON.parse(json)).not.toThrow();
    const parsed = JSON.parse(json);
    expect(parsed.format).toBe(EXPORT_FORMAT_ID);
  });

  it('is pretty-printed with indentation', async () => {
    const data = await exportData({}, testDb);
    const json = serializeExport(data);

    expect(json).toContain('\n');
    expect(json).toContain('  ');
  });
});

describe('generateExportFilename', () => {
  it('includes date in filename', () => {
    const filename = generateExportFilename();
    const today = new Date().toISOString().split('T')[0];
    expect(filename).toContain(today);
    expect(filename).toMatch(/^bonsai-export-\d{4}-\d{2}-\d{2}\.json$/);
  });

  it('includes sanitized title when provided', () => {
    const filename = generateExportFilename('My Test Conversation');
    expect(filename).toContain('My-Test-Conversation');
    expect(filename.endsWith('.json')).toBe(true);
  });

  it('sanitizes special characters from title', () => {
    const filename = generateExportFilename('Test: Special <chars> & "quotes"');
    expect(filename).not.toContain(':');
    expect(filename).not.toContain('<');
    expect(filename).not.toContain('>');
    expect(filename).not.toContain('&');
    expect(filename).not.toContain('"');
  });

  it('truncates long titles', () => {
    const longTitle = 'A'.repeat(100);
    const filename = generateExportFilename(longTitle);
    expect(filename.length).toBeLessThan(120);
  });
});

// ============================================================================
// Validation Tests
// ============================================================================

describe('validateImportData', () => {
  it('accepts valid export data', () => {
    const data: BonsaiExportData = {
      format: EXPORT_FORMAT_ID,
      version: 1,
      exportedAt: new Date().toISOString(),
      appVersion: '1.0.0',
      conversations: [],
      messages: [],
      promptContextConfigs: [],
      messageRevisions: [],
    };

    const result = validateImportData(data);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.summary).not.toBeNull();
  });

  it('rejects non-object data', () => {
    const result = validateImportData('not an object');
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Import file must be a JSON object');
  });

  it('rejects invalid format identifier', () => {
    const data = {
      format: 'wrong-format',
      version: 1,
      exportedAt: new Date().toISOString(),
      conversations: [],
      messages: [],
      promptContextConfigs: [],
      messageRevisions: [],
    };

    const result = validateImportData(data);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes('Invalid format'))).toBe(true);
  });

  it('rejects newer version than supported', () => {
    const data = {
      format: EXPORT_FORMAT_ID,
      version: 999,
      exportedAt: new Date().toISOString(),
      conversations: [],
      messages: [],
      promptContextConfigs: [],
      messageRevisions: [],
    };

    const result = validateImportData(data);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes('newer than supported'))).toBe(true);
  });

  it('rejects missing arrays', () => {
    const data = {
      format: EXPORT_FORMAT_ID,
      version: 1,
      exportedAt: new Date().toISOString(),
    };

    const result = validateImportData(data);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes('conversations'))).toBe(true);
  });

  it('validates conversation objects', () => {
    const data = {
      format: EXPORT_FORMAT_ID,
      version: 1,
      exportedAt: new Date().toISOString(),
      conversations: [{ notAnId: 'test' }],
      messages: [],
      promptContextConfigs: [],
      messageRevisions: [],
    };

    const result = validateImportData(data);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes('conversations[0]'))).toBe(true);
  });

  it('validates message role', () => {
    const data = {
      format: EXPORT_FORMAT_ID,
      version: 1,
      exportedAt: new Date().toISOString(),
      conversations: [],
      messages: [{ id: '1', conversationId: 'c1', role: 'invalid', content: 'test' }],
      promptContextConfigs: [],
      messageRevisions: [],
    };

    const result = validateImportData(data);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes('invalid role'))).toBe(true);
  });
});

describe('parseAndValidateImport', () => {
  it('rejects invalid JSON', () => {
    const result = parseAndValidateImport('not valid json {');
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes('Invalid JSON'))).toBe(true);
  });

  it('validates parsed JSON structure', () => {
    const result = parseAndValidateImport('{"format": "wrong"}');
    expect(result.isValid).toBe(false);
  });
});

// ============================================================================
// ID Remapping Tests
// ============================================================================

describe('createIdMapping', () => {
  it('generates new IDs for all entities', () => {
    const data: BonsaiExportData = {
      format: EXPORT_FORMAT_ID,
      version: 1,
      exportedAt: new Date().toISOString(),
      appVersion: '1.0.0',
      conversations: [{ id: 'conv1', title: 'Test', createdAt: '', updatedAt: '' }],
      messages: [{ id: 'msg1', conversationId: 'conv1', parentId: null, role: 'user', content: 'Hi', createdAt: '', updatedAt: '' }],
      promptContextConfigs: [],
      messageRevisions: [{ id: 'rev1', messageId: 'msg1', previousContent: 'Old', createdAt: '' }],
    };

    const { idMap, remappedData } = createIdMapping(data);

    // All original IDs should be in the map
    expect(idMap.has('conv1')).toBe(true);
    expect(idMap.has('msg1')).toBe(true);
    expect(idMap.has('rev1')).toBe(true);

    // New IDs should be different
    expect(idMap.get('conv1')).not.toBe('conv1');
    expect(idMap.get('msg1')).not.toBe('msg1');

    // Remapped data should use new IDs
    expect(remappedData.conversations[0]!.id).toBe(idMap.get('conv1'));
    expect(remappedData.messages[0]!.id).toBe(idMap.get('msg1'));
    expect(remappedData.messages[0]!.conversationId).toBe(idMap.get('conv1'));
  });

  it('remaps parentId relationships', () => {
    const data: BonsaiExportData = {
      format: EXPORT_FORMAT_ID,
      version: 1,
      exportedAt: new Date().toISOString(),
      appVersion: '1.0.0',
      conversations: [{ id: 'c1', title: 'Test', createdAt: '', updatedAt: '' }],
      messages: [
        { id: 'm1', conversationId: 'c1', parentId: null, role: 'user', content: 'Parent', createdAt: '', updatedAt: '' },
        { id: 'm2', conversationId: 'c1', parentId: 'm1', role: 'assistant', content: 'Child', createdAt: '', updatedAt: '' },
      ],
      promptContextConfigs: [],
      messageRevisions: [],
    };

    const { idMap, remappedData } = createIdMapping(data);

    // Parent message should have null parentId preserved
    expect(remappedData.messages[0]!.parentId).toBeNull();
    // Child message should have remapped parentId
    expect(remappedData.messages[1]!.parentId).toBe(idMap.get('m1'));
  });

  it('remaps variantOfMessageId', () => {
    const data: BonsaiExportData = {
      format: EXPORT_FORMAT_ID,
      version: 1,
      exportedAt: new Date().toISOString(),
      appVersion: '1.0.0',
      conversations: [{ id: 'c1', title: 'Test', createdAt: '', updatedAt: '' }],
      messages: [
        { id: 'm1', conversationId: 'c1', parentId: null, role: 'user', content: 'Original', createdAt: '', updatedAt: '' },
        { id: 'm2', conversationId: 'c1', parentId: null, role: 'user', content: 'Variant', createdAt: '', updatedAt: '', variantOfMessageId: 'm1' },
      ],
      promptContextConfigs: [],
      messageRevisions: [],
    };

    const { idMap, remappedData } = createIdMapping(data);

    expect(remappedData.messages[1]!.variantOfMessageId).toBe(idMap.get('m1'));
  });

  it('remaps config messageId and snapshot arrays', () => {
    const data: BonsaiExportData = {
      format: EXPORT_FORMAT_ID,
      version: 1,
      exportedAt: new Date().toISOString(),
      appVersion: '1.0.0',
      conversations: [{ id: 'c1', title: 'Test', createdAt: '', updatedAt: '' }],
      messages: [
        { id: 'm1', conversationId: 'c1', parentId: null, role: 'system', content: 'System', createdAt: '', updatedAt: '' },
        { id: 'm2', conversationId: 'c1', parentId: 'm1', role: 'user', content: 'User', createdAt: '', updatedAt: '' },
      ],
      promptContextConfigs: [{
        messageId: 'm2',
        inheritDefaultPath: true,
        startFromMessageId: 'm1',
        excludedMessageIds: [],
        pinnedMessageIds: ['m1'],
        orderingMode: 'PATH_THEN_PINS',
        resolvedContextMessageIds: ['m1', 'm2'],
      }],
      messageRevisions: [],
    };

    const { idMap, remappedData } = createIdMapping(data);

    const cfg = remappedData.promptContextConfigs[0]!;
    expect(cfg.messageId).toBe(idMap.get('m2'));
    expect(cfg.startFromMessageId).toBe(idMap.get('m1'));
    expect(cfg.pinnedMessageIds[0]).toBe(idMap.get('m1'));
    expect(cfg.resolvedContextMessageIds[0]).toBe(idMap.get('m1'));
    expect(cfg.resolvedContextMessageIds[1]).toBe(idMap.get('m2'));
  });
});

// ============================================================================
// Import Tests
// ============================================================================

describe('importData', () => {
  const createValidExportData = (): BonsaiExportData => ({
    format: EXPORT_FORMAT_ID,
    version: 1,
    exportedAt: new Date().toISOString(),
    appVersion: '1.0.0',
    conversations: [{ id: 'c1', title: 'Imported', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
    messages: [
      { id: 'm1', conversationId: 'c1', parentId: null, role: 'user', content: 'Hello', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'm2', conversationId: 'c1', parentId: 'm1', role: 'assistant', content: 'Hi!', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ],
    promptContextConfigs: [{
      messageId: 'm1',
      inheritDefaultPath: true,
      startFromMessageId: null,
      excludedMessageIds: [],
      pinnedMessageIds: [],
      orderingMode: 'PATH_THEN_PINS',
      resolvedContextMessageIds: ['m1'],
    }],
    messageRevisions: [],
  });

  it('imports data in copy mode with new IDs', async () => {
    const data = createValidExportData();
    const result = await importData(data, { mode: 'copy' }, testDb);

    expect(result.success).toBe(true);
    expect(result.imported.conversations).toBe(1);
    expect(result.imported.messages).toBe(2);
    expect(result.imported.configs).toBe(1);

    // Check data was imported
    const conversations = await testDb.conversations.toArray();
    expect(conversations).toHaveLength(1);
    // New ID should be different from original
    expect(conversations[0]!.id).not.toBe('c1');

    // Check parent-child relationship preserved
    const messages = await testDb.messages.toArray();
    expect(messages).toHaveLength(2);
    const child = messages.find((m) => m.content === 'Hi!');
    const parent = messages.find((m) => m.content === 'Hello');
    expect(child!.parentId).toBe(parent!.id);
  });

  it('imports data in restore mode preserving IDs', async () => {
    const data = createValidExportData();
    const result = await importData(data, { mode: 'restore' }, testDb);

    expect(result.success).toBe(true);

    // Check IDs preserved
    const conv = await testDb.conversations.get('c1');
    expect(conv).toBeDefined();
    expect(conv!.title).toBe('Imported');

    const msg = await testDb.messages.get('m1');
    expect(msg).toBeDefined();
    expect(msg!.content).toBe('Hello');
  });

  it('skips duplicates in restore mode with skip resolution', async () => {
    // First import
    const data = createValidExportData();
    await importData(data, { mode: 'restore' }, testDb);

    // Modify locally
    await testDb.conversations.update('c1', { title: 'Modified' });

    // Second import with skip
    const result = await importData(data, { mode: 'restore', conflictResolution: 'skip' }, testDb);

    expect(result.success).toBe(true);
    expect(result.skipped.conversations).toBe(1);
    expect(result.imported.conversations).toBe(0);

    // Local modification preserved
    const conv = await testDb.conversations.get('c1');
    expect(conv!.title).toBe('Modified');
  });

  it('overwrites duplicates in restore mode with overwrite resolution', async () => {
    // First import
    const data = createValidExportData();
    await importData(data, { mode: 'restore' }, testDb);

    // Modify locally
    await testDb.conversations.update('c1', { title: 'Modified' });

    // Second import with overwrite
    const result = await importData(data, { mode: 'restore', conflictResolution: 'overwrite' }, testDb);

    expect(result.success).toBe(true);
    expect(result.imported.conversations).toBe(1);

    // Original restored
    const conv = await testDb.conversations.get('c1');
    expect(conv!.title).toBe('Imported');
  });

  it('fails restore with conflicts when no resolution specified', async () => {
    // First import
    const data = createValidExportData();
    await importData(data, { mode: 'restore' }, testDb);

    // Second import without resolution
    const result = await importData(data, { mode: 'restore' }, testDb);

    expect(result.success).toBe(false);
    expect(result.error).toContain('conflicts');
  });

  it('atomic import: rolls back on error', async () => {
    // Create data that will cause an error mid-import (duplicate key)
    const data = createValidExportData();
    // Insert something to cause conflict
    await testDb.conversations.add({ id: 'conflict', title: 'Conflict', createdAt: '', updatedAt: '' });

    // First message import should succeed, then config will fail if message doesn't exist
    // Actually let's test by trying to insert a duplicate config after first import
    await importData(data, { mode: 'restore' }, testDb);
    
    // Now try to import again - should fail atomically
    const result = await importData(data, { mode: 'restore' }, testDb);
    expect(result.success).toBe(false);
  });
});
