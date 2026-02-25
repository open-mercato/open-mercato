
# Specifications & Architecture Decision Records

This folder contains specifications and Architecture Decision Records (ADRs) that serve as the source of truth for design decisions and module behavior in Open Mercato.

> Note: `.ai/specs/` documents Open Source edition features. Commercial Enterprise Edition specifications are stored in `.ai/specs/enterprise/`. For Enterprise Edition licensing and partnership details, see [`packages/enterprise/README.md`](../../packages/enterprise/README.md).

## Purpose

The `.ai/specs/` folder is the central repository for:
- **Specifications**: Documented design decisions with context, alternatives considered, and rationale
- **Feature specifications**: Detailed descriptions of module functionality, API contracts, and data models
- **Implementation reference**: Living documentation that stays synchronized with the codebase
- **AI agent guidance**: Structured information that helps both humans and AI agents understand system behavior

## Naming Convention

### Specification Files
Specification files follow scope-specific patterns:

- OSS specs: `SPEC-{number}-{date}-{title}.md`
- Enterprise specs: `SPEC-ENT-{number}-{date}-{title}.md`

- **Number**: Sequential identifier (e.g., `001`, `002`, `003`)
- **Date**: Creation date in ISO format (`YYYY-MM-DD`)
- **Title**: Descriptive kebab-case title (e.g., `sidebar-reorganization`, `messages-module`)

**Examples**:
- `SPEC-007-2026-01-26-sidebar-reorganization.md`
- `SPEC-ENT-001-2026-02-17-security-module-enterprise-mfa.md`

### Meta-Documentation Files
Files like `AGENTS.md` and `CLAUDE.md` use UPPERCASE names and are not numbered—they provide guidelines for working with the specs themselves.

## Specification Directory

### Meta-Documentation

- [AGENTS.md](AGENTS.md) - Guidelines for AI agents and humans working with specs
- [CLAUDE.md](CLAUDE.md) - Claude-specific instructions (currently a placeholder)
- [LICENSE.md](LICENSE.md) - Additional licensing notes for enterprise specifications in this area

### Enterprise Specifications

- [Enterprise Specs README](enterprise/README.md) - Enterprise specification directory, scope, and licensing contact

### Specifications

