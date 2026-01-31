# Bonsai - Branching Conversations with AI

Bonsai is a local-first Progressive Web App (PWA) for having branching conversations with AI models via NanoGPT. Unlike linear chat interfaces, Bonsai allows you to explore multiple conversation paths, branch from any message, and maintain full control over your conversation context.

All your data is stored locally in your browser using IndexedDB. There is no backend server - your conversations and API key never leave your device (except when making requests to NanoGPT's API).

## Features

- **Branching Conversations**: Create alternative paths from any message
- **Tree Navigation**: Visual tree view of all conversation branches
- **Context Control**: Pin messages from other branches, exclude messages from context
- **Multiple AI Models**: Support for Claude, GPT-4, Llama, and more via NanoGPT
- **Web Search**: Optional web search integration for supported models
- **Split View**: Compare branches side-by-side
- **Graph View**: Visual tree exploration
- **Optional Encryption**: Passphrase-based local encryption
- **Export/Import**: Backup and restore conversations as JSON
- **Offline Support**: App shell loads offline; data persists locally
- **Privacy First**: No backend, all data stays in your browser

## Security & Privacy

### Local-First Architecture

Bonsai stores all data locally in your browser:

| Data | Storage | Notes |
|------|---------|-------|
| Conversations | IndexedDB | Never sent to any server |
| API Key | localStorage | Only sent to NanoGPT API |
| App Settings | localStorage | Local only |

### Optional Encryption

You can enable passphrase-based encryption in Settings:
- **Algorithm**: AES-256-GCM with PBKDF2 key derivation
- **Protection**: Encrypts conversation content and titles at rest
- **Limitation**: Protects against casual inspection, not against malware with memory access

See [SECURITY.md](SECURITY.md) for the full threat model.

### Important Security Notes

> **Never share your API key in issues, screenshots, or public forums.**
>
> If you accidentally expose your API key, rotate it immediately at [nano-gpt.com](https://nano-gpt.com).

## Getting Started

### Prerequisites

- Node.js 18+
- npm
- A NanoGPT API key from [nano-gpt.com](https://nano-gpt.com)

### Local Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Open in browser
open http://localhost:5173
```

### Available Commands

```bash
# Development
npm run dev              # Start dev server with HMR

# Building
npm run build            # Production build
npm run preview          # Preview production build

# Testing
npm test                 # Run unit tests (Vitest)
npm run test:e2e         # Run E2E tests (Playwright)

# Code Quality
npm run lint             # ESLint
npm run format           # Prettier
npm run type-check       # TypeScript type checking
```

## Deployment

### GitHub Pages (Current)

The app is automatically deployed to GitHub Pages on every push to `main`:

1. CI runs tests and type checking
2. Build runs with `/Bonsai/` base path
3. Deploy publishes to GitHub Pages

**Live URL**: `https://<username>.github.io/Bonsai/`

### Alternative: Cloudflare Pages (Recommended for Custom Domains)

For custom domains with free SSL:

1. Connect your GitHub repo to [Cloudflare Pages](https://pages.cloudflare.com)
2. Configure build settings:
   - Build command: `npm run build`
   - Output directory: `dist`
   - Environment variable: `VITE_BASE_PATH=/` (for custom domain)
3. Add your custom domain in Cloudflare Pages dashboard

Cloudflare Pages provides:
- Free custom domain support
- Automatic SSL certificates
- Global CDN
- Preview deployments for PRs

## Testing

### Unit Tests

```bash
npm test
```

Covers: database operations, tree utilities, context resolution, API client, search utilities.

### E2E Tests

```bash
npm run test:e2e
```

Covers: conversation flow, branching, editing, deletion, search, streaming, encryption.

### Green Bar Rule

All CI checks must pass:
- `npm test` (unit tests)
- `npm run test:e2e` (E2E tests)
- `vue-tsc -b` (type check)

## Referral Disclosure

The NanoGPT link in the app settings may include a referral code. This:
- Supports ongoing development of Bonsai
- Does not cost you anything extra
- Is completely optional - you can get your API key directly from nano-gpt.com

## Architecture

```
src/
├── api/           # NanoGPT client and streaming service
├── components/    # Vue components (tree, timeline, composer, etc.)
├── composables/   # Vue composables (online status, etc.)
├── db/            # Dexie database, repositories, encryption
├── router/        # Vue Router configuration
├── stores/        # Pinia stores
├── utils/         # Search utilities, helpers
└── views/         # Page-level components
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT - see [LICENSE](LICENSE)

## Troubleshooting

### API Key Issues

**"API key not configured"**
1. Go to Settings
2. Enter your NanoGPT API key
3. Save and try again

**"401 Unauthorized"**
- Your API key may be invalid or expired
- Get a new key from [nano-gpt.com](https://nano-gpt.com)

### Offline Behavior

- First visit must be online to cache the app shell
- After first visit, the UI loads offline
- Sending messages requires internet connection

### Data Issues

**App seems broken**
1. Go to Settings > Danger Zone
2. Click "Reset All Data"
3. Type RESET to confirm
