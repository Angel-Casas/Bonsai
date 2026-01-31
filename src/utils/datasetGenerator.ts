/**
 * Large Dataset Generator for Performance Testing
 *
 * This utility generates test conversations with configurable:
 * - Number of messages (e.g., 1k/5k/10k)
 * - Branching factor (occasional forks)
 * - Mix of user/assistant messages
 *
 * Runs entirely offline with mock content.
 * Only available in development builds.
 */

import { generateId } from '@/db/database'
import type { Conversation, Message } from '@/db/types'

/** Configuration for dataset generation */
export interface DatasetConfig {
  /** Number of messages to generate (default: 1000) */
  messageCount: number
  /** How often to create a branch (e.g., 0.1 = 10% chance per message) */
  branchingFactor: number
  /** Mix of roles: ratio of user/assistant messages (system is rare) */
  roleDistribution?: {
    user: number      // e.g., 0.5 = 50%
    assistant: number // e.g., 0.49 = 49%
    system: number    // e.g., 0.01 = 1%
  }
  /** Optional seed for reproducible generation */
  seed?: number
  /** Conversation title */
  title?: string
}

/** Result of dataset generation */
export interface GeneratedDataset {
  conversation: Conversation
  messages: Message[]
  stats: {
    totalMessages: number
    userMessages: number
    assistantMessages: number
    systemMessages: number
    branchCount: number
    maxDepth: number
  }
}

/** Default configuration */
export const DEFAULT_CONFIG: DatasetConfig = {
  messageCount: 1000,
  branchingFactor: 0.05,
  roleDistribution: {
    user: 0.5,
    assistant: 0.49,
    system: 0.01,
  },
}

/** Sample content templates for realistic message generation */
const USER_TEMPLATES = [
  'Can you explain how {topic} works?',
  'What are the best practices for {topic}?',
  'I need help understanding {topic}.',
  'How do I implement {topic} in my project?',
  'What is the difference between {topic} and {altTopic}?',
  'Can you provide an example of {topic}?',
  'I\'m having trouble with {topic}. Any suggestions?',
  'What are the common pitfalls when working with {topic}?',
  'Could you elaborate on {topic}?',
  'Is there a better way to handle {topic}?',
]

const ASSISTANT_TEMPLATES = [
  '{topic} is a fundamental concept in {domain}. It works by {explanation}.',
  'To implement {topic}, you should follow these steps: First, {step1}. Then, {step2}.',
  'The key difference between {topic} and {altTopic} is that {comparison}.',
  'Here\'s an example of {topic}:\n\n```\n{code}\n```\n\nThis demonstrates {explanation}.',
  'When working with {topic}, common pitfalls include: {pitfalls}.',
  'Great question! {topic} is important because {reason}. Let me explain further...',
  'Based on best practices, you should consider {recommendation} when dealing with {topic}.',
  'I understand the confusion. {topic} can be tricky. Here\'s a clearer explanation: {explanation}.',
  'To address your question about {topic}: {answer}. Does that help clarify things?',
  'Let me break down {topic} into simpler parts: {breakdown}.',
]

const SYSTEM_TEMPLATES = [
  'You are a helpful assistant focused on {domain}.',
  'Respond concisely and accurately about {topic}.',
  'Format your responses with clear structure and examples.',
]

const TOPICS = [
  'async/await', 'promises', 'closures', 'prototypes', 'event loop',
  'TypeScript generics', 'Vue reactivity', 'React hooks', 'state management',
  'IndexedDB', 'Web Workers', 'Service Workers', 'WebSockets', 'REST APIs',
  'GraphQL', 'authentication', 'authorization', 'encryption', 'caching',
  'performance optimization', 'virtual DOM', 'tree shaking', 'code splitting',
  'lazy loading', 'SSR', 'hydration', 'routing', 'form validation',
  'error handling', 'testing strategies', 'CI/CD', 'Docker', 'Kubernetes',
]

const DOMAINS = [
  'web development', 'software engineering', 'frontend development',
  'backend development', 'full-stack development', 'DevOps', 'cloud computing',
]

/**
 * Simple seeded random number generator for reproducible results
 */
class SeededRandom {
  private seed: number

  constructor(seed: number) {
    this.seed = seed
  }

  next(): number {
    // Linear congruential generator
    this.seed = (this.seed * 1664525 + 1013904223) % 4294967296
    return this.seed / 4294967296
  }

  choice<T>(array: readonly T[]): T {
    const index = Math.floor(this.next() * array.length)
    return array[index] as T
  }

  shuffle<T>(array: T[]): T[] {
    const result = [...array]
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1))
      const temp = result[i] as T
      result[i] = result[j] as T
      result[j] = temp
    }
    return result
  }
}

/**
 * Generate a random message content based on role
 */
