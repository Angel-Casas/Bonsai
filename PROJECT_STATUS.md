# Bonsai — PROJECT_STATUS

> Purpose: This file is the single source of truth for project progress.
> Any coding agent MUST read this file first before making changes, then update it at the end of each milestone.

## Project Summary
- App name: Bonsai
- Goal: Frontend-only PWA that enables branching conversations with hybrid context control (path + pins + exclusions).
- Tech: Vue 3 + Vite + TypeScript + Tailwind, IndexedDB (Dexie recommended), NanoGPT API integration (streaming).
- No backend.

## Non-Negotiables (Product)
- Branching from any message, infinitely recursive (tree).
- Default context = active path; allow pins from anywhere; allow exclusions from default path.
- Edit/delete rules:
  - If editing a message with descendants: prompt
    - Option A: rewrite history (delete everything after) OR
    - Option B: keep existing future messages and create a new branch from the edited message (variant).
- Clear "Context Preview" so users always know what will be sent to the model.
- Offline-first persistence (IndexedDB).
- Optional encryption later (passphrase-based).

## Current Date / Context
- Today: 2026-02-13
- Notes: Milestone 16 complete. Sync-ready client architecture with append-only ops log, encryption at rest, and SyncAdapter abstraction.

## Definition of Done (Green Bar Rule)
A milestone is **not complete** unless:
- `npm test` passes (0 failures)
- `npm run test:e2e` passes (0 failures)
- `vue-tsc -b` passes (no type errors)

---

## Milestones
### Milestone 0 — Scaffold + tooling
Status: ✅ Done  
- [x] Vue 3 + Vite + TS + Tailwind
- [x] Router + state management (Pinia recommended)
- [x] ESLint + Prettier
- [x] Vitest + Vue Test Utils
- [x] Playwright
- [x] PWA plugin baseline
Notes / decisions:
- Used rolldown-vite (experimental, future default Vite) as scaffolded by create-vite
- Tailwind CSS v4 with @tailwindcss/vite plugin (new approach, no tailwind.config.js needed)
- ESLint flat config (eslint.config.js) with typescript-eslint and eslint-plugin-vue
- happy-dom as test environment for Vitest (lighter than jsdom)
- vite-plugin-pwa for service worker and manifest generation
- Chromium only for Playwright (faster CI, sufficient for smoke tests)

### Milestone 1 — IndexedDB + data layer + tree utilities
Status: ✅ Done  
- [x] Dexie schema + migrations strategy
- [x] Repository layer (CRUD for conversations/messages/revisions/context configs)
- [x] Pure tree utilities (path, branch, delete subtree, variants)
- [x] Unit tests for invariants (107 tests passing)
Notes / decisions:
- Used Dexie v4.0.11 with fake-indexeddb for testing
- Schema version 1 with all 4 tables (conversations, messages, messageRevisions, promptContextConfigs)
- Pure tree utilities in treeUtils.ts (framework-agnostic, no DB access)
- DB-integrated tree operations in treeOperations.ts (uses repositories)
- Storage calls centralized in repositories for future encryption layer
- Comprehensive indices for efficient queries (see Data Model below)

### Milestone 2 — Conversation UI + branching MVP
Status: ✅ Done  
- [x] Conversation list/create/rename/delete
- [x] Tree sidebar navigation
- [x] Message timeline view
- [x] Branch-from-any-message UX
- [x] Component tests + e2e happy path
Notes / decisions:
- **Active Cursor Model**: `activeMessageId` determines current position in tree. Timeline shows path from root → active message. New messages are added as children of active message.
- **Navigation State**: Persisted via route params (`/conversation/:id?message=:messageId`). URL updates when active message changes; restored on page load.
- **Branching UX**: Dialog prompts for branch title (optional) and first message content. New branch message gets `branchTitle` field. After creation, UI navigates to the new branch automatically.
- **Tree Rendering**: Recursive `MessageTreeNode` component handles infinite depth. Shows role icons, truncated content, branch indicators for nodes with multiple children.
- **Timeline**: Linear view of path from root to active message. Shows role badges, branch titles, sibling count indicators. Hover reveals branch action.
- **Responsive**: Mobile collapses sidebar (toggle button). Desktop shows sidebar by default with toggle.
- **Pinia Store**: `conversationStore` centralizes state management. Computed properties for `messageMap`, `childrenMap`, `rootMessages`, `timeline`. Actions for CRUD and navigation.
- Unit tests: 115 passing (including 6 new MessageTree tests)
- E2E tests: 6 passing (full branching workflow, rename/delete, breadcrumbs)

