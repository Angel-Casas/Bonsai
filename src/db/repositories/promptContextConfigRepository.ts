/**
 * PromptContextConfig Repository
 * CRUD operations for PromptContextConfig entities
 * Stores context configuration (pins, exclusions) per user message
 */

import type { BonsaiDatabase } from '../database';
import { db as defaultDb } from '../database';
import type { PromptContextConfig, CreatePromptContextConfigInput, UpdatePromptContextConfigInput } from '../types';

/**
 * Create or replace a prompt context config for a message
 * Uses messageId as the primary key (1:1 relationship)
 */
export async function upsertPromptContextConfig(
  input: CreatePromptContextConfigInput,
  database: BonsaiDatabase = defaultDb
): Promise<PromptContextConfig> {
  const config: PromptContextConfig = {
    messageId: input.messageId,
    inheritDefaultPath: input.inheritDefaultPath,
    startFromMessageId: input.startFromMessageId,
    excludedMessageIds: input.excludedMessageIds,
    pinnedMessageIds: input.pinnedMessageIds,
    orderingMode: input.orderingMode,
    resolvedContextMessageIds: input.resolvedContextMessageIds ?? [],
  };

  await database.promptContextConfigs.put(config);
  return config;
}

/**
 * Get the prompt context config for a message
 */
export async function getPromptContextConfig(
  messageId: string,
  database: BonsaiDatabase = defaultDb
): Promise<PromptContextConfig | undefined> {
  return database.promptContextConfigs.get(messageId);
}

/**
 * Update a prompt context config
 * Returns the updated config or undefined if not found
 */
export async function updatePromptContextConfig(
  messageId: string,
  updates: UpdatePromptContextConfigInput,
  database: BonsaiDatabase = defaultDb
): Promise<PromptContextConfig | undefined> {
  const existing = await database.promptContextConfigs.get(messageId);
  if (!existing) {
    return undefined;
  }

  const updated: PromptContextConfig = {
    ...existing,
    ...updates,
  };

  await database.promptContextConfigs.put(updated);
  return updated;
}

/**
 * Delete a prompt context config
 * Returns true if deleted, false if not found
 */
export async function deletePromptContextConfig(
  messageId: string,
  database: BonsaiDatabase = defaultDb
): Promise<boolean> {
  const existing = await database.promptContextConfigs.get(messageId);
  if (!existing) {
    return false;
  }

  await database.promptContextConfigs.delete(messageId);
  return true;
}

/**
 * Create a default prompt context config for a message
 * Uses sensible defaults: inherit path, no anchor, no pins/exclusions, PATH_THEN_PINS ordering
 */
export async function createDefaultPromptContextConfig(
  messageId: string,
  database: BonsaiDatabase = defaultDb
): Promise<PromptContextConfig> {
  return upsertPromptContextConfig(
    {
      messageId,
      inheritDefaultPath: true,
      startFromMessageId: null,
      excludedMessageIds: [],
      pinnedMessageIds: [],
      orderingMode: 'PATH_THEN_PINS',
    },
    database
  );
}

/**
 * Set the resolved context snapshot after sending a message
 * This records exactly what messages were included in the context
 */
export async function setResolvedContext(
  messageId: string,
  resolvedMessageIds: string[],
  database: BonsaiDatabase = defaultDb
): Promise<PromptContextConfig | undefined> {
  return updatePromptContextConfig(
    messageId,
    { resolvedContextMessageIds: resolvedMessageIds },
    database
  );
}
