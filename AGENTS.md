# AGENTS

## Commands

### VSCode Extension (`packages/vscode-extension`)
- `npm run compile-tests` - compile TypeScript (includes protocol build)
- `npm run lint` - run ESLint
- `npm test` - run full test suite

## Testing and Definition of Done

### TDD Workflow (mandatory)
1. **Write failing tests first** - create tests that fail because the feature doesn't exist yet
2. **Implement the feature** - write minimal code to make tests pass
3. **Run tests until green** - you are done only when all tests pass
4. **Refactor if needed** - clean up while keeping tests green

### Test Organization
- Use `__tests__` folder for test files
- Use `*.test.ts` naming convention

### Definition of Done
- All tests pass (`npm test`)
- Code compiles without errors (`npm run compile`)
- Lint passes (`npm run lint`)
- Implementation matches the approved plan

## Architecture and Complexity
- Keep solutions simple; avoid unnecessary complexity.
- Keep dependencies at an absolute minimum; get approval before adding any new dependency.
- Always commit `package-lock.json` when adding or updating dependencies.
- Split domain logic from technical/infrastructure concerns (DDD).
- Keep business rules in domain modules with minimal dependencies.
- Keep adapters, IO, and framework code in separate technical layers.

## Performance and Memory
- Before adding new operations (process spawning, network calls, file I/O), check if existing data or caches can be reused. Prefer O(1) lookups over spawning new processes.
- Caches and in-memory data structures must not grow unboundedly over the extension's lifetime. Prefer replacing data (e.g., rebuilding a Set on change) over appending to ever-growing collections.
- When data is already being fetched elsewhere (e.g., `git ls-files` for the hash index), derive additional structures from that same result rather than issuing separate commands.

## Code Style (provisional until tooling exists)
- Prefer small, focused functions and modules.
- Keep files short and cohesive; split when they grow.
- Favor explicit names over clever abbreviations.
- Naming matters across files, methods, and variables; rename when semantics change so intent stays clear.
- Handle errors explicitly and close to the source.
- Keep imports minimal and grouped by source.

## Editor/Agent Rules
- For implementation requests: analyze current state, propose a clear plan, and get approval before making changes.
- When appropriate, propose more than one implementation option.
- ALWAYS use conventional commit messages when committing.
- Never push to remotes.
- Commit only when explicitly asked.
- No Cursor rules or Copilot instructions found in this repo.
