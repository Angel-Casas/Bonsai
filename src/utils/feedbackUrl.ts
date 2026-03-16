/**
 * Feedback URL Builder
 *
 * Builds GitHub issue URLs with prefilled content for bug reports and feature requests.
 * Ensures no sensitive data is included in the URL.
 */

import { collectDebugInfo, formatDebugInfo, validateNoSecrets } from './debugInfo'

// Repository information
const GITHUB_REPO = 'Angel-Casas/Bonsai'
const GITHUB_NEW_ISSUE_URL = `https://github.com/${GITHUB_REPO}/issues/new`

// URL length limits (GitHub's practical limit is ~8000 chars, we stay conservative)
const MAX_URL_LENGTH = 4000
const MAX_DEBUG_INFO_LENGTH = 1500

// Privacy warning included in prefilled body
const PRIVACY_WARNING = `> **Privacy Reminder:** Do NOT include your NanoGPT API key or private conversation content below.`

/**
 * Truncates debug info if it exceeds the max length
 */
function truncateDebugInfo(debugInfo: string): string {
  if (debugInfo.length <= MAX_DEBUG_INFO_LENGTH) {
    return debugInfo
  }
  return debugInfo.slice(0, MAX_DEBUG_INFO_LENGTH) + '\n... (truncated - use "Copy Debug Info" for full output)'
}

/**
 * Builds the body content for a bug report
 */
function buildBugReportBody(debugInfo: string): string {
  const truncatedDebug = truncateDebugInfo(debugInfo)

  return `${PRIVACY_WARNING}

## What happened?
<!-- Describe the bug clearly -->

## Steps to reproduce
1.
2.
3.

## Expected behavior
<!-- What did you expect to happen? -->

## Debug Info
\`\`\`
${truncatedDebug}
\`\`\`

---
*If debug info is truncated, please click "Copy Debug Info" in Settings and paste the full output above.*`
}

/**
 * Builds the body content for a feature request
 */
function buildFeatureRequestBody(debugInfo: string): string {
  const truncatedDebug = truncateDebugInfo(debugInfo)

  return `${PRIVACY_WARNING}

## Problem or use case
<!-- Describe the problem this feature would solve -->

## Proposed solution
<!-- Describe your ideal solution -->

## Alternatives considered
<!-- Any workarounds you've tried -->

## Debug Info (optional)
\`\`\`
${truncatedDebug}
\`\`\`
`
}

export interface FeedbackUrlOptions {
  type: 'bug' | 'feature'
}

export interface FeedbackUrlResult {
  url: string
  success: boolean
  error?: string
}

/**
 * Builds a GitHub issue URL with prefilled content.
 * Returns a minimal fallback URL if the content cannot be safely included.
 */
export async function buildFeedbackUrl(options: FeedbackUrlOptions): Promise<FeedbackUrlResult> {
  const { type } = options

  try {
    // Collect debug info
    const info = await collectDebugInfo()
    const formattedDebugInfo = formatDebugInfo(info)

    // Build the body based on type
    const body = type === 'bug'
      ? buildBugReportBody(formattedDebugInfo)
      : buildFeatureRequestBody(formattedDebugInfo)

    // Validate no secrets in the body
    if (!validateNoSecrets(body)) {
      // Fall back to minimal URL without prefilled body
      console.warn('Feedback body contained potential secrets, using minimal URL')
      return buildMinimalUrl(type)
    }

    // Build URL with query params
    const params = new URLSearchParams()
    params.set('template', type === 'bug' ? 'bug_report.yml' : 'feature_request.yml')
    params.set('title', type === 'bug' ? '[Bug]: ' : '[Feature]: ')

    // Check if adding body would exceed URL length
    const urlWithoutBody = `${GITHUB_NEW_ISSUE_URL}?${params.toString()}`
    const encodedBody = encodeURIComponent(body)
    const fullUrl = `${urlWithoutBody}&body=${encodedBody}`

    if (fullUrl.length > MAX_URL_LENGTH) {
      // URL too long, use minimal body with instruction
      const minimalBody = type === 'bug'
        ? `${PRIVACY_WARNING}\n\n## What happened?\n\n## Steps to reproduce\n\n## Debug Info\n*Please click "Copy Debug Info" in Settings and paste here.*`
        : `${PRIVACY_WARNING}\n\n## Problem or use case\n\n## Proposed solution\n\n## Debug Info (optional)\n*Click "Copy Debug Info" in Settings if relevant.*`

      params.set('body', minimalBody)
      return {
        url: `${GITHUB_NEW_ISSUE_URL}?${params.toString()}`,
        success: true,
      }
    }

    return {
      url: fullUrl,
      success: true,
    }
  } catch (error) {
    console.error('Failed to build feedback URL:', error)
    return buildMinimalUrl(type)
  }
}

/**
 * Builds a minimal fallback URL without prefilled content
 */
function buildMinimalUrl(type: 'bug' | 'feature'): FeedbackUrlResult {
  const params = new URLSearchParams()
  params.set('template', type === 'bug' ? 'bug_report.yml' : 'feature_request.yml')

  return {
    url: `${GITHUB_NEW_ISSUE_URL}?${params.toString()}`,
    success: true,
    error: 'Could not prefill content safely',
  }
}

/**
 * Opens a feedback URL in a new tab
 */
export async function openFeedbackUrl(type: 'bug' | 'feature'): Promise<void> {
  const result = await buildFeedbackUrl({ type })
  window.open(result.url, '_blank', 'noopener,noreferrer')
}

// Export constants for testing
export const GITHUB_REPO_PATH = GITHUB_REPO
export const PRIVACY_WARNING_TEXT = PRIVACY_WARNING
