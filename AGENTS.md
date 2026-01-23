# AGENTS

## Commands
- No build, lint, or test tooling detected yet.
- TODO: document repo-specific commands when tooling is added.
- TODO: include single-test commands for the chosen test runner.

## Testing and Definition of Done
- Always use TDD: write tests first, then implement.
- Always add tests for new behavior and bug fixes.
- Add e2e tests when feasible (for example, VS Code extension flows).
- Use `__tests__` folder naming for test locations.
- Definition of done: all tests pass locally.

## Architecture and Complexity
- Keep solutions simple; avoid unnecessary complexity.
- Keep dependencies at an absolute minimum; get approval before adding any new dependency.
- Split domain logic from technical/infrastructure concerns (DDD).
- Keep business rules in domain modules with minimal dependencies.
- Keep adapters, IO, and framework code in separate technical layers.

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
- Use conventional commit messages when asked to commit changes.
- No Cursor rules or Copilot instructions found in this repo.
