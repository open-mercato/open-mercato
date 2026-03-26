
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
Specification files now follow one shared pattern in both OSS and enterprise folders:

- `{date}-{title}.md`

- **Date**: Creation date in ISO format (`YYYY-MM-DD`)
- **Title**: Descriptive kebab-case title (e.g., `sidebar-reorganization`, `messages-module`)
- **Legacy note**: Older specs may still use `SPEC-*` / `SPEC-ENT-*` prefixes. Keep those filenames only until they are intentionally normalized; new specs MUST use the date-first format.

**Examples**:
- `2026-01-26-sidebar-reorganization.md`
- `2026-02-17-security-module-enterprise-mfa.md`

### Meta-Documentation Files
Files like `AGENTS.md` and `CLAUDE.md` use UPPERCASE names and are not numbered—they provide guidelines for working with the specs themselves.

## Specification Directory

### Meta-Documentation

- [AGENTS.md](AGENTS.md) - Guidelines for AI agents and humans working with specs
- [CLAUDE.md](CLAUDE.md) - Claude-specific instructions (currently a placeholder)
- [LICENSE.md](LICENSE.md) - Additional licensing notes for enterprise specifications in this area

### Enterprise Specifications

- [Enterprise Specs README](enterprise/README.md) - Enterprise specification directory, scope, and licensing contact

### Pending Specifications

Specs awaiting implementation or partially complete. Focus here for actionable work.

