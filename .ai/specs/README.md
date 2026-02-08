# Specifications & Architecture Decision Records

This folder contains specifications and Architecture Decision Records (ADRs) that serve as the source of truth for design decisions and module behavior in Open Mercato.

## Purpose

The `.ai/specs/` folder is the central repository for:
- **Specifications**: Documented design decisions with context, alternatives considered, and rationale
- **Feature specifications**: Detailed descriptions of module functionality, API contracts, and data models
- **Implementation reference**: Living documentation that stays synchronized with the codebase
- **AI agent guidance**: Structured information that helps both humans and AI agents understand system behavior

## Naming Convention

### Specification Files
Specification files follow the pattern `SPEC-{number}-{date}-{title}.md`:

- **Number**: Sequential identifier (e.g., `001`, `002`, `003`)
- **Date**: Creation date in ISO format (`YYYY-MM-DD`)
- **Title**: Descriptive kebab-case title (e.g., `sidebar-reorganization`, `messages-module`)

**Example**: `SPEC-007-2026-01-26-sidebar-reorganization.md`

### Meta-Documentation Files
Files like `AGENTS.md` and `CLAUDE.md` use UPPERCASE names and are not numbered—they provide guidelines for working with the specs themselves.

## Specification Directory

### Meta-Documentation

- [AGENTS.md](AGENTS.md) - Guidelines for AI agents and humans working with specs
- [CLAUDE.md](CLAUDE.md) - Claude-specific instructions (currently a placeholder)

### Specifications

| SPEC | Date | Title | Description |
| --- | --- | --- | --- |
| [SPEC-001](SPEC-001-2026-01-21-ui-reusable-components.md) | 2026-01-21 | UI Reusable Components | Library of reusable UI components and patterns |
| [SPEC-002](SPEC-002-2026-01-23-messages-module.md) | 2026-01-23 | Messages Module | Internal messaging and communication system |
| [SPEC-003](SPEC-003-2026-01-23-notifications-module.md) | 2026-01-23 | Notifications Module | User notification system with multiple channels |
| [SPEC-004](SPEC-004-2026-01-23-progress-module.md) | 2026-01-23 | Progress Module | Long-running task progress tracking |
| [SPEC-005](SPEC-005-2026-01-23-record-locking-module.md) | 2026-01-23 | Record Locking Module | Pessimistic locking for concurrent editing |
| [SPEC-006](SPEC-006-2026-01-23-order-status-history.md) | 2026-01-23 | Order Status History | Sales order status tracking and history |
| [SPEC-007](SPEC-007-2026-01-26-sidebar-reorganization.md) | 2026-01-26 | Sidebar Reorganization | Backend admin panel navigation improvements |
| [SPEC-008](SPEC-008-2026-01-27-product-quality-widget.md) | 2026-01-27 | Product Quality Widget | Dashboard widget for tracking products with missing images/descriptions |
| [SPEC-009](SPEC-009-2026-01-27-sales-dashboard-widgets.md) | 2026-01-27 | Sales Dashboard Widgets | New Orders and New Quotes dashboard widgets with date period filtering |
| [SPEC-010](SPEC-010-2026-01-27-dashboard-widget-visibility.md) | 2026-01-27 | Dashboard Widget Visibility | Feature-based access control for dashboard widgets |
| [SPEC-011](SPEC-011-2026-01-26-dashboard-analytics-widgets.md) | 2026-01-26 | Dashboard Analytics Widgets | Analytics widgets, registry, and shared chart/date-range UI |
| [SPEC-012](SPEC-012-2026-01-27-ai-assistant-schema-discovery.md) | 2026-01-27 | AI Assistant Schema Discovery | Entity schema extraction and OpenAPI integration for MCP tools |
| [SPEC-013](SPEC-013-2026-01-27-decouple-module-setup.md) | 2026-01-27 | Decouple Module Setup | `setup.ts` convention for module initialization and role features |
| [SPEC-014](SPEC-014-2026-01-28-onboarding-activation-login.md) | 2026-01-28 | Onboarding Activation Login | Duplicate-activation guard and tenant-aware login flow |
| [SPEC-015](SPEC-015-2026-01-29-module-registry-scanner-dedup.md) | 2026-01-29 | Module Registry Scanner Dedup | Deduplicate widget scanner logic in module registry generation |
| [SPEC-016](SPEC-016-2026-02-03-form-headers-footers.md) | 2026-02-03 | Form Headers & Footers | Reusable FormHeader, FormFooter, FormActionButtons design system components |
| [SPEC-017](SPEC-017-2026-02-03-version-history-panel.md) | 2026-02-03 | Version History Panel | Right-side panel showing record change history from audit logs |
| [SPEC-018](SPEC-018-2026-02-05-safe-entity-flush.md) | 2026-02-05 | Safe Entity Flush | Framework helpers to prevent silent MikroORM UoW data loss in commands |
| [SPEC-019](SPEC-019-2026-02-05-two-factor-authentication.md) | 2026-02-05 | Two-Factor Authentication | TOTP-based 2FA with authenticator apps, recovery codes, and optional tenant enforcement |
| [SPEC-020](SPEC-020-2026-02-07-related-entity-version-history.md) | 2026-02-07 | Related Entity Version History | Show child entity changes (addresses, payments, notes, etc.) in parent entity version history panel |
| [SPEC-022](SPEC-022-2026-02-08-integration-testing-automation.md) | 2026-02-08 | Integration Testing Automation | QA infrastructure for automated integration testing with Playwright |

## Specification Structure

Each specification should include the following sections:

1. **Overview** – What the feature/decision is about and its purpose
2. **Problem Statement** – The problem being solved or the decision being made
3. **Proposed Solution** – The chosen approach with detailed design
4. **Architecture** – High-level design and component relationships
5. **Data Models** – Entity definitions, relationships, and database schema (if applicable)
6. **API Contracts** – Endpoints, request/response schemas, and examples (if applicable)
7. **UI/UX** – Frontend components and user interactions (if applicable)
8. **Configuration** – Environment variables, feature flags, and settings (if applicable)
9. **Alternatives Considered** – Other options evaluated and why they were not chosen
10. **Implementation Approach** – Step-by-step implementation plan
11. **Migration Path** – How to migrate from the old approach (if applicable)
12. **Success Metrics** – How to measure if the solution is working
13. **Open Questions** – Unresolved questions or future considerations
14. **Changelog** – Version history with dates and summaries

### Changelog Format

Every ADR must maintain a changelog at the bottom:

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

1. Check if a specification exists for the module you're modifying
2. Read the spec to understand design intent and constraints
3. Identify gaps or outdated sections

### When Adding Features

1. Update the corresponding specification file with:
   - New functionality description
   - API changes
   - Data model updates
2. Add a changelog entry with the date and summary

### When Creating New Modules

1. Create a new specification file at `.ai/specs/SPEC-{next-number}-{YYYY-MM-DD}-{module-name}.md`
2. Document the initial design before or alongside implementation
3. Include a changelog entry for the initial specification
4. Update this README.md with a link to the new specification

### After Coding

Even when not explicitly asked to update specifications:

- Generate or update the specification when implementing significant changes
- Keep specifications synchronized with actual implementation
- Document architectural decisions made during development

## For AI Agents

AI agents working on this codebase should:

1. **Always check** for existing specifications before making changes
2. **Reference specifications** to understand module behavior and constraints
3. **Update specifications** when implementing features, even if not explicitly requested
4. **Create specifications** for new modules or significant features following the naming convention
5. **Maintain changelogs** with clear, dated entries
6. **Update this README.md** when adding new specifications to the directory table

This ensures the `.ai/specs/` folder remains a reliable reference for understanding module behavior and evolution over time.

## Quick Links

- [Documentation](https://docs.openmercato.com/)
- [Architecture Guide](https://docs.openmercato.com/architecture/system-overview)
- [Contributing Guidelines](../../CONTRIBUTING.md)
- [Agent Guidelines](../../AGENTS.md)

## Related Resources

- **Root AGENTS.md**: See [/AGENTS.md](../../AGENTS.md) for comprehensive development guidelines
- **Root CONTRIBUTING.md**: See [/CONTRIBUTING.md](../../CONTRIBUTING.md) for contribution workflow
- **Documentation**: Browse the full documentation at [docs.openmercato.com](https://docs.openmercato.com/)