### Milestone 3 — Context Builder (path + pins + exclusions) + preview
Status: ✅ Done  
- [x] Context config model persisted per user message
- [x] Resolved context snapshot persisted per user message
- [x] Context Builder UI + preview
- [x] Tests for deterministic ordering and preview correctness
Notes / decisions:
- **Context Resolution Algorithm**: Pure function `resolveContext()` implements PATH_THEN_PINS ordering. Path is computed from root to active message, optionally truncated by `startFromMessageId` anchor, with exclusions removed. Pins are deduplicated against path, sorted by createdAt (ascending) with id as tiebreaker.
- **Schema**: Extended `PromptContextConfig` with `startFromMessageId` (anchor), `orderingMode` defaults to 'PATH_THEN_PINS'. Added `resolvedContextMessageIds` snapshot persisted at send time.
- **Context Builder UI**: Collapsible panel in ConversationView near composer. Shows path messages with exclude checkboxes, anchor controls ("Start context from here"), pin search with message picker, and real-time preview of resolved context.
- **Coherence Warnings**: Non-blocking warnings when assistant messages lack their preceding user message (e.g., due to exclusion or truncation).
- **Data Flow**: Context config stored per user message via `conversationStore.addMessage()`. Config and resolved snapshot persisted to IndexedDB when message is sent.
- Unit tests: 25 tests for `resolveContext()` covering all edge cases (path only, anchor truncation, exclusions, pin deduplication, pin ordering, mixed scenarios, coherence warnings)
- E2E test: New test for context builder workflow (pin, exclude, preview, send)

### Milestone 4 — NanoGPT integration + streaming + model selection
Status: ✅ Done  
- [x] Settings screen for NanoGPT API key (localStorage)
- [x] NanoGPT API client with SSE streaming parser
- [x] Conversation default model + per-message override UX
- [x] Web-search mode toggle with presets (Standard :online, Deep :online/linkup-deep)
- [x] Message type extended with model tracking fields
- [x] Unit tests for payload building + SSE parsing (26 tests)
- [x] E2E tests for model selection + settings (10 tests)
- [x] Wire ConversationView to send resolved context via NanoGPT
- [x] Stream assistant responses + rate-limited persistence
- [x] Stop generation button functionality
Notes / decisions:
- **API Key Storage**: localStorage (`bonsai:nanogpt:apiKey`) — not encrypted, but local-only and never sent to any server except NanoGPT.
- **Default Model**: `chatgpt-4o-latest` — set in `src/api/nanogpt.ts`, configurable in conversation's `defaultModel` field.
- **Model Selection UX**: Two-tier approach: (1) Conversation default in header (future), (2) Composer has "next message override" that resets after send.
- **Web Search Presets**: Data-driven `SEARCH_PRESETS` array with suffix configuration. Standard uses `:online`, Deep uses `:online/linkup-deep`.
- **Message Schema**: Extended `Message` type with `modelRequested`, `modelRespondedWith`, `webSearchMode`, `searchPreset`, `requestId`, `streamingStatus`, `streamingError`.
- **SSE Parser**: Pure function `parseSSELine()` handles `data:` prefix, `[DONE]` marker, malformed JSON gracefully.
- **Effective Model**: `buildEffectiveModel(base, webSearch, preset)` computes final model string with suffix.
- **Streaming Service**: `src/api/streamingService.ts` orchestrates the full send flow — creates assistant placeholder, builds context from resolved snapshot, streams via NanoGPT, handles callbacks.
- **Resolved Context Usage**: `buildContextMessages()` retrieves `resolvedContextMessageIds` from user message's `PromptContextConfig`, fetches messages in order, converts to NanoGPT format.
- **Rate-Limited Persistence**: `createThrottledPersistence()` buffers streaming content, persists to IndexedDB at most every 500ms, always persists on complete/abort/error.
- **Abort Handling**: AbortController pattern allows "Stop generating" button to cancel mid-stream. Partial content is safely persisted with `streamingStatus: 'aborted'`.
- **Assistant Message Location**: Created as child of user message being sent. After completion, active cursor moves to assistant message.
- **Error Handling**: Missing API key shows error banner with "Go to Settings" button. 401/403 errors show authentication error message. Network errors display message and keep user message intact.
- **UI State During Streaming**: Send button replaced with Stop button, streaming indicator shown, composer disabled.
- Unit tests: 178 passing (12 new for throttled persistence)
- E2E tests: 18 passing (8 new for streaming flow, stop, persistence, errors)

### Milestone 5 — Editing/deletion rules + revisions
Status: ✅ Done  
- [x] Delete message + subtree behavior (with confirmation)
- [x] Edit in place if no descendants (record revision)
- [x] Edit with descendants → prompt Option A or B
- [x] Variant message semantics implemented for Option B
- [x] Tests (unit + e2e)
Notes / decisions:
- **Hard delete approach**: Chose hard delete for subtrees (not soft delete). Simpler UX — deleted messages are gone. Related `PromptContextConfig` and `MessageRevision` records are also deleted via cascading in `deleteSubtree()`.
- **Edit modal UX**: Simple edit dialog for leaf messages (no descendants). Option A/B dialog for messages with descendants — shows clear explanation of each option with visual distinction (red for Option A destructive rewrite, green for Option B safe branching).
- **Variant placement**: Option B creates variant as sibling of original message (same `parentId`). Sets `variantOfMessageId` to original and `branchTitle` defaults to "Edited" (user can customize).
- **Streaming protection**: Edit/delete actions are disabled while streaming. Cannot edit the currently streaming message. This prevents data inconsistency.
- **Revision recording**: All edits create a `MessageRevision` with previous content, timestamp, and optional reason. Option A uses reason "rewrite-history".
- **Delete confirmation**: Shows count of messages to be deleted ("This will delete X messages"). Single message deletion shows simpler confirmation.
- **Active cursor after deletion**: If deleted subtree included active message, cursor moves to parent of deleted root (or finds latest leaf if no parent).

### Milestone 6 — Search/filter + polish (MVP ship)
Status: ✅ Done  
- [x] Search branch titles
- [x] Search message content (basic substring)
- [x] Jump-to result with visual highlight
- [x] Breadcrumbs / path clarity (already implemented in M2)
- [x] MVP release checklist
Notes / decisions:
- **Search Implementation**: Created `searchUtils.ts` with pure `searchMessages()` function for case-insensitive substring matching on both message content and branch titles.
- **Search Ordering**: Results ordered by createdAt ascending with id as tiebreaker for stable, deterministic ordering. Default limit of 50 results.
- **Dual Match Results**: When a message matches in both branchTitle and content, two results are returned (one for each match type) to clearly show where the match occurred.
- **Jump-to Navigation**: Clicking a search result sets active message, closes search panel, and briefly highlights the jumped-to message with yellow border/ring animation (2 seconds).
- **Keyboard Shortcuts**: Cmd/Ctrl+F opens search panel (when not in input/textarea). Escape closes panel.
- **Debounced Search**: 150ms debounce on search input to prevent excessive filtering during rapid typing.
- **Breadcrumbs**: Already clickable with branch titles shown from Milestone 2 - no changes needed.

### Milestone 6.1 — MVP Hardening / Release Prep
Status: ✅ Done  
- [x] PWA installability + offline behavior
- [x] Data durability (IndexedDB migration safety, schema version display)
- [x] Error/edge-case UX (missing key, offline mid-stream, aborted streams)
- [x] Danger Zone recovery options (reset local data)
- [x] Release documentation (README.md)
- [x] E2E tests for hardening features
Notes / decisions:
- **Offline Indicator**: Global banner in App.vue shows when browser is offline. Uses `useOnlineStatus` composable for reactive online/offline detection.
- **Navigation Away Mid-Stream**: Auto-abort behavior — when user navigates away from a conversation while streaming, the stream is automatically aborted and the assistant message is marked with `streamingStatus: 'aborted'`. This ensures consistent DB state.
- **Data Integrity Check**: Non-destructive integrity check (`runIntegrityCheck()`) detects orphan messages, missing parents, orphan configs, and orphan revisions. Shows results in Settings with detailed issue list.
- **Schema Version Display**: Settings shows database name and schema version for debugging and support.
- **Danger Zone**: Three-tier reset options in Settings:
  - Clear API Key Only — removes stored NanoGPT API key
  - Clear Conversations Only — deletes IndexedDB database
  - Reset All Data — full factory reset with confirmation dialog (must type "RESET" to confirm)
- **Service Worker**: Default Workbox config from vite-plugin-pwa caches app shell. NanoGPT API requests are NOT cached (network-only) to prevent stale/confusing streaming behavior.
- **E2E Tests**: 7 new tests covering reset flow, integrity check, offline indicator, and danger zone functionality.

### Milestone 9 — Export/import + archival/cleanup
Status: ✅ Done  
- [x] Versioned JSON export format (bonsai-export v1)
- [x] Export all conversations to file download
- [x] Import with full validation and preview
- [x] Import-as-copy mode with ID remapping (safe merge)
- [x] Restore mode with conflict resolution options
- [x] Preserve tree relationships and context snapshots
- [x] Unit tests for export/import (29 tests)
- [x] E2E tests for export/import workflow (4 tests)
Notes / decisions:
- **Export Format v1**: Self-contained JSON with `format: "bonsai-export"`, `version: 1`, timestamp, and all four entity types (conversations, messages, promptContextConfigs, messageRevisions).
- **Export Location**: Settings > Data & Storage > "Export All Data" button triggers download with filename `bonsai-export-YYYY-MM-DD.json`.
- **Import Modes**: Two modes implemented:
  - **Copy mode** (default, safe): Generates new IDs for all entities, remaps all relationships (parentId, variantOfMessageId, config messageIds, snapshot arrays). Existing data untouched.
  - **Restore mode**: Preserves original IDs. Offers conflict resolution: skip duplicates, or overwrite existing.
- **ID Remapping**: `createIdMapping()` generates fresh UUIDs and updates all references: `parentId`, `variantOfMessageId`, `conversationId`, `startFromMessageId`, `pinnedMessageIds`, `excludedMessageIds`, `resolvedContextMessageIds`.
- **Validation**: Full schema validation before import — checks format identifier, version compatibility, required arrays, entity structure, message roles. Shows summary (counts, export date) before confirming.
- **Atomicity**: Import uses Dexie transaction for all-or-nothing behavior. If any insert fails, entire import rolls back.
- **Import UI**: Dialog shows validation results with preview of what will be imported. Progress and results displayed after import.
- **Cleanup Feature**: Storage counts already shown via integrity check (conversations, messages, configs, revisions). "Clear Conversations" in Danger Zone serves as bulk delete. Archive feature deferred (schema bump not needed for MVP).