function generateContent(role: Message['role'], rng: SeededRandom): string {
  const topic = rng.choice(TOPICS)
  const altTopic = rng.choice(TOPICS.filter(t => t !== topic))
  const domain = rng.choice(DOMAINS)

  let template: string
  switch (role) {
    case 'user':
      template = rng.choice(USER_TEMPLATES)
      break
    case 'assistant':
      template = rng.choice(ASSISTANT_TEMPLATES)
      break
    case 'system':
      template = rng.choice(SYSTEM_TEMPLATES)
      break
  }

  // Simple template substitution
  return template
    .replace('{topic}', topic)
    .replace('{altTopic}', altTopic)
    .replace('{domain}', domain)
    .replace('{explanation}', `utilizing ${rng.choice(TOPICS)} patterns`)
    .replace('{step1}', `set up your ${rng.choice(TOPICS)} configuration`)
    .replace('{step2}', `integrate with ${rng.choice(TOPICS)}`)
    .replace('{comparison}', `the former focuses on ${rng.choice(DOMAINS)} while the latter emphasizes ${rng.choice(DOMAINS)}`)
    .replace('{code}', `const example = async () => {\n  // ${topic} implementation\n}`)
    .replace('{pitfalls}', `overlooking ${rng.choice(TOPICS)} and misunderstanding ${rng.choice(TOPICS)}`)
    .replace('{reason}', `it directly impacts ${rng.choice(DOMAINS)}`)
    .replace('{recommendation}', `implementing ${rng.choice(TOPICS)}`)
    .replace('{answer}', `This works by leveraging ${rng.choice(TOPICS)}`)
    .replace('{breakdown}', `1) Core concept: ${rng.choice(TOPICS)}, 2) Application: ${rng.choice(DOMAINS)}`)
}

/**
 * Generate a branch title
 */
function generateBranchTitle(rng: SeededRandom): string {
  const prefixes = ['Exploring', 'Alternative for', 'Deep dive into', 'Follow-up on', 'Clarifying']
  const topic = rng.choice(TOPICS)
  return `${rng.choice(prefixes)} ${topic}`
}

/**
 * Generate a timestamp offset from base time
 */
function generateTimestamp(baseTime: Date, offsetMinutes: number): string {
  const time = new Date(baseTime.getTime() + offsetMinutes * 60000)
  return time.toISOString()
}

/**
 * Choose a role based on distribution
 */
function chooseRole(distribution: NonNullable<DatasetConfig['roleDistribution']>, rng: SeededRandom): Message['role'] {
  const rand = rng.next()
  if (rand < distribution.system) return 'system'
  if (rand < distribution.system + distribution.user) return 'user'
  return 'assistant'
}

/**
 * Generate a large dataset for performance testing
 */
export function generateDataset(config: Partial<DatasetConfig> = {}): GeneratedDataset {
  const fullConfig: DatasetConfig = { ...DEFAULT_CONFIG, ...config }
  const { messageCount, branchingFactor, roleDistribution, seed, title } = fullConfig

  const rng = new SeededRandom(seed ?? Date.now())
  const baseTime = new Date()

  // Create conversation
  const conversationId = generateId()
  const conversation: Conversation = {
    id: conversationId,
    title: title ?? `Test Conversation (${messageCount} messages)`,
    createdAt: baseTime.toISOString(),
    updatedAt: baseTime.toISOString(),
  }

  const messages: Message[] = []
  const messagesByParent: Map<string | null, Message[]> = new Map()
  let branchCount = 0
  let maxDepth = 0

  // Track available parent nodes for branching
  const availableParents: Message[] = []
  let currentParent: Message | null = null
  let currentDepth = 0

  // Stats
  let userMessages = 0
  let assistantMessages = 0
  let systemMessages = 0

  for (let i = 0; i < messageCount; i++) {
    // Decide if we should branch
    const shouldBranch = availableParents.length > 0 && rng.next() < branchingFactor

    if (shouldBranch) {
      // Pick a random parent to branch from
      const branchParent = rng.choice(availableParents)
      currentParent = branchParent
      branchCount++

      // Calculate depth to this parent
      let depth = 0
      let p: Message | null = branchParent
      while (p) {
        depth++
        const parentId: string | null = p.parentId
        p = parentId ? messages.find(m => m.id === parentId) ?? null : null
      }
      currentDepth = depth
    }

    // Choose role (first message is usually system, then alternate user/assistant)
    let role: Message['role']
    if (i === 0 && rng.next() < 0.3) {
      // 30% chance first message is system
      role = 'system'
    } else if (currentParent?.role === 'user') {
      // After user, usually assistant
      role = rng.next() < 0.95 ? 'assistant' : 'user'
    } else if (currentParent?.role === 'assistant') {
      // After assistant, usually user
      role = rng.next() < 0.95 ? 'user' : 'assistant'
    } else {
      role = chooseRole(roleDistribution!, rng)
    }

    // Track stats
    if (role === 'user') userMessages++
    else if (role === 'assistant') assistantMessages++
    else systemMessages++

    // Create message
    const message: Message = {
      id: generateId(),
      conversationId,
      parentId: currentParent?.id ?? null,
      role,
      content: generateContent(role, rng),
      createdAt: generateTimestamp(baseTime, i),
      updatedAt: generateTimestamp(baseTime, i),
    }

    // Add branch title for branch points
    if (shouldBranch && rng.next() < 0.7) {
      message.branchTitle = generateBranchTitle(rng)
    }

    messages.push(message)

    // Track parent-child relationships
    if (!messagesByParent.has(message.parentId)) {
      messagesByParent.set(message.parentId, [])
    }
    messagesByParent.get(message.parentId)!.push(message)

    // Add to available parents (for future branching)
    availableParents.push(message)

    // Update current parent for next iteration (continue linear chain)
    currentParent = message
    currentDepth++
    maxDepth = Math.max(maxDepth, currentDepth)
  }

  return {
    conversation,
    messages,
    stats: {
      totalMessages: messages.length,
      userMessages,
      assistantMessages,
      systemMessages,
      branchCount,
      maxDepth,
    },
  }
}