| SPEC | Date | Title | Description |
| --- | --- | --- | --- |
| [SPEC-008](SPEC-008-2026-01-27-product-quality-widget.md) | 2026-01-27 | Product Quality Widget | Dashboard widget for tracking products with missing images/descriptions |
| [SPEC-012](SPEC-012-2026-01-27-ai-assistant-schema-discovery.md) | 2026-01-27 | AI Assistant Schema Discovery | Entity schema extraction and OpenAPI integration for MCP tools |
| [SPEC-018](SPEC-018-2026-02-05-safe-entity-flush.md) | 2026-02-05 | Atomic Phased Flush | `withAtomicFlush` — N-phase flush pipeline with optional transactions to prevent UoW data loss and partial commits |
| [SPEC-021](SPEC-021-2026-02-07-compound-commands-graph-save.md) | 2026-02-07 | Compound Commands & Graph Save | Graph-save pattern for aggregate roots and compound command wrapper for atomic multi-command operations |
| [SPEC-022](SPEC-022-2026-02-07-pos-module.md) | 2026-02-07 | POS Module | Point of Sale module for in-store retail operations |
| [SPEC-022a](SPEC-022a-2026-02-09-pos-tile-browsing.md) | 2026-02-09 | POS Tile Browsing | Tile-based product browsing UI for POS checkout |
| [SPEC-025](SPEC-025-2026-02-12-ai-assisted-business-rules.md) | 2026-02-12 | AI-Assisted Business Rules | AI-assisted business rule editing |
| [SPEC-029](SPEC-029-2026-02-17-ecommerce-storefront-module.md) | 2026-02-17 | Ecommerce Storefront Module | Dedicated `ecommerce` core module + `apps/storefront` starter with org-scoped stores, localized catalog APIs, faceted filters, and workflow-driven checkout |
| [SPEC-033](SPEC-033-2026-02-18-omnibus-price-tracking.md) | 2026-02-18 | Omnibus Price Tracking | EU Omnibus compliance with append-only catalog price history, lowest-price lookback resolution, and admin configuration |
| [SPEC-040](SPEC-040-2026-02-22-document-parser-module.md) | 2026-02-22 | Document Parser Module | Schema-driven AI document extraction with consensus, preview, and review workflows |
| [SPEC-046](SPEC-046-2026-02-25-customer-detail-pages-v2.md) | 2026-02-25 | Customer Detail Pages v2 | CrudForm-based rewrite of company and person detail pages with two-zone layout and UMES injection slots |
| [SPEC-046b](SPEC-046b-2026-02-27-customers-interactions-unification.md) | 2026-02-27 | Customers Interactions Unification | Canonical customer interactions model and compatibility adapters for activities/todos |
| [SPEC-046c](SPEC-046c-2026-02-28-example-module-umes-alignment-customer-tasks.md) | 2026-02-28 | Example Module UMES Alignment for Customer Tasks | Decouples example task sync and moves `/backend/customer-tasks` ownership to customers |
| [SPEC-047](SPEC-047-2026-02-25-sales-document-detail-pages-v2.md) | 2026-02-25 | Sales Document Detail Pages v2 | CrudForm-based rewrite of quote and order detail pages with two-zone layout and UMES injection slots |
| [SPEC-049](SPEC-049-2026-02-27-customers-interactions-unification.md) | 2026-02-27 | Customers Interactions Unification (Pointer) | Pointer retained for backward links; canonical spec is SPEC-046b |
| [SPEC-050](SPEC-050-2026-02-20-catalog-unit-tests.md) | 2026-02-20 | Catalog Module Test Coverage | Catalog module unit + integration test coverage expansion plan and verification matrix |
| [SPEC-050](SPEC-050-2026-02-28-sonarqube-critical-fixes.md) | 2026-02-28 | SonarQube Critical Fixes | Actionable SonarQube-flagged critical code fixes |
| [SPEC-051](SPEC-051-2026-03-02-sonarqube-code-deduplication.md) | 2026-03-02 | SonarQube Code Deduplication | Code deduplication driven by SonarQube analysis |
| [SPEC-052](SPEC-052-2026-02-22-integration-test-coverage-quick-wins.md) | 2026-02-22 | Integration Test Coverage Quick Wins | Pure-API integration tests for 6 zero-coverage core modules |
| [SPEC-053](SPEC-053-2026-03-02-b2b-prm-starter.md) | 2026-03-02 | B2B PRM Starter | B2B Partner Relationship Management starter architecture |
| [SPEC-053a](SPEC-053a-2026-03-02-b2b-prm-matching-data-phase0-api-only.md) | 2026-03-02 | B2B PRM Matching Data (Phase 0) | API-only phase for B2B PRM matching data |
| [SPEC-053b](SPEC-053b-2026-03-02-b2b-prm-operations-kpi-rfp.md) | 2026-03-02 | B2B PRM Operations, KPI & RFP | B2B partner operations, KPIs, and RFP workflows |
| [SPEC-053c](SPEC-053c-2026-03-18-b2b-prm-partner-portal-module-slimming.md) | 2026-03-18 | B2B PRM Partner Portal Module Slimming | Reducing partner portal module footprint |
| [SPEC-055](SPEC-055-2026-02-23-promotions-module.md) | 2026-02-23 | Promotions Module | Standalone promotions module with recursive rule tree, extensible evaluation engine, and resolved cart effects |
| [SPEC-056](SPEC-056-2026-02-22-whatsapp-ai-chat-integration.md) | 2026-02-22 | WhatsApp AI Chat Integration | WhatsApp conversation history, AI summaries, and tiered AI replies |
| [SPEC-058](SPEC-058-2026-03-05-sales-native-payment-gateway-refactor.md) | 2026-03-05 | Sales Native Payment Gateway Refactor | Refactor sales module payment gateway integration to native pattern |
| [SPEC-058](SPEC-058-2026-03-08-custom-route-auth-interceptor-local-pattern.md) | 2026-03-08 | Custom Route Auth Interceptor (Local Pattern) | Pattern spec for custom route authentication interceptors |
| [SPEC-059](SPEC-059-2026-03-08-middleware-injection-registry.md) | 2026-03-08 | Middleware Injection Registry | Middleware injection registry for extensible request processing |
| [SPEC-059](SPEC-059-2026-03-09-order-status-history-tab.md) | 2026-03-09 | Order Status History Tab (Superseded) | Feature merged into existing History tab |
| [SPEC-062](SPEC-062-2026-03-18-sales-native-shipping-carrier-refactor.md) | 2026-03-18 | Sales Native Shipping Carrier Refactor | Refactor sales module shipping carrier integration to native pattern |
| [SPEC-067](SPEC-067-2026-03-17-cli-standalone-app-support.md) | 2026-03-17 | CLI Standalone App Support | CLI tooling support for standalone app development |
| [SPEC-068](SPEC-068-2026-03-02-use-case-examples-framework.md) | 2026-03-02 | Use-Case Examples Framework | `create-mercato-app --example` pattern for bootstrapping use-case solutions |
| [SPEC-069](SPEC-069-2026-02-23-core-timesheets.md) | 2026-02-23 | Core Timesheets Functionality | Core timesheets functionality in the `staff` module with My Timesheets, Projects, and phase-based approvals/policies |
| [Checkout](2026-03-19-checkout-simple-checkout.md) | 2026-03-19 | Simple Checkout | Checkout flow specification for Phase B |
| [Checkout Wireframes](2026-03-19-checkout-simple-checkout-wireframes.md) | 2026-03-19 | Simple Checkout Wireframes | Companion wireframes for the Simple Checkout spec |
| [Registry](2026-03-20-decentralize-module-registry-generator.md) | 2026-03-20 | Decentralize Module Registry Generator | CLI refactoring for decentralized module registry generation |
| [Sync Playbook](2026-03-20-official-modules-platform-sync-playbook.md) | 2026-03-20 | Official Modules Platform Sync Playbook | Playbook for syncing official modules with platform releases |
| [Snapshots](2026-03-21-open-mercato-develop-snapshot-release.md) | 2026-03-21 | Develop Snapshot Release | Develop branch snapshot release workflow |
| [Webhooks](2026-03-23-inbound-webhook-handlers.md) | 2026-03-23 | Inbound Webhook Handlers | Inbound webhook handler architecture and registration |
| [Build Check](2026-03-25-safe-build-dev-coexistence.md) | 2026-03-25 | Safe Package Verification Build | Isolated `build:check` output so verification builds never touch live `dist/` artifacts |
| [Not Found](2026-03-23-unified-record-not-found-ui-state.md) | 2026-03-23 | Unified Record Not-Found UI State | Consistent UI state for missing/deleted records |