### Milestone 10 — Optional local encryption (passphrase)
Status: ✅ Done  
- [x] WebCrypto-based encryption (PBKDF2 + AES-GCM)
- [x] Encryption metadata storage with versioned KDF params
- [x] Encrypt sensitive fields (Message:content, Message:branchTitle, Conversation:title)
- [x] Lock/unlock UI with passphrase input
- [x] Enable encryption migration (plaintext → encrypted)
- [x] Disable encryption migration (encrypted → plaintext)
- [x] Change passphrase flow with re-encryption
- [x] Encryption section in Settings with status display
- [x] LockScreen component for locked state
- [x] API key encryption support
- [x] Unit tests for crypto utilities (24 tests)
- [x] E2E tests for encryption flow (7 tests)
Notes / decisions:
- **Crypto algorithms**: PBKDF2 with SHA-256 for key derivation (100,000 iterations default), AES-GCM for encryption (256-bit key, random 12-byte IV per encryption)
- **Storage pattern**: Encrypted fields use `contentEnc`/`contentIv` variant pattern (Pattern A from spec). Ciphertext stored as base64.
- **Metadata storage**: `bonsai:encryption:metadata` localStorage key stores salt, iterations, version, enabledAt, and keyHash for passphrase verification
- **Session key handling**: Derived CryptoKey kept in memory only (`sessionKey`). Cleared on lock or page unload.
- **Lock behavior**: Manual lock via Settings or automatic on page refresh (sessionKey is in-memory only)
- **Passphrase requirements**: Minimum 8 characters, never stored or logged
- **Export behavior (MVP)**: Export requires unlock state, exports decrypted data with warning
- **Search behavior (MVP)**: Search operates on decrypted content when unlocked; disabled when locked
- **Threat model**: Protects data at rest against casual local inspection. Does NOT protect against fully compromised runtime environment (as documented in Settings)

### Milestone 7 — Split View (multi-branch viewing)
Status: ✅ Done  
- [x] Two-pane split view for comparing branches side-by-side
- [x] Independent navigation per pane (each has own activeMessageId)
- [x] View mode toggle (Single/Split) in conversation header
- [x] Pane focus indicator in sidebar (tree clicks affect focused pane)
- [x] Swap panes navigation helper
- [x] URL params for split view state (?paneA=:id&paneB=:id&focus=A|B)
- [x] Streaming constraints (only one pane can stream at a time)
- [x] Model indicator per pane header
- [x] Unit tests for pane state independence (24 tests)
- [x] E2E tests for split view workflow (11 tests)
Notes / decisions:
- **State Model**: `splitViewStore` manages `splitViewEnabled`, `paneA.activeMessageId`, `paneB.activeMessageId`, `focusedPane` ('A'|'B'), and `streamingPane`.
- **Pane Independence**: Each pane maintains its own activeMessageId. Setting one pane's position does not affect the other.
- **Focus Logic**: Clicking in a pane sets it as focused. Tree sidebar clicks navigate the focused pane. Clear visual indicator shows which pane will receive navigation.
- **Context Configuration**: Shared context config approach (simpler MVP) - both panes share the same context builder settings. Documented as design decision.
- **Streaming Behavior**: Only one pane can stream at a time. While streaming, the other pane's send button is disabled with clear message ("Send disabled — other pane is streaming").
- **URL Persistence**: Split view state persists in URL query params for reload/share. When disabled, params are cleaned up.
- **Swap Helper**: Quick swap button exchanges pane A and B positions, useful for comparing from different viewpoints.

### Milestone 8 — Graph View Explorer
Status: ✅ Done  
- [x] SVG-based graph visualization of conversation tree
- [x] Interactive pan/zoom via mouse drag and scroll wheel
- [x] Click nodes to jump to message (updates activeMessageId and URL)
- [x] Density controls (branch roots only toggle, depth limit selector)
- [x] Tooltip showing role, content snippet, branchTitle, timestamp
- [x] Visual distinction for branch roots and active/highlighted nodes
- [x] Three-way view mode toggle (Tree/Split/Graph)
- [x] URL persistence for graph view (?view=graph)
- [x] Unit tests for graph layout utilities (23 tests)
- [x] E2E tests for graph view workflow (12 tests)
Notes / decisions:
- **Rendering approach**: Pure SVG rendering with no external graph libraries. Lightweight, deterministic, and framework-agnostic layout algorithm.
- **Layout algorithm**: Top-down tree layout with subtree width calculation for proper horizontal spacing. Deterministic: same input always produces same positions.
- **Density controls**: Two options implemented: (1) "Branch roots only" toggle shows roots, branch points, leaves, and siblings; (2) Depth limit dropdown (3/5/10/20/All) limits visible tree depth.
- **Pan/zoom**: Mouse drag to pan, scroll wheel to zoom (zoom towards cursor). Reset and Center buttons for quick navigation.
- **Node appearance**: Circles colored by role (emerald for user, blue for assistant, gray for system). Role emoji icons inside nodes. Branch title badges above branch root nodes.
- **Active node highlight**: Yellow stroke for active message, amber for highlighted (search result). White stroke for branch roots.
- **Navigation integration**: Clicking a node calls `store.setActiveMessage()` and applies highlight animation (same as search jump-to behavior). URL updates with message param.
- **Encryption support**: Graph view respects encryption state - shows empty content if locked (handled by existing store decryption layer).
- **Performance note**: Layout computed via Vue computed property (memoized). Only recomputes when messages array or filter options change.