| SPEC | Date | Title | Description |
| --- | --- | --- | --- |
| [SPEC-001](SPEC-001-2026-01-21-ui-reusable-components.md) | 2026-01-21 | UI Reusable Components | Library of reusable UI components and patterns |
| [SPEC-002](SPEC-002-2026-01-23-messages-module.md) | 2026-01-23 | Messages Module | Internal messaging and communication system |
| [SPEC-003](SPEC-003-2026-01-23-notifications-module.md) | 2026-01-23 | Notifications Module | User notification system with multiple channels |
| [SPEC-004](SPEC-004-2026-01-23-progress-module.md) | 2026-01-23 | Progress Module | Long-running task progress tracking |
| [SPEC-005](SPEC-005-2026-01-23-record-locking-module.md) | 2026-01-23 | Record Locking Module (Moved) | Moved to Enterprise: [`SPEC-ENT-003`](enterprise/SPEC-ENT-003-2026-01-23-record-locking-module.md); this file remains as a pointer |
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
| [SPEC-018](SPEC-018-2026-02-05-safe-entity-flush.md) | 2026-02-05 | Atomic Phased Flush | `withAtomicFlush` — N-phase flush pipeline with optional transactions to prevent UoW data loss and partial commits |
| [SPEC-019](SPEC-019-2026-02-05-two-factor-authentication.md) | 2026-02-05 | Two-Factor Authentication (Replaced) | Legacy OSS placeholder retained for history. Enterprise implementation is maintained separately. |
| [SPEC-020](SPEC-020-2026-02-07-related-entity-version-history.md) | 2026-02-07 | Related Entity Version History | Show child entity changes (addresses, payments, notes, etc.) in parent entity version history panel |
| [SPEC-021](SPEC-021-2026-02-07-compound-commands-graph-save.md) | 2026-02-07 | Compound Commands & Graph Save | Graph-save pattern for aggregate roots and compound command wrapper for atomic multi-command operations |
| [SPEC-022](SPEC-022-2026-02-07-pos-module.md) | 2026-02-07 | POS Module | Point of Sale module for in-store retail operations |
| [SPEC-027](SPEC-027-2026-02-08-integration-testing-automation.md) | 2026-02-08 | Integration Testing Automation | Integration testing automation specification |
| [SPEC-022a](SPEC-022a-2026-02-09-pos-tile-browsing.md) | 2026-02-09 | POS Tile Browsing | Tile-based product browsing UI for POS checkout |
| [SPEC-023](SPEC-023-2026-02-11-confirmation-dialog-migration.md) | 2026-02-11 | ConfirmDialog Refactor | Native `<dialog>` migration and `window.confirm` elimination |
| [SPEC-024](SPEC-024-2026-02-11-financial-module.md) | 2026-02-11 | ERP Financial Modules | ERP financial modules specification |
| [SPEC-025](SPEC-025-2026-02-12-ai-assisted-business-rules.md) | 2026-02-12 | AI-Assisted Business Rules | AI-assisted business rule editing |
| [SPEC-026](SPEC-026-2026-02-11-catalog-localization.md) | 2026-02-11 | System-Wide Entity Translations | Dedicated `entity_translations` table (like `entity_indexes`), global locale support in all API routes, `applyLocalizedContent` overlay helper |
| [SPEC-026a](SPEC-026a-2026-02-15-entity-translations-phase2.md) | 2026-02-15 | Entity Translations Phase 2 | TranslationManager UI (standalone + widget injection), search indexer `l10n:*` fields, per-entity translatable field definitions |
| [SPEC-028](SPEC-028-2026-02-16-multiple-sales-pipelines.md) | 2026-02-16 | Multiple Sales Pipelines | Multiple CRM pipelines with configurable stages + deal assignment |
| [SPEC-029](SPEC-029-2026-02-17-ecommerce-storefront-module.md) | 2026-02-17 | Ecommerce Storefront Module | Dedicated `ecommerce` core module + `apps/storefront` starter: org-scoped stores, per-store configurable branding (CSS variables), localized catalog APIs, server-side faceted filters with cross-facet exclusion, multi-variant selection algorithm, WCAG 2.2 AA compliance, RWD-first component spec, and workflow-driven checkout (Phase 3) |
| [SPEC-030](SPEC-030-2026-02-09-rate-limiting.md) | 2026-02-09 | Rate Limiting Utility | Strategy-based rate limiting for auth endpoints using rate-limiter-flexible |
| [SPEC-031](SPEC-031-2026-02-18-decrypt-database-cli.md) | 2026-02-18 | Decrypt Database CLI Command | CLI operation to decrypt encrypted tenant data back to plaintext with strict safety gates and operational guardrails |
| [SPEC-032](SPEC-032-2026-02-19-notification-templates-db-only.md) | 2026-02-19 | Notification Templates (DB-Only) | DB-only architecture for versioned email/slack notification templates with publish flow, mapping resolver, and tenant-safe runtime fallback policy |
| [SPEC-033](SPEC-033-2026-02-18-omnibus-price-tracking.md) | 2026-02-18 | Omnibus Price Tracking | EU Omnibus compliance with append-only catalog price history, lowest-price lookback resolution, API exposure, and admin configuration |
| [SPEC-034](SPEC-034-2026-02-21-dev-ephemeral-runtime.md) | 2026-02-21 | Dev Ephemeral Runtime Command | One-command worktree-friendly ephemeral dev runtime with automatic free-port selection, isolated Postgres, and runtime registry tracking |
| [SPEC-035](SPEC-035-2026-02-22-mutation-guard-mechanism.md) | 2026-02-22 | Mutation Guard Mechanism | Generic DI-based mutation pre/post guard contract for CRUD and custom mutation routes |
| [SPEC-036](SPEC-036-2026-02-21-application-request-lifecycle-events.md) | 2026-02-21 | Application & Request Lifecycle Events | Runtime lifecycle event contract for bootstrap and API request handling with best-effort event emission semantics |
| [SPEC-037](SPEC-037-2026-02-15-inbox-ops-agent.md) | 2026-02-15 | InboxOps Agent | Email-to-ERP action proposal system with human-in-the-loop execution flow |
| [SPEC-038](SPEC-038-2026-02-23-invite-user-email.md) | 2026-02-23 | User Invite via Email | Email invitation flow for new users with secure password setup links |
| [SPEC-039](SPEC-039-2026-02-22-date-pickers.md) | 2026-02-22 | DatePicker, DateTimePicker & TimePicker UI Components | Reusable date/time picker components and CrudForm integration contracts |
| [SPEC-040](SPEC-040-2026-02-22-document-parser-module.md) | 2026-02-22 | Document Parser Module | Schema-driven AI document extraction with consensus, preview, and review workflows |
| [SPEC-041](SPEC-041-2026-02-24-universal-module-extension-system.md) | 2026-02-24 | Universal Module Extension System (UMES) | DOM-inspired framework that lets modules extend any UI surface, intercept mutations, transform API responses, and replace components without touching core code |
| [SPEC-041a](SPEC-041a-foundation.md) | 2026-02-24 | UMES — Foundation | InjectionPosition + headless widget infrastructure; base extension registry and rendering pipeline |
| [SPEC-041b](SPEC-041b-menu-injection.md) | 2026-02-24 | UMES — Menu Item Injection | Application chrome extensibility: sidebar, top nav, and context menus injectable from any module |
| [SPEC-041c](SPEC-041c-events-dom-bridge.md) | 2026-02-24 | UMES — Widget Events & DOM Bridge | Extended widget lifecycle events and DOM event bridge for cross-component communication |
| [SPEC-041d](SPEC-041d-response-enrichers.md) | 2026-02-24 | UMES — Response Enrichers | Data federation via server-side response enricher pipeline that merges cross-module fields into API responses |
| [SPEC-041e](SPEC-041e-api-interceptors.md) | 2026-02-24 | UMES — API Interceptors | Server-side request/response interceptor pipeline for transforming or short-circuiting API calls |
| [SPEC-041f](SPEC-041f-datatable-extensions.md) | 2026-02-24 | UMES — DataTable Extensions | DataTable column, row-action, and bulk-action injection from external modules |
| [SPEC-041g](SPEC-041g-crudform-fields.md) | 2026-02-24 | UMES — CrudForm Field Injection | CrudForm field injection for adding, replacing, or reordering fields from external modules |
| [SPEC-041h](SPEC-041h-component-replacement.md) | 2026-02-24 | UMES — Component Replacement | Runtime component replacement: swap any registered UI element with an alternative implementation |
| [SPEC-041i](SPEC-041i-detail-page-bindings.md) | 2026-02-24 | UMES — Detail Page Bindings | Standardized slot bindings for detail pages enabling consistent cross-module extension |
| [SPEC-041j](SPEC-041j-recursive-widgets.md) | 2026-02-24 | UMES — Recursive Widgets | Recursive widget extensibility: widgets that themselves expose injection slots |
| [SPEC-041k](SPEC-041k-devtools.md) | 2026-02-24 | UMES — DevTools & Conflict Detection | Developer overlay for inspecting active extensions and detecting slot/component conflicts |
| [SPEC-041l](SPEC-041l-integration-extensions.md) | 2026-02-24 | UMES — Integration Extensions | Extension patterns specific to integration marketplace connectors (SPEC-045) |
| [SPEC-041m](SPEC-041m-mutation-lifecycle.md) | 2026-02-24 | UMES — Mutation Lifecycle Hooks | Overview of the mutation lifecycle hook system; entry point for sub-specs m1–m4 |
| [SPEC-041m1](SPEC-041m1-mutation-guard-registry.md) | 2026-02-24 | UMES — Mutation Guard Registry | DI-based registry of ordered pre/post mutation guards with short-circuit support |
| [SPEC-041m2](SPEC-041m2-sync-event-subscribers.md) | 2026-02-24 | UMES — Sync Event Subscribers | Synchronous in-request event subscribers for guaranteed ordering of side effects |
| [SPEC-041m3](SPEC-041m3-client-side-event-filtering.md) | 2026-02-24 | UMES — Client-Side Event Filtering | Client-side subscription filters that narrow event delivery to matching record predicates |
| [SPEC-041m4](SPEC-041m4-command-interceptors.md) | 2026-02-24 | UMES — Command Interceptors | Command-layer interceptors for wrapping or replacing command execution in the command graph |
| [SPEC-042](SPEC-042-2026-02-24-multi-id-query-parameter.md) | 2026-02-24 | Multi-ID Query Parameter | Standardized `ids` query parameter for all `makeCrudRoute`-based list endpoints to filter by multiple record IDs in a single request |
| [SPEC-043](SPEC-043-2026-02-24-reactive-notification-handlers.md) | 2026-02-24 | Reactive Notification Handlers | Reactive notification handler system for event-driven notification delivery |
| [SPEC-044](SPEC-044-2026-02-24-payment-gateway-integrations.md) | 2026-02-24 | Payment Gateway Integrations | Stripe, PayU, Przelewy24, and Apple Pay gateway adapters with unified webhook handling, status machine, and UMES-based sales UI extensions |
| [SPEC-045](SPEC-045-2026-02-24-integration-marketplace.md) | 2026-02-24 | Integration Marketplace & Connector Framework | Centralized integration framework: auto-discovered npm module connectors, unified credentials API, operation logs, and admin panel at `/backend/integrations` |
| [SPEC-045a](SPEC-045a-foundation.md) | 2026-02-24 | Integration Marketplace — Foundation | Registry, credentials API, operation log infrastructure, and admin panel foundation |
| [SPEC-045b](SPEC-045b-data-sync-hub.md) | 2026-02-24 | Integration Marketplace — Data Sync Hub | Import/export hub with delta streaming for bidirectional data synchronization |
| [SPEC-045c](SPEC-045c-payment-shipping-hubs.md) | 2026-02-24 | Integration Marketplace — Payment & Shipping Hubs | Alignment of payment and shipping connector hub architecture with SPEC-044 |
| [SPEC-045d](SPEC-045d-communication-notification-hubs.md) | 2026-02-24 | Integration Marketplace — Communication & Notification Hubs | Communication and notification provider hub (email, SMS, chat channels) |
| [SPEC-045e](SPEC-045e-storage-webhook-hubs.md) | 2026-02-24 | Integration Marketplace — Storage & Webhook Hubs | File storage backend hub and inbound webhook receiver hub |
| [SPEC-045f](SPEC-045f-health-monitoring.md) | 2026-02-24 | Integration Marketplace — Health Monitoring | Integration health monitoring, status dashboard, and marketplace UI polish |
| [SPEC-045g](SPEC-045g-google-workspace.md) | 2026-02-24 | Integration Marketplace — Google Workspace | Google Workspace integration: spreadsheet-based product import as a reference data-sync connector |
| [SPEC-045h](SPEC-045h-stripe-payment-gateway.md) | 2026-02-24 | Integration Marketplace — Stripe Gateway | Stripe payment gateway reference implementation as a marketplace connector |
| [SPEC-046](SPEC-046-2026-02-25-customer-detail-pages-v2.md) | 2026-02-25 | Customer Detail Pages v2 | CrudForm-based rewrite of company and person detail pages with two-zone layout and UMES injection slots |
| [SPEC-047](SPEC-047-2026-02-25-sales-document-detail-pages-v2.md) | 2026-02-25 | Sales Document Detail Pages v2 | CrudForm-based rewrite of quote and order detail pages with two-zone layout and UMES injection slots |
| [SPEC-048](SPEC-048-2026-02-22-integration-test-coverage-quick-wins.md) | 2026-02-22 | Integration Test Coverage Quick Wins | Pure-API integration tests for 6 zero-coverage core modules (currencies, staff, dictionaries, api_keys, audit_logs, directory) |

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

1. Create a new specification file at:
   - `.ai/specs/SPEC-{next-number}-{YYYY-MM-DD}-{module-name}.md` for Open Source edition scope
   - `.ai/specs/enterprise/SPEC-ENT-{next-number}-{YYYY-MM-DD}-{module-name}.md` for Enterprise Edition scope (enterprise numbering starts at `SPEC-ENT-001` in that folder)
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
