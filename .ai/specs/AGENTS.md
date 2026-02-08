# Specs Folder — Agent Guidelines

Check `.ai/specs/` before modifying any module. Create specs for new features, update specs when implementing changes.

## When to Create a Spec

- Before implementing a new module or significant feature
- When making architectural decisions that affect multiple files
- When adding new API contracts or data models
- Skip for small bug fixes, typo corrections, or single-file changes

## File Naming

Follow the pattern `SPEC-{number}-{date}-{title}.md`:

- **Number**: Sequential identifier (e.g., `001`, `002`)
- **Date**: Creation date in ISO format (`YYYY-MM-DD`)
- **Title**: Descriptive kebab-case (e.g., `sidebar-reorganization`)

Examples:
- `SPEC-003-2026-01-23-notifications-module.md`
- `SPEC-002-2026-01-23-messages-module.md`

Meta-documentation files (`AGENTS.md`, `CLAUDE.md`) use UPPERCASE names and are not numbered.

## Spec File Structure — MUST Include

Every spec MUST contain these sections:

1. **Overview** — what the module/feature does and why
2. **Architecture** — high-level design and component relationships
3. **Data Models** — entity definitions, relationships, database schema
4. **API Contracts** — endpoints, request/response schemas, examples
5. **UI/UX** — frontend components and interactions (if applicable)
6. **Configuration** — environment variables, feature flags, settings
7. **Changelog** — version history with dates and summaries

### Changelog Format — MUST Maintain

```markdown
## Changelog

### 2026-01-23
- Added email notification channel support
- Updated notification preferences API

### 2026-01-15
- Initial specification
```

## Workflow

### Before Coding

1. Check if a spec exists for the module you're modifying
2. Read the spec to understand design intent and constraints
3. Identify gaps or outdated sections

### When Adding Features

1. Update the corresponding spec with new functionality, API changes, and data model updates
2. Add a changelog entry with date and summary

### When Creating New Modules

1. Create `SPEC-{next-number}-{YYYY-MM-DD}-{module-name}.md`
2. Document the initial design before or alongside implementation
3. Include a changelog entry for the initial specification
4. Update [README.md](README.md) with a link to the new spec

### After Coding

Even when not explicitly asked:
- Update the spec when implementing significant changes
- Keep specs synchronized with actual implementation
- Document architectural decisions made during development

## MUST Rules

1. **MUST check for existing specs** before making changes to any module
2. **MUST update specs** when implementing features — even if not explicitly requested
3. **MUST create specs** for new modules or significant features
4. **MUST maintain changelogs** with clear, dated entries
5. **MUST NOT leave specs out of sync** with the codebase after implementation