### Milestone 11 — Performance + Scalability
Status: ✅ Done
- [x] Large Dataset Dev Tool: Generate test datasets (100/1k/5k/10k messages)
- [x] Timeline Virtualization: Virtual scrolling for 5k+ message timelines
- [x] Tree Sidebar Optimization: Collapse/expand controls with auto-collapse for large trees
- [x] Search Performance: In-memory cache with progressive search for large datasets
- [x] Graph View Scalability: Auto-enable filters for large datasets (>500 messages)
- [x] Encryption Performance: Decryption cache to prevent repeated decryption
- [x] Observability Panel: Dev-only diagnostics showing cache stats and memory usage
- [x] Performance Tests: Unit tests for generator/caching + e2e tests for large datasets
Notes / decisions:
- **Dataset Generator**: `datasetGenerator.ts` with seeded random for deterministic test data. Presets: small (100), medium (1000), large (5000), stress (10000). UI in Settings Dev Tools section.
- **Virtual Scrolling**: Custom `VirtualScroller.vue` component for timeline. Activates for conversations with 50+ messages. Uses binary search for visible range calculation.
- **Tree Optimization**: Chose collapse/expand controls over virtualization (Option B from spec). Auto-collapses to active path when tree exceeds 200 messages. Shows visible/total node count.
- **Search Cache**: `searchCache.ts` provides in-memory caching of searchable text. Cleared on encryption lock (security requirement). Progressive search with chunked async processing.
- **Graph Auto-Defaults**: Threshold of 500 messages triggers auto-enable of "branch roots only" filter. 1000+ messages also limits depth to 10. Visual indicator shows when auto-defaults are active.
- **Decryption Cache**: In-memory cache in `encryptionService.ts` stores decrypted content by ciphertext checksum. Max 10,000 entries. Cleared on lock() for security.
- **Diagnostics Panel**: Shows search cache stats (enabled/populated/entries), decryption cache stats (size/max), and JS heap memory usage (when available). Refresh button updates data.
- Unit tests: 53 new tests (23 for dataset generator, 30 for search cache)
- E2e tests: 5 new tests for large dataset handling

### Milestone 13 — Public Launch Polish
Status: ✅ Done
- [x] First-run guardrails: API key missing guidance with disabled send button and status message
- [x] First-run guardrails: "Set API key now" button appears on auth errors (401/403)
- [x] First-run guardrails: Deep search cost warning banner
- [x] Context clarity: Context summary pill near composer
- [x] Context clarity: "Sent Context" viewer for past messages (SentContextViewer component)
- [x] Offline UX: Disable send button when offline with status message
- [x] Offline UX: Handle streaming abort gracefully
- [x] Supportability: "Copy Debug Info" button in Settings
- [x] Supportability: Debug info excludes sensitive data (API keys, content, passphrases)
- [x] Unit tests: debugInfo utility tests (14 tests), SentContextViewer tests (6 tests)
- [x] E2E tests: public-launch-polish.spec.ts (12 tests)
Notes / decisions:
- **Fail-fast API key check**: Send button disabled when no API key configured. Status message shows "API key required" with clear guidance. This prevents confusing error states for new users.
- **Auth error flow**: When API call returns 401/403, error banner shows "Set API key now" button that navigates directly to Settings. Includes link to NanoGPT for obtaining a key.
- **Deep search warning**: Amber banner appears when deep search preset is selected: "Deep search is slower and more expensive than standard search".
- **Context summary pill**: Shows near composer with format "Context: X path • Y pinned • Z excluded • anchored". Only visible when context config is active.
- **SentContextViewer**: Modal component showing exact context sent with a past message. Loads from `resolvedContextMessageIds` snapshot in PromptContextConfig. Read-only for trust/debugging.
- **Offline detection**: Uses `useOnlineStatus` composable for reactive online/offline state. Send button disabled with "Cannot send while offline" tooltip.
- **Debug info collection**: `collectDebugInfo()` gathers app version, DB info, encryption state, counts, service worker status, and browser info. `validateNoSecrets()` ensures no sensitive patterns in output.
- **Test approach**: E2E tests verify disabled button state instead of triggering errors by clicking. Auth error tests use invalid API key to trigger actual 401/403 responses.

