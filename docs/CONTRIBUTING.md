# Contributing to Lobu

## Pull Request Process

All changes must go through pull requests. Direct pushes to main are disabled.

### Creating a Pull Request

1. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**
   - Follow existing code patterns and conventions
   - Use TypeScript for all new code
   - Keep changes focused and atomic

3. **Test your changes**
   ```bash
   # Run tests
   bun test

   # Check formatting and linting
   bun run format
   bun run lint

   # Start the stack and test bot
   make dev
   ./scripts/test-bot.sh "@me test prompt"
   ```

4. **Commit your changes**
   ```bash
   git add .
   git commit -m "feat: descriptive commit message"
   ```

5. **Push to your branch**
   ```bash
   git push origin feature/your-feature-name
   ```

6. **Create Pull Request**
   - Use the PR template
   - Ensure all CI checks pass
   - Request review from maintainers

### Commit Message Format

Follow conventional commits:
- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `style:` Code style changes (formatting, etc)
- `refactor:` Code refactoring
- `test:` Test additions or changes
- `chore:` Maintenance tasks

### Code Review

- PRs require at least one approval before merging
- Address all review comments
- Keep discussions professional and constructive

### CI Requirements

All PRs must pass:
- TypeScript compilation
- Biome formatting and linting
- Unit tests
- Build verification

### After Merging

1. Delete your feature branch
2. Pull latest main locally:
   ```bash
   git checkout main
   git pull origin main
   ```