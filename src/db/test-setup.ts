/**
 * Test Setup for IndexedDB tests
 * 
 * This file configures fake-indexeddb for use with Vitest.
 * Import this at the top of any test file that uses IndexedDB.
 */

import 'fake-indexeddb/auto';

// Re-export test utilities
export { createTestDatabase, deleteDatabase } from './database';