### Milestone 14 — User Feedback Funnel
Status: ✅ Done
- [x] GitHub issue templates: Bug report template with privacy checklist
- [x] GitHub issue templates: Feature request template with privacy checklist
- [x] GitHub issue templates: config.yml to disable blank issues, link to Discussions
- [x] In-app feedback: "Report Bug" button in Settings (data-testid="report-bug-btn")
- [x] In-app feedback: "Request Feature" button in Settings (data-testid="request-feature-btn")
- [x] Feedback URLs prefilled with privacy warning and debug info
- [x] Privacy safeguards: validateNoSecrets() ensures no sensitive data in URLs
- [x] URL length handling: Truncates debug info if URL would exceed limits
- [x] Unit tests: feedbackUrl.test.ts (13 tests)
- [x] E2E tests: feedback.spec.ts (6 tests)
Notes / decisions:
- **URL builder approach**: Created `src/utils/feedbackUrl.ts` with `buildFeedbackUrl()` function that constructs GitHub issue URLs with proper encoding and content prefilling.
- **Privacy safeguards**: Body content is validated with `validateNoSecrets()` before including in URL. If validation fails, falls back to minimal URL without prefilled body.
- **URL length limits**: GitHub has practical URL limits (~8000 chars). We stay conservative at 4000 chars max, truncating debug info if needed with instruction to paste full output from "Copy Debug Info".
- **Issue templates**: Using YAML format (.yml) for structured form-based templates. Required privacy checkboxes ensure users acknowledge they haven't included sensitive data.
- **Template selection**: URLs include `template=bug_report.yml` or `template=feature_request.yml` query param to auto-select the correct template.
- **New tab behavior**: Feedback buttons open GitHub in a new tab with `noopener,noreferrer` for security.

### Milestone 15 — Release-Candidate Readiness + CI Hardening
Status: ✅ Done
- [x] CI gates: skipped tests fail the build (static check + runtime detection)
- [x] Static check script: `scripts/check-no-skip.sh` detects hard-coded `.skip` and `.only`
- [x] Runtime skip detection: `scripts/check-e2e-no-skip.js` parses Playwright JSON report
- [x] Playwright config: Zero retries for determinism (tests must be stable)
- [x] Enhanced failure artifacts: trace, screenshot, video on failure
- [x] Node version standardization: `.nvmrc` with Node 20, `engines` field in package.json
- [x] CI workflow updated: `node-version-file: '.nvmrc'`, skip checks, artifacts always uploaded
- [x] New npm scripts: `test:e2e:ci` and `check:no-skip`
Notes / decisions:
- **Skip detection philosophy**: Hard-coded skips (test.skip('name'...)) are forbidden in CI. Conditional skips (test.skip() inside test body) are allowed for environment-specific tests (e.g., dev tools only visible in dev mode).
- **Determinism via zero retries**: retries: 0 in playwright.config.ts ensures tests must pass reliably. Flaky tests surface immediately for fixing.
- **Failure artifacts**: trace, screenshot, video retained only on failure to aid debugging while keeping storage minimal for passing runs.
- **JSON reporter for runtime detection**: Playwright JSON report enables post-run analysis of actual test outcomes (skipped/passed/failed) beyond static code analysis.
- **Always upload artifacts**: Changed `if: failure()` to `if: always()` so Playwright report is available even on success for debugging purposes.

### Milestone 16 — Sync-Ready Client Architecture
Status: ✅ Done
- [x] Append-only operations log in IndexedDB (syncOps table, schema v4)
- [x] Op types: conversation.create/rename/delete, message.create/edit/deleteSubtree/createVariant, import.completed
- [x] Ops emitted from store actions (fire-and-forget, non-blocking)
- [x] Op payloads encrypted at rest when encryption enabled (AES-GCM, same service)
- [x] SyncAdapter interface with LocalOnlySyncAdapter implementation
- [x] Sync diagnostics section in Settings (pending count, latest ops, client ID)
- [x] Deterministic ordering: createdAt ASC, id ASC tie-breaker
- [x] Unit tests for opsService (21 tests: op CRUD, ordering, encryption)
- [x] E2E test for sync diagnostics in Settings
Notes / decisions:
- **Op emission location**: Store actions (domain commands), not repositories (pure CRUD). Each store action maps 1:1 to a user-facing command.
- **Encryption**: Full payload encrypted at rest via encryptContent/decryptContent. Same AES-GCM service used for messages.
- **Import strategy**: Single `import.completed` op (Approach A) — server treats import as new baseline.
- **Canonical ordering**: createdAt ASC, id ASC documented as canonical for future replay.
- **Client ID**: UUID in localStorage at `bonsai:sync:clientId`, generated once per device.
- **Non-blocking**: Op writes use `.catch(console.error)` — failures logged but don't block user actions.
- **Schema**: syncOps table with indices on id, status, createdAt, [conversationId+createdAt].

### Post-MVP
- (Future milestone ideas TBD)

---

## Data Model (Implemented)
### Conversation
- id: string (UUID)
- title: string
- createdAt: string (ISO)
- updatedAt: string (ISO)
- defaultModel?: string
- uiState?: Record<string, unknown>
- Indices: id (primary), updatedAt

### Message
- id: string (UUID)
- conversationId: string
- parentId: string | null (null for root)
- role: 'system' | 'user' | 'assistant'
- content: string
- createdAt: string (ISO)
- updatedAt: string (ISO)
- branchTitle?: string (labels a branch root)
- variantOfMessageId?: string (for edit-as-branch / Option B)
- deletedAt?: string (reserved for future soft-delete; currently unused — MVP uses hard delete)
- Indices: id (primary), conversationId, parentId, [conversationId+createdAt], variantOfMessageId

