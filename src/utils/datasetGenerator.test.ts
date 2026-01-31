/**
 * Tests for Large Dataset Generator
 */

import { describe, it, expect } from 'vitest'
import {
  generateDataset,
  validateDataset,
  DEFAULT_CONFIG,
} from './datasetGenerator'

describe('datasetGenerator', () => {
  describe('generateDataset', () => {
    it('generates the correct number of messages', () => {
      const dataset = generateDataset({ messageCount: 100, seed: 12345 })
      expect(dataset.messages.length).toBe(100)
      expect(dataset.stats.totalMessages).toBe(100)
    })

    it('produces a valid tree structure', () => {
      const dataset = generateDataset({ messageCount: 500, seed: 12345 })
      const validation = validateDataset(dataset)
      expect(validation.valid).toBe(true)
      expect(validation.errors).toHaveLength(0)
    })

    it('creates at least one root message', () => {
      const dataset = generateDataset({ messageCount: 100, seed: 12345 })
      const roots = dataset.messages.filter(m => m.parentId === null)
      expect(roots.length).toBeGreaterThanOrEqual(1)
    })

    it('all messages belong to the conversation', () => {
      const dataset = generateDataset({ messageCount: 100, seed: 12345 })
      for (const msg of dataset.messages) {
        expect(msg.conversationId).toBe(dataset.conversation.id)
      }
    })

    it('parent references are always valid', () => {
      const dataset = generateDataset({ messageCount: 500, seed: 12345 })
      const messageIds = new Set(dataset.messages.map(m => m.id))

      for (const msg of dataset.messages) {
        if (msg.parentId !== null) {
          expect(messageIds.has(msg.parentId)).toBe(true)
        }
      }
    })

    it('creates branches when branchingFactor > 0', () => {
      const dataset = generateDataset({
        messageCount: 500,
        branchingFactor: 0.1,
        seed: 12345,
      })
      expect(dataset.stats.branchCount).toBeGreaterThan(0)
    })

    it('creates no branches when branchingFactor = 0', () => {
      const dataset = generateDataset({
        messageCount: 100,
        branchingFactor: 0,
        seed: 12345,
      })
      expect(dataset.stats.branchCount).toBe(0)
    })

    it('produces mixed user and assistant messages', () => {
      const dataset = generateDataset({ messageCount: 200, seed: 12345 })
      expect(dataset.stats.userMessages).toBeGreaterThan(0)
      expect(dataset.stats.assistantMessages).toBeGreaterThan(0)
    })

    it('generates valid timestamps', () => {
      const dataset = generateDataset({ messageCount: 100, seed: 12345 })
      for (const msg of dataset.messages) {
        expect(Date.parse(msg.createdAt)).not.toBeNaN()
        expect(Date.parse(msg.updatedAt)).not.toBeNaN()
      }
    })

    it('generates non-empty content for all messages', () => {
      const dataset = generateDataset({ messageCount: 100, seed: 12345 })
      for (const msg of dataset.messages) {
        expect(msg.content.length).toBeGreaterThan(0)
      }
    })

    it('creates branch titles for some branch messages', () => {
      const dataset = generateDataset({
        messageCount: 500,
        branchingFactor: 0.15,
        seed: 12345,
      })
      const messagesWithBranchTitles = dataset.messages.filter(m => m.branchTitle)
      expect(messagesWithBranchTitles.length).toBeGreaterThan(0)
    })

    it('uses default config when none provided', () => {
      const dataset = generateDataset()
      expect(dataset.messages.length).toBe(DEFAULT_CONFIG.messageCount)
    })

    it('produces deterministic results with same seed', () => {
      const dataset1 = generateDataset({ messageCount: 50, seed: 99999 })
      const dataset2 = generateDataset({ messageCount: 50, seed: 99999 })

      expect(dataset1.messages.length).toBe(dataset2.messages.length)
      for (let i = 0; i < dataset1.messages.length; i++) {
        expect(dataset1.messages[i]!.role).toBe(dataset2.messages[i]!.role)
        expect(dataset1.messages[i]!.content).toBe(dataset2.messages[i]!.content)
      }
    })

    it('produces different results with different seeds', () => {
      const dataset1 = generateDataset({ messageCount: 50, seed: 11111 })
      const dataset2 = generateDataset({ messageCount: 50, seed: 22222 })

      // Content should differ (extremely unlikely to match by chance)
      const differentContent = dataset1.messages.some(
        (msg, i) => msg.content !== dataset2.messages[i]!.content
      )
      expect(differentContent).toBe(true)
    })

    it('respects custom title', () => {
      const dataset = generateDataset({
        messageCount: 10,
        title: 'My Custom Test',
        seed: 12345,
      })
      expect(dataset.conversation.title).toBe('My Custom Test')
    })

    it('calculates maxDepth correctly', () => {
      const dataset = generateDataset({
        messageCount: 100,
        branchingFactor: 0,
        seed: 12345,
      })
      // With no branching, depth should equal message count
      expect(dataset.stats.maxDepth).toBe(100)
    })
  })

  describe('validateDataset', () => {
    it('returns valid for correct dataset', () => {
      const dataset = generateDataset({ messageCount: 100, seed: 12345 })
      const result = validateDataset(dataset)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('detects invalid conversationId', () => {
      const dataset = generateDataset({ messageCount: 10, seed: 12345 })
      dataset.messages[0]!.conversationId = 'wrong-id'
      const result = validateDataset(dataset)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('wrong conversationId'))).toBe(true)
    })

    it('detects invalid parent reference', () => {
      const dataset = generateDataset({ messageCount: 10, seed: 12345 })
      dataset.messages[5]!.parentId = 'non-existent-id'
      const result = validateDataset(dataset)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('non-existent parent'))).toBe(true)
    })

    it('detects invalid timestamps', () => {
      const dataset = generateDataset({ messageCount: 10, seed: 12345 })
      dataset.messages[0]!.createdAt = 'invalid-date'
      const result = validateDataset(dataset)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('invalid createdAt'))).toBe(true)
    })
  })

  describe('large dataset generation', () => {
    it('handles 1000 messages without errors', () => {
      const dataset = generateDataset({ messageCount: 1000, seed: 12345 })
      const validation = validateDataset(dataset)
      expect(validation.valid).toBe(true)
      expect(dataset.messages.length).toBe(1000)
    })

    it('handles 5000 messages without errors', () => {
      const dataset = generateDataset({ messageCount: 5000, seed: 12345 })
      const validation = validateDataset(dataset)
      expect(validation.valid).toBe(true)
      expect(dataset.messages.length).toBe(5000)
    })

    it('stats add up correctly', () => {
      const dataset = generateDataset({ messageCount: 1000, seed: 12345 })
      const { userMessages, assistantMessages, systemMessages, totalMessages } = dataset.stats
      expect(userMessages + assistantMessages + systemMessages).toBe(totalMessages)
    })
  })
})
