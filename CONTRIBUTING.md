# Contributing to Bonsai

Thank you for your interest in contributing to Bonsai! This document provides guidelines and instructions for contributing.

## Code of Conduct

Please read and follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## How to Contribute

### Reporting Bugs

1. Check if the bug has already been reported in [Issues](https://github.com/angelsflyinhell/Bonsai/issues)
2. If not, create a new issue with:
   - Clear, descriptive title
   - Steps to reproduce
   - Expected vs actual behavior
   - Browser and OS information
   - Screenshots if applicable

**Important:** Never include API keys, personal data, or conversation content in bug reports.

### Suggesting Features

1. Check existing issues and discussions for similar suggestions
2. Create a new issue with the "enhancement" label
3. Describe the feature and its use case clearly

### Pull Requests

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run the test suite:
   ```bash
   npm test
   npm run test:e2e
   npm run type-check
   npm run lint
   ```
5. Commit with clear messages
6. Push to your fork
7. Open a Pull Request

### Development Setup

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/Bonsai.git
cd Bonsai

# Install dependencies
npm install

# Start development server
npm run dev

# Run tests
npm test
npm run test:e2e
```

### Code Style

- TypeScript with strict mode
- Vue 3 Composition API with `<script setup>`
- Follow existing code patterns
- Run `npm run lint` and `npm run format` before committing

### Commit Messages

- Use present tense ("Add feature" not "Added feature")
- Use imperative mood ("Move cursor to..." not "Moves cursor to...")
- Keep first line under 72 characters
- Reference issues when applicable

### Testing

- Add unit tests for new utilities and functions
- Add component tests for new Vue components
- Add E2E tests for new user-facing features
- Ensure all tests pass before submitting PR

## Questions?

Feel free to open a discussion or issue if you have questions about contributing.