### MessageRevision
- id: string (UUID)
- messageId: string
- previousContent: string
- createdAt: string (ISO)
- reason?: string
- Indices: id (primary), messageId, [messageId+createdAt]

### PromptContextConfig (per USER message)
- messageId: string (primary key, 1:1 with message)
- inheritDefaultPath: boolean
- excludedMessageIds: string[]
- pinnedMessageIds: string[]
- orderingMode: 'PATH_THEN_PINS' | 'chronological' | 'custom' (currently only PATH_THEN_PINS implemented)
- resolvedContextMessageIds?: string[] (snapshot of what was sent)
- Indices: messageId (primary)

### SyncOp (Milestone 16)
- id: string (UUID)
- createdAt: string (ISO)
- conversationId: string | null (null for global ops like import)
- type: OpType (conversation.create/rename/delete, message.create/edit/deleteSubtree/createVariant, import.completed)
- payload: string (JSON; empty when encrypted)
- payloadEnc?: { ciphertext, iv } | null (encrypted payload when encryption enabled)
- status: 'pending' | 'acked' | 'failed'
- clientId: string (stable device identifier from localStorage)
- schemaVersion: number (starts at 1)
- Indices: id (primary), status, createdAt, [conversationId+createdAt]
- Canonical ordering: createdAt ASC, id ASC (tie-breaker)

---

## UI Architecture (Milestone 2)

### Views
- **HomeView** (`/`): Conversation list with create/rename/delete. Empty state when no conversations.
- **ConversationView** (`/conversation/:id`): Main conversation interface with tree sidebar, timeline, and composer.

### Components
- **MessageTree**: Container for tree rendering, passes data to recursive nodes.
- **MessageTreeNode**: Recursive component rendering a node and its children with proper indentation.
- **MessageTimeline**: Linear view of messages in current path with role badges and branch actions.
- **MessageComposer**: Text input with send button and keyboard shortcuts (Cmd/Ctrl+Enter).
- **PathBreadcrumbs**: Horizontal breadcrumb trail showing path with clickable navigation.

### State Management
- **conversationStore** (Pinia): Manages conversations list, active conversation, messages, and navigation state.
  - State: `conversations`, `activeConversation`, `messages`, `activeMessageId`, `isSidebarOpen`, loading flags
  - Computed: `messageMap`, `childrenMap`, `rootMessages`, `timeline`
  - Actions: CRUD operations, navigation, branching

---

## Critical UX Rules (must not regress)
- Users can always see exactly what context will be sent (preview).
- Branch creation is one action from any message.
- Editing with descendants always offers Option A or B.
- Pins/exclusions are obvious and reversible.

---

## Commands (fill in as implemented)
- Dev: `npm run dev`
- Unit tests: `npm run test`
- Unit tests (watch): `npm run test:watch`
- Unit tests (coverage): `npm run test:coverage`
- E2E tests: `npm run test:e2e`
- E2E tests (UI): `npm run test:e2e:ui`
- E2E tests (CI): `npm run test:e2e:ci` — runs tests + checks for skipped tests
- Check for skips: `npm run check:no-skip` — static check for .skip/.only in tests
- Lint: `npm run lint`
- Format: `npm run format`
- Format check: `npm run format:check`
- Type check: `npm run type-check`
- Build: `npm run build`
- Preview: `npm run preview`

---

## Decisions Log
(Keep short, dated entries)
- 2026-01-10: Used rolldown-vite (experimental) — Scaffolded by create-vite, future default for Vite
- 2026-01-10: Tailwind CSS v4 with @tailwindcss/vite — Simpler setup, no config file needed
- 2026-01-10: ESLint flat config — Modern approach, better TypeScript integration
- 2026-01-10: happy-dom over jsdom — Lighter, faster for unit tests
- 2026-01-10: Chromium only for Playwright — Sufficient for smoke tests, faster CI
- 2026-01-10: Dexie v4.0.11 for IndexedDB — Well-maintained, TypeScript-first, good query API
- 2026-01-10: fake-indexeddb for testing — Standard choice, works seamlessly with Dexie
- 2026-01-10: Pure tree utils separate from DB ops — Easier testing, framework-agnostic
- 2026-01-10: Centralized storage in repositories — Enables future encryption layer
- 2026-10-01: Active cursor model for navigation — `activeMessageId` determines timeline path
- 2026-10-01: Route-based navigation state — URL params for conversation ID and message ID
- 2026-10-01: Recursive tree component — `MessageTreeNode` for infinite depth rendering
- 2026-10-01: Branch dialog with title + content — Title optional, content required for new branch

---

## Open Questions / Risks
- Encryption approach (post-MVP): scope and UX (lock/unlock, timeouts, recovery).
- Large-tree performance strategy (virtualization, indexing).

---

## MVP Release Notes

### Build & Test Commands (Pre-Release)
```bash
# Run these before every release
npm run test           # 214 unit tests
npm run test:e2e       # 41 e2e tests (including 7 hardening tests)
npm run type-check     # TypeScript validation
npm run lint           # ESLint checks
npm run build          # Production build
```

