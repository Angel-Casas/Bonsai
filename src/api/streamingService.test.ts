/**
 * Unit tests for streamingService error classification
 */

import { describe, it, expect } from 'vitest'
import { classifyError, MissingApiKeyError } from './streamingService'
import { AuthenticationError } from './nanogpt'

describe('classifyError', () => {
  describe('authentication errors', () => {
    it('classifies AuthenticationError with 401 status', () => {
      const error = new AuthenticationError('Invalid API key', 401)
      const result = classifyError(error)
      
      expect(result.type).toBe('auth')
      expect(result.status).toBe(401)
      expect(result.message).toContain('Authentication error')
      expect(result.message).toContain('401')
      expect(result.message).toContain('API key')
    })

    it('classifies AuthenticationError with 403 status', () => {
      const error = new AuthenticationError('Forbidden', 403)
      const result = classifyError(error)
      
      expect(result.type).toBe('auth')
      expect(result.status).toBe(403)
      expect(result.message).toContain('Authentication error')
      expect(result.message).toContain('403')
    })

    it('classifies MissingApiKeyError as auth type', () => {
      const error = new MissingApiKeyError()
      const result = classifyError(error)
      
      expect(result.type).toBe('auth')
      expect(result.status).toBeUndefined()
      expect(result.message).toContain('API key')
    })
  })

  describe('network errors', () => {
    it('classifies fetch network errors', () => {
      const error = new TypeError('Failed to fetch')
      const result = classifyError(error)
      
      expect(result.type).toBe('network')
      expect(result.message).toContain('Network error')
    })
  })

  describe('unknown errors', () => {
    it('classifies generic Error as unknown', () => {
      const error = new Error('Something went wrong')
      const result = classifyError(error)
      
      expect(result.type).toBe('unknown')
      expect(result.message).toBe('Request failed. Please try again.')
    })

    it('sanitizes error message for UI display', () => {
      const error = new Error('Internal server error with sensitive details: user_id=123')
      const result = classifyError(error)
      
      // Should NOT expose the original error message
      expect(result.type).toBe('unknown')
      expect(result.message).toBe('Request failed. Please try again.')
      expect(result.message).not.toContain('sensitive')
      expect(result.message).not.toContain('user_id')
    })
  })
})
