# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-01-31

### Added
- Branching conversations with tree navigation
- Context control: pins, exclusions, anchors
- NanoGPT API integration with streaming
- Multiple AI model support via NanoGPT
- Web search mode for supported models
- Message editing with Option A (rewrite) and Option B (branch variant)
- Message and subtree deletion
- Search across message content and branch titles
- Split view for comparing branches side-by-side
- Graph view for visual tree exploration
- Optional local encryption (passphrase-based)
- Export/import conversations as JSON
- PWA support with offline app shell
- Virtual scrolling for large conversations
- Landing page with multiple visual variants

### Security
- Local-first architecture: no backend server
- Optional AES-GCM encryption for data at rest
- API key stored locally, never sent to third parties