### Manual Sanity Checks
Before shipping, manually verify:
1. **Install PWA**: Use browser's "Add to Home Screen" or install prompt
2. **Offline test**: Go offline in DevTools Network tab, verify app shell loads
3. **API key flow**: Add key in Settings, send a message, verify streaming works
4. **Branching**: Create a conversation, add messages, branch from middle message
5. **Reset flow**: Go to Settings > Danger Zone > Reset All Data, confirm data is cleared

### Known Limitations (MVP)
- **No graph view**: Tree shown as indented list, not visual graph
- **Single device**: No cloud sync between devices
- **Model limits**: Only models available through NanoGPT API

### Key Decisions (Milestone 6.1)
- **Offline UX**: Global yellow banner when offline, send still enabled but will fail fast with friendly error
- **Route-change streaming**: Auto-abort behavior — navigating away aborts stream, message saved with 'aborted' status
- **Reset scope**: Three options (API key only, conversations only, full reset) with confirmation dialog for full reset

---

## MVP Release Checklist

Before shipping, manually verify each item:

### Core Functionality
- [ ] **Installable PWA**: App can be installed via browser's "Add to Home Screen" or install prompt
- [ ] **Offline behavior**: App loads and displays existing conversations when offline
- [ ] **Local storage persistence**: Conversations and messages persist across browser sessions
- [ ] **Streaming chat**: Messages stream from NanoGPT API with visible incremental updates
- [ ] **Stop generation**: Stop button successfully cancels mid-stream generation
- [ ] **Branching**: Can create branches from any message with optional title
- [ ] **Editing**: Can edit messages (Option A/B for messages with descendants)
- [ ] **Deletion**: Can delete messages and subtrees with confirmation
- [ ] **Context preview**: Context Builder shows accurate preview of what will be sent

### Search & Navigation
- [ ] **Search opens**: Search button and Cmd/Ctrl+F open search panel
- [ ] **Search finds content**: Searching finds matches in message content
- [ ] **Search finds titles**: Searching finds matches in branch titles
- [ ] **Jump-to works**: Clicking search result navigates to and highlights that message
- [ ] **Search closes**: Escape key and backdrop click close search panel

### Hardening (Milestone 6.1)
- [ ] **Offline banner**: Yellow banner appears when browser goes offline
- [ ] **Settings shows schema version**: Data & Storage section shows BonsaiDB and version 2
- [ ] **Integrity check**: "Check Data Integrity" button works in Settings
- [ ] **Reset dialog**: Reset All Data requires typing "RESET" to confirm

### Test Suite
- [ ] **Unit tests green**: `npm run test` passes all 214 tests
- [ ] **E2E tests green**: `npm run test:e2e` passes all tests (including hardening)
- [ ] **No TypeScript errors**: `npm run type-check` passes
- [ ] **No lint errors**: `npm run lint` passes

---

## Landing Page Variants (2026-01-29)

Four landing page variants implemented with different visual styles:

| Variant | Name | Access |
|---------|------|--------|
| A (default) | Wisteria Wireframe | `/?variant=A` or `/` |
| B | ASCII Terminal | `/?variant=B` |
| C | Blueprint | `/?variant=C` |
| D | Aurora Minimal | `/?variant=D` |

- Legacy landing page preserved at `/landing-legacy`
- Dev-only switcher visible in top-right corner during development
- All variants share same 6-section structure (Hero, Branching Viz, Features, How It Works, FAQ, Footer)
- Three.js lazy-loaded only for Variant A

---

## Release Procedures

### Creating a GitHub Release

1. Ensure all tests pass (Green Bar Rule):
   ```bash
   npm test && npm run test:e2e && npx vue-tsc -b
   ```
2. Update version in `package.json`
3. Update `CHANGELOG.md` with release notes
4. Commit changes: `git commit -m "Release vX.Y.Z"`
5. Create and push tag:
   ```bash
   git tag vX.Y.Z
   git push origin main --tags
   ```
6. Create GitHub Release from the tag with changelog excerpt

### Verifying GitHub Pages Deployment

After pushing to `main`:
1. Check Actions tab for successful workflow runs
2. Visit `https://<username>.github.io/Bonsai/`
3. Verify app loads and basic functionality works
4. Check browser console for errors

### Rotating the Referral Link (if needed)

The NanoGPT referral link is located in:
- `src/views/SettingsView.vue` (line ~519)

To update: change the `href` attribute on the nano-gpt.com link.

### Handling Security Reports

1. Check GitHub Security tab for vulnerability reports
2. For valid reports:
   - Acknowledge within 48 hours
   - Create fix in private fork if needed
   - Release patch version
   - Credit reporter (if they consent)
3. See `SECURITY.md` for full policy

---

## Next Actions (agent should update each time)
- Current milestone: Milestone 16 (complete) — Sync-Ready Client Architecture
- Next 1–3 tasks:
  1. Build Bonsai Sync server (receives ops, broadcasts to clients)
  2. Implement RemoteSyncAdapter (pushes ops to server, receives remote ops)
  3. Conflict resolution UI for concurrent edits
- Blocking issues: None