/**
 * Validate that a generated dataset forms a valid tree
 * Used for testing the generator itself
 */
export function validateDataset(dataset: GeneratedDataset): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  const { conversation, messages } = dataset

  // Check all messages belong to the conversation
  for (const msg of messages) {
    if (msg.conversationId !== conversation.id) {
      errors.push(`Message ${msg.id} has wrong conversationId`)
    }
  }

  // Build ID set for reference checking
  const messageIds = new Set(messages.map(m => m.id))

  // Check parent references are valid
  for (const msg of messages) {
    if (msg.parentId !== null && !messageIds.has(msg.parentId)) {
      errors.push(`Message ${msg.id} references non-existent parent ${msg.parentId}`)
    }
  }

  // Check for cycles (should not exist in a tree)
  function hasCycle(msgId: string, visited: Set<string>): boolean {
    if (visited.has(msgId)) return true
    visited.add(msgId)
    const msg = messages.find(m => m.id === msgId)
    if (msg?.parentId) {
      return hasCycle(msg.parentId, visited)
    }
    return false
  }

  for (const msg of messages) {
    if (hasCycle(msg.id, new Set())) {
      errors.push(`Cycle detected involving message ${msg.id}`)
    }
  }

  // Check there's at least one root
  const roots = messages.filter(m => m.parentId === null)
  if (roots.length === 0 && messages.length > 0) {
    errors.push('No root messages found')
  }

  // Check timestamps are valid ISO strings
  for (const msg of messages) {
    if (isNaN(Date.parse(msg.createdAt))) {
      errors.push(`Message ${msg.id} has invalid createdAt timestamp`)
    }
    if (isNaN(Date.parse(msg.updatedAt))) {
      errors.push(`Message ${msg.id} has invalid updatedAt timestamp`)
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Check if we're in development mode
 */
export function isDevMode(): boolean {
  return import.meta.env.DEV === true
}

/**
 * Persist generated dataset to IndexedDB
 * Creates the conversation and all messages in a transaction
 */
export async function persistDataset(
  dataset: GeneratedDataset,
  database?: import('@/db/database').BonsaiDatabase
): Promise<{ conversationId: string; messageCount: number }> {
  const { db } = await import('@/db/database')
  const targetDb = database ?? db

  await targetDb.transaction('rw', [targetDb.conversations, targetDb.messages], async () => {
    // Add conversation
    await targetDb.conversations.add(dataset.conversation)

    // Bulk add messages (much faster than individual inserts)
    await targetDb.messages.bulkAdd(dataset.messages)
  })

  return {
    conversationId: dataset.conversation.id,
    messageCount: dataset.messages.length,
  }
}

/**
 * Preset configurations for common test scenarios
 */
export const PRESET_CONFIGS = {
  small: {
    messageCount: 100,
    branchingFactor: 0.05,
    title: 'Small Test (100 messages)',
  },
  medium: {
    messageCount: 1000,
    branchingFactor: 0.05,
    title: 'Medium Test (1K messages)',
  },
  large: {
    messageCount: 5000,
    branchingFactor: 0.03,
    title: 'Large Test (5K messages)',
  },
  stress: {
    messageCount: 10000,
    branchingFactor: 0.02,
    title: 'Stress Test (10K messages)',
  },
} as const

export type PresetName = keyof typeof PRESET_CONFIGS