### Implemented Specifications

Fully implemented and deployed. Canonical files live in [`implemented/`](implemented/). See [`enterprise/implemented/`](enterprise/implemented/) for enterprise specs.

| SPEC | Date | Title | Description |
| --- | --- | --- | --- |
| [SPEC-001](implemented/SPEC-001-2026-01-21-ui-reusable-components.md) | 2026-01-21 | UI Reusable Components | Library of reusable UI components and patterns |
| [SPEC-002](implemented/SPEC-002-2026-01-23-messages-module.md) | 2026-01-23 | Messages Module | Internal messaging and communication system |
| [SPEC-003](implemented/SPEC-003-2026-01-23-notifications-module.md) | 2026-01-23 | Notifications Module | User notification system with multiple channels |
| [SPEC-004](implemented/SPEC-004-2026-01-23-progress-module.md) | 2026-01-23 | Progress Module | Long-running task progress tracking |
| [SPEC-005](implemented/SPEC-005-2026-01-23-record-locking-module.md) | 2026-01-23 | Record Locking Module (Pointer) | Pointer to Enterprise [`SPEC-ENT-003`](enterprise/implemented/SPEC-ENT-003-2026-01-23-record-locking-module.md) |
| [SPEC-006](implemented/SPEC-006-2026-01-23-order-status-history.md) | 2026-01-23 | Order Status History | Sales order status tracking and history |
| [SPEC-007](implemented/SPEC-007-2026-01-26-sidebar-reorganization.md) | 2026-01-26 | Sidebar Reorganization | Backend admin panel navigation improvements |
| [SPEC-009](implemented/SPEC-009-2026-01-27-sales-dashboard-widgets.md) | 2026-01-27 | Sales Dashboard Widgets | New Orders and New Quotes dashboard widgets with date period filtering |
| [SPEC-010](implemented/SPEC-010-2026-01-27-dashboard-widget-visibility.md) | 2026-01-27 | Dashboard Widget Visibility | Feature-based access control for dashboard widgets |
| [SPEC-011](implemented/SPEC-011-2026-01-26-dashboard-analytics-widgets.md) | 2026-01-26 | Dashboard Analytics Widgets | Analytics widgets, registry, and shared chart/date-range UI |
| [SPEC-013](implemented/SPEC-013-2026-01-27-decouple-module-setup.md) | 2026-01-27 | Decouple Module Setup | `setup.ts` convention for module initialization and role features |
| [SPEC-014](implemented/SPEC-014-2026-01-28-onboarding-activation-login.md) | 2026-01-28 | Onboarding Activation Login | Duplicate-activation guard and tenant-aware login flow |
| [SPEC-015](implemented/SPEC-015-2026-01-29-module-registry-scanner-dedup.md) | 2026-01-29 | Module Registry Scanner Dedup | Deduplicate widget scanner logic in module registry generation |
| [SPEC-016](implemented/SPEC-016-2026-02-03-form-headers-footers.md) | 2026-02-03 | Form Headers & Footers | Reusable FormHeader, FormFooter, FormActionButtons design system components |
| [SPEC-017](implemented/SPEC-017-2026-02-03-version-history-panel.md) | 2026-02-03 | Version History Panel | Right-side panel showing record change history from audit logs |
| [SPEC-019](implemented/SPEC-019-2026-02-05-two-factor-authentication.md) | 2026-02-05 | Two-Factor Authentication | Legacy OSS placeholder; enterprise implementation maintained separately |
| [SPEC-020](implemented/SPEC-020-2026-02-07-related-entity-version-history.md) | 2026-02-07 | Related Entity Version History | Show child entity changes in parent entity version history panel |
| [SPEC-023](implemented/SPEC-023-2026-02-11-confirmation-dialog-migration.md) | 2026-02-11 | ConfirmDialog Refactor | Native `<dialog>` migration and `window.confirm` elimination |
| [SPEC-024](implemented/SPEC-024-2026-02-11-financial-module.md) | 2026-02-11 | ERP Financial Modules | ERP financial modules specification |
| [SPEC-026](implemented/SPEC-026-2026-02-11-catalog-localization.md) | 2026-02-11 | System-Wide Entity Translations | Dedicated `entity_translations` table, global locale support, `applyLocalizedContent` helper |
| [SPEC-026a](implemented/SPEC-026a-2026-02-15-entity-translations-phase2.md) | 2026-02-15 | Entity Translations Phase 2 | TranslationManager UI, search indexer `l10n:*` fields, per-entity translatable field definitions |
| [SPEC-027](implemented/SPEC-027-2026-02-08-integration-testing-automation.md) | 2026-02-08 | Integration Testing Automation | Integration testing automation specification |
| [SPEC-028](implemented/SPEC-028-2026-02-16-multiple-sales-pipelines.md) | 2026-02-16 | Multiple Sales Pipelines | Multiple CRM pipelines with configurable stages + deal assignment |
| [SPEC-029](implemented/SPEC-029-2026-02-15-inbox-ops-agent.md) | 2026-02-15 | InboxOps Agent | Email-to-ERP action proposal system with human-in-the-loop execution flow |
| [SPEC-030](implemented/SPEC-030-2026-02-09-rate-limiting.md) | 2026-02-09 | Rate Limiting | Strategy-based rate limiting for auth endpoints |
| [SPEC-030a](implemented/SPEC-030a-2026-02-09-rate-limiting.md) | 2026-02-09 | Rate Limiting Utility | Rate limiting utility using rate-limiter-flexible |
| [SPEC-031](implemented/SPEC-031-2026-02-18-decrypt-database-cli.md) | 2026-02-18 | Decrypt Database CLI Command | CLI operation to decrypt encrypted tenant data with safety gates |
| [SPEC-032](implemented/SPEC-032-2026-02-19-notification-templates-db-only.md) | 2026-02-19 | Notification Templates (DB-Only) | DB-only architecture for versioned email/slack notification templates |
| [SPEC-034](implemented/SPEC-034-2026-02-18-units-of-measure-conversions.md) | 2026-02-18 | Units of Measure & Product Conversions | Hybrid UoM model for catalog + sales core with conversion factors and pricing tiers |
| [SPEC-034](implemented/SPEC-034-2026-02-21-dev-ephemeral-runtime.md) | 2026-02-21 | Dev Ephemeral Runtime Command | One-command worktree-friendly ephemeral dev runtime with isolated Postgres |
| [SPEC-035](implemented/SPEC-035-2026-02-22-mutation-guard-mechanism.md) | 2026-02-22 | Mutation Guard Mechanism | Generic DI-based mutation pre/post guard contract for CRUD and custom mutation routes |
| [SPEC-036](implemented/SPEC-036-2026-02-21-application-request-lifecycle-events.md) | 2026-02-21 | Application & Request Lifecycle Events | Runtime lifecycle event contract for bootstrap and API request handling |
| [SPEC-037](implemented/SPEC-037-2026-02-15-inbox-ops-agent.md) | 2026-02-15 | InboxOps Agent | Email-to-ERP action proposal system |
| [SPEC-038](implemented/SPEC-038-2026-02-23-invite-user-email.md) | 2026-02-23 | User Invite via Email | Email invitation flow for new users with secure password setup links |
| [SPEC-039](implemented/SPEC-039-2026-02-22-date-pickers.md) | 2026-02-22 | DatePicker, DateTimePicker & TimePicker | Reusable date/time picker components and CrudForm integration contracts |
| [SPEC-041](implemented/SPEC-041-2026-02-24-search-organization-scoping.md) | 2026-02-24 | Search Organization Scoping | Organization-scoped search indexing and query filtering |
| [SPEC-041](implemented/SPEC-041-2026-02-24-universal-module-extension-system.md) | 2026-02-24 | Universal Module Extension System (UMES) | DOM-inspired framework for UI extension, mutation interception, API transformation, and component replacement |
| [SPEC-041a](implemented/SPEC-041a-foundation.md) | 2026-02-24 | UMES — Foundation | InjectionPosition + headless widget infrastructure; base extension registry and rendering pipeline |
| [SPEC-041b](implemented/SPEC-041b-menu-injection.md) | 2026-02-24 | UMES — Menu Item Injection | Application chrome extensibility: sidebar, top nav, and context menus injectable from any module |
| [SPEC-041c](implemented/SPEC-041c-events-dom-bridge.md) | 2026-02-24 | UMES — Widget Events & DOM Bridge | Extended widget lifecycle events and DOM event bridge for cross-component communication |
| [SPEC-041d](implemented/SPEC-041d-response-enrichers.md) | 2026-02-24 | UMES — Response Enrichers | Data federation via server-side response enricher pipeline |
| [SPEC-041e](implemented/SPEC-041e-api-interceptors.md) | 2026-02-24 | UMES — API Interceptors | Server-side request/response interceptor pipeline for API calls |
| [SPEC-041f](implemented/SPEC-041f-datatable-extensions.md) | 2026-02-24 | UMES — DataTable Extensions | DataTable column, row-action, and bulk-action injection from external modules |
| [SPEC-041g](implemented/SPEC-041g-crudform-fields.md) | 2026-02-24 | UMES — CrudForm Field Injection | CrudForm field injection for adding, replacing, or reordering fields |
| [SPEC-041h](implemented/SPEC-041h-component-replacement.md) | 2026-02-24 | UMES — Component Replacement | Runtime component replacement: swap any registered UI element |
| [SPEC-041i](implemented/SPEC-041i-detail-page-bindings.md) | 2026-02-24 | UMES — Detail Page Bindings | Standardized slot bindings for detail pages enabling consistent cross-module extension |
| [SPEC-041j](implemented/SPEC-041j-recursive-widgets.md) | 2026-02-24 | UMES — Recursive Widgets | Recursive widget extensibility: widgets that themselves expose injection slots |
| [SPEC-041k](implemented/SPEC-041k-devtools.md) | 2026-02-24 | UMES — DevTools & Conflict Detection | Developer overlay for inspecting active extensions and detecting conflicts |
| [SPEC-041l](implemented/SPEC-041l-integration-extensions.md) | 2026-02-24 | UMES — Integration Extensions | Extension patterns specific to integration marketplace connectors |
| [SPEC-041m](implemented/SPEC-041m-mutation-lifecycle.md) | 2026-02-24 | UMES — Mutation Lifecycle Hooks | Overview of the mutation lifecycle hook system; entry point for sub-specs m1–m4 |
| [SPEC-041m1](implemented/SPEC-041m1-mutation-guard-registry.md) | 2026-02-24 | UMES — Mutation Guard Registry | DI-based registry of ordered pre/post mutation guards with short-circuit support |
| [SPEC-041m2](implemented/SPEC-041m2-sync-event-subscribers.md) | 2026-02-24 | UMES — Sync Event Subscribers | Synchronous in-request event subscribers for guaranteed ordering |
| [SPEC-041m3](implemented/SPEC-041m3-client-side-event-filtering.md) | 2026-02-24 | UMES — Client-Side Event Filtering | Client-side subscription filters for event delivery narrowing |
| [SPEC-041m4](implemented/SPEC-041m4-command-interceptors.md) | 2026-02-24 | UMES — Command Interceptors | Command-layer interceptors for wrapping or replacing command execution |
| [SPEC-041n](implemented/SPEC-041n-query-engine-extensibility.md) | 2026-02-26 | UMES — Query Engine Extensibility | Query-level enricher opt-in, unified enricher registry, sync query events |
| [SPEC-042](implemented/SPEC-042-2026-02-24-multi-id-query-parameter.md) | 2026-02-24 | Multi-ID Query Parameter | Standardized `ids` query parameter for `makeCrudRoute`-based list endpoints |
| [SPEC-043](implemented/SPEC-043-2026-02-24-reactive-notification-handlers.md) | 2026-02-24 | Reactive Notification Handlers | Reactive notification handler system for event-driven notification delivery |
| [SPEC-044](implemented/SPEC-044-2026-02-24-payment-gateway-integrations.md) | 2026-02-24 | Payment Gateway Integrations | Stripe, PayU, Przelewy24, and Apple Pay gateway adapters with webhook handling and status machine |
| [SPEC-045](implemented/SPEC-045-2026-02-24-integration-marketplace.md) | 2026-02-24 | Integration Marketplace & Connector Framework | Centralized integration framework with auto-discovered npm connectors, credentials API, and admin panel |
| [SPEC-045a](implemented/SPEC-045a-foundation.md) | 2026-02-24 | Integration Marketplace — Foundation | Registry, credentials API, operation log infrastructure, and admin panel foundation |
| [SPEC-045b](implemented/SPEC-045b-data-sync-hub.md) | 2026-02-24 | Integration Marketplace — Data Sync Hub | Import/export hub with delta streaming for bidirectional data synchronization |
| [SPEC-045c](implemented/SPEC-045c-payment-shipping-hubs.md) | 2026-02-24 | Integration Marketplace — Payment & Shipping Hubs | Payment and shipping connector hub architecture |
| [SPEC-045d](implemented/SPEC-045d-communication-notification-hubs.md) | 2026-02-24 | Integration Marketplace — Communication & Notification Hubs | Communication and notification provider hub (email, SMS, chat) |
| [SPEC-045e](implemented/SPEC-045e-webhook-hub.md) | 2026-02-24 | Integration Marketplace — Webhook Endpoints Hub | Inbound/outbound webhook receiver hub |
| [SPEC-045f](implemented/SPEC-045f-health-monitoring.md) | 2026-02-24 | Integration Marketplace — Health Monitoring | Integration health monitoring, status dashboard, and marketplace UI |
| [SPEC-045g](implemented/SPEC-045g-google-workspace.md) | 2026-02-24 | Integration Marketplace — Google Workspace | Google Workspace integration: spreadsheet-based product import |
| [SPEC-045h](implemented/SPEC-045h-stripe-payment-gateway.md) | 2026-02-24 | Integration Marketplace — Stripe Gateway | Stripe payment gateway reference implementation |
| [SPEC-045i](implemented/SPEC-045i-storage-hub.md) | 2026-03-10 | Integration Marketplace — Storage Providers Hub | File storage backend hub with pluggable drivers (local, S3, database) |
| [SPEC-048](implemented/SPEC-048-2026-02-25-notifications-sse-migration.md) | 2026-02-25 | Migrate Notifications from Polling to SSE | Replaces 5-second polling with SSE event delivery via DOM Event Bridge |
| [SPEC-049](implemented/SPEC-049-2026-02-26-message-objects-universal-view-attachments.md) | 2026-02-26 | Universal Message Object Attachments | Generic message object attachment previews/details and compose-flow wiring |
| [SPEC-050](implemented/SPEC-050-2026-02-26-dev-container-setup.md) | 2026-02-26 | Dev Container Setup | VS Code Dev Container configuration for Open Mercato |
| [SPEC-050](implemented/SPEC-050-2026-02-28-example-module-umes-alignment-customer-tasks.md) | 2026-02-28 | Example Module UMES Alignment (Pointer) | Pointer retained; canonical spec is SPEC-046c |
| [SPEC-053](implemented/SPEC-053-2026-03-03-inbox-ops-phase-2.md) | 2026-03-03 | InboxOps Agent Phase 2 | Enhanced InboxOps with additional action types and improved proposal flow |
| [SPEC-054](implemented/SPEC-054-2026-03-04-docker-windows-parity.md) | 2026-03-04 | Docker Windows Parity | Docker-based development workflow aligned for Windows parity |
| [SPEC-057](implemented/SPEC-057-2026-03-04-webhooks-module.md) | 2026-03-04 | Webhooks Module | Outbound/inbound webhooks with Standard Webhooks signing and delivery queues |
| [SPEC-057](implemented/SPEC-057-2026-03-05-standalone-app-ai-folder.md) | 2026-03-05 | Standalone App `.ai` Folder | Dedicated `.ai/` folder for `create-mercato-app` template with adapted skills and UMES reference docs |
| [SPEC-058](implemented/SPEC-058-2026-03-09-order-returns-adjustments.md) | 2026-03-09 | Order Returns & Adjustments | Order return and adjustment workflows for sales |
| [SPEC-058](implemented/SPEC-058-2026-03-10-agentic-tool-setup-standalone-app.md) | 2026-03-10 | Agentic Tool Setup — Standalone App | Agentic tool setup infrastructure for standalone apps |
| [SPEC-059](implemented/SPEC-059-2026-03-11-standalone-app-skills.md) | 2026-03-11 | Standalone App Skills | Standalone app skill definitions and configuration |
| [SPEC-060](implemented/SPEC-060-2026-03-04-customer-identity-portal-auth.md) | 2026-03-04 | Customer Identity & Portal Auth | Customer identity, portal authentication, login/signup/magic links |
| [SPEC-061](implemented/SPEC-061-2026-03-13-official-modules-lifecycle-management.md) | 2026-03-13 | Official Modules Lifecycle Management | Lifecycle management for official module packages |
| [SPEC-062](implemented/SPEC-062-2026-03-13-official-modules-development-monorepo.md) | 2026-03-13 | Official Modules Development Monorepo | Monorepo setup for official module development |
| [SPEC-063](implemented/SPEC-063-2026-03-13-official-modules-verdaccio-prototyping.md) | 2026-03-13 | Official Modules Verdaccio Prototyping | Verdaccio-based prototyping for official module publishing |
| [SPEC-064](implemented/SPEC-064-2026-03-14-official-modules-platform-versioning-policy.md) | 2026-03-14 | Official Modules Platform Versioning Policy | Versioning policy for official module platform compatibility |
| [SPEC-065](implemented/SPEC-065-2026-03-14-official-modules-cli-install-and-eject.md) | 2026-03-14 | Official Modules CLI Install & Eject | CLI commands for installing and ejecting official modules |
| [SPEC-066](implemented/SPEC-066-2026-03-15-official-modules-changesets-release-workflow.md) | 2026-03-15 | Official Modules Changesets Release Workflow | Changesets-based release workflow for official modules |
| [Checkout Pay Links](implemented/2026-03-19-checkout-pay-links.md) | 2026-03-19 | Checkout Pay Links | Pay link generation and checkout flow (Phase A) |
| [Checkout Wireframes](implemented/2026-03-19-checkout-pay-links-wireframes.md) | 2026-03-19 | Checkout Pay Links Wireframes | Companion wireframes for the Checkout Pay Links spec |

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
   - `.ai/specs/{YYYY-MM-DD}-{module-name}.md` for Open Source edition scope
   - `.ai/specs/enterprise/{YYYY-MM-DD}-{module-name}.md` for Enterprise Edition scope
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
