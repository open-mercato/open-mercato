# Specs Folder Guidelines

This folder contains Architecture Decision Records (ADR) and feature specifications that serve as the source of truth for design decisions and module behavior.

## Purpose

The `.ai/specs/` folder is the central repository for:
- **Feature specifications**: Detailed descriptions of module functionality, API contracts, and data models
- **Architecture decisions**: Rationale behind design choices and implementation approaches
- **Implementation reference**: Living documentation that stays synchronized with the codebase

## File Naming

Spec files follow the pattern `<module-name>.md`:
- `notifications-module.md` – Notifications module specification
- `messages-module.md` – Messages module specification
- `ui-reusable-components.md` – Reusable UI component library reference

## Spec File Structure

Each spec should include:

1. **Overview** – What the module/feature does and its purpose
2. **Architecture** – High-level design and component relationships
3. **Data Models** – Entity definitions, relationships, and database schema
4. **API Contracts** – Endpoints, request/response schemas, and examples
5. **UI/UX** – Frontend components and user interactions (if applicable)
6. **Configuration** – Environment variables, feature flags, and settings
7. **Changelog** – Version history with dates and summaries

### Changelog Format

Every spec must maintain a changelog at the bottom:

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
1. Update the corresponding spec file with:
   - New functionality description
   - API changes
   - Data model updates
2. Add a changelog entry with the date and summary

### When Creating New Modules
1. Create a new spec file at `.ai/specs/<module-name>.md`
2. Document the initial design before or alongside implementation
3. Include a changelog entry for the initial specification

### After Coding
Even when not explicitly asked to update specs:
- Generate or update the spec when implementing significant changes
- Keep specs synchronized with actual implementation
- Document architectural decisions made during development

## For AI Agents

AI agents working on this codebase should:
1. **Always check** for existing specs before making changes
2. **Reference specs** to understand module behavior and constraints
3. **Update specs** when implementing features, even if not explicitly requested
4. **Create specs** for new modules or significant features
5. **Maintain changelogs** with clear, dated entries

This ensures the `.ai/specs/` folder remains a reliable reference for understanding module behavior and evolution over time.
