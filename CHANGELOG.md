# 0.4.4 (2026-02-20)

## Highlights
This release delivers **System-Wide Entity Translations** (SPEC-026) — a complete localization infrastructure for all entity types, the **Enterprise package scaffold**, **Sales Dashboard Widgets**, expanded **OpenAPI coverage** across feature toggles, workflows, attachments, and configs, a new **Integration Test framework** with CRM, Sales, Catalog, Admin ... test coverage (57% overall coverage), and the **UI Confirm dialog migration**. It also ships the **i18n sync checker**, rate limiting on auth endpoints, and numerous bug fixes. This is our biggest community release yet — welcome to **10 first-time contributors**! 🎉

## ✨ Features
- 🌍 System-wide entity translations (SPEC-026) — full localization infrastructure including `entity_translations` table, REST API (`GET/PUT/DELETE /api/translations`), locale management, `TranslationManager` React component with standalone and embedded modes, and translation overlay pipeline. (#552, #566, #585) *(@idziakjakub)*
- 🏗️ Enterprise package scaffold — initial structure for the `@open-mercato/enterprise` package for commercial/enterprise-only modules and overlays. (#580) *(@pkarw)*
- 📊 Sales dashboard widgets — new orders and quotes dashboard widgets with date range filtering, payload caching, and time formatting. (#582) *(@MYMaj)*
- 🔀 OpenAPI response specifications — added missing API response specs across feature toggles, workflows, workflow instances, attachments, library, and configs endpoints. (#581) *(@karolkozer)*
- 🔲 UI confirm dialog migration — unified confirmation dialog pattern (`Cmd/Ctrl+Enter` submit, `Escape` cancel) rolled out across the UI. (#550, #554, #555) *(@AK-300codes)*
- 🧪 Integration test framework — Playwright-based CRM integration tests with API fixtures, self-contained setup/teardown, and CI pipeline support. (#558, #562, #568) *(@pkarw)*
- 🌐 i18n sync checker — usage scanner that detects missing, unused, and out-of-sync translation keys across all locales. (#593) *(@cielecki)*
- 📅 `formatDateTime` and `formatRelativeTime` — extracted to shared `lib/time.ts` with full test coverage. (#586, #589) *(@MYMaj)*
- 🔗 Exposed `TruncatedCell` component for reuse across data table modules. (#560) *(@matgren)*
- 👥 Resource and staff detail form heading alignment — consistent heading layout matching the deals pattern. (#578, #591) *(@sebapaszynski)*
- 🔒 Rate limiting on authentication endpoints — configurable rate limits to protect login, registration, and password reset flows. (#521) *(@sapcik)*

## 🐛 Fixes
- Fixed scheduler issues on local queue strategy (#543). (#575) *(@LukBro)*
- Resolved broken links in notification emails. (#553) *(@LukBro)*
- Fixed MikroORM config to support `sslmode=require` for cloud-hosted PostgreSQL. (#604) *(@maciejsimm)*
- Fixed Docker Compose dev build issues. (#595) *(@MStaniaszek1998)*
- Fixed specs sorting order. (#614) *(@pkarw)*

## 📝 Specs & Documentation
- SPEC-028: Multiple sales pipelines for CRM. (#571) *(@itrixjarek)*
- SPEC-029: Inbox Ops Agent. (#579) *(@haxiorz)*
- SPEC-029: E-commerce/storefront architecture. (#587) *(@kapIsWizard)*
- SPEC-032: Notification template system. (#608) *(@kriss145)*
- SPEC-033: Omnibus Directive price tracking. (#600) *(@strzesniewski)*
- SPEC-031: Database decryption CLI. (#599) *(@strzesniewski)*
- SPEC-ENT-002: SSO & directory sync (enterprise). (#603) *(@MStaniaszek1998)*
- DevCloud infrastructure specification. (#621) *(@MStaniaszek1998)*
- CRM pipeline QA test scenarios (TC-CRM-001..007). (#577) *(@itrixjarek)*
- PostgreSQL port-conflict troubleshooting guide. (#594) *(@kriss145)*

## 📦 Dependencies
- Bump `tar` from 7.5.6 to 7.5.7 — security patch. (#551)

## 👥 Contributors

- @pkarw
- @idziakjakub
- @LukBro
- @MYMaj
- @itrixjarek
- @matgren
- @sebapaszynski
- @haxiorz
- @AK-300codes
- @cielecki
- @MStaniaszek1998
- @strzesniewski
- @kriss145
- @kapIsWizard
- @maciejsimm
- @sapcik
- @karolkozer
- @pat-lewczuk

### 🌟 First-time Contributors

Welcome and thank you to our new contributors! 🙌

- @idziakjakub
- @LukBro
- @MYMaj
- @itrixjarek
- @sebapaszynski
- @cielecki
- @strzesniewski
- @kriss145
- @kapIsWizard
- @maciejsimm

# 0.4.3 (2026-02-13)

## Highlights
This release introduces **`mercato eject`** for deep module customization without forking, a **Version History** system with undo/redo and related-record tracking, **Docker dev mode with hot reload**, **sidebar reorganization**, significant **mobile UX improvements**, and a new **`create-mercato-app`** standalone app workflow. It also ships Windows compatibility fixes, search indexing safeguards, and expanded i18n coverage.

## Features
- Added `mercato eject` CLI command — copy any ejectable core module into your local `src/modules/` for full customization. Nine modules are ejectable at launch: catalog, currencies, customers, perspectives, planner, resources, sales, staff, and workflows. (#514) *(@andrzejewsky)*
- Standalone app development improvements — better `create-mercato-app` scaffolding, module resolver, and generator support for apps outside the monorepo. (#472) *(@andrzejewsky)*
- Documentation for standalone app creation with `create-mercato-app`, module ejection guide, and README updates. (#547) *(@pkarw)*
- Version history system — track entity changes over time with full audit trail. (#479) *(@pkarw)*
- Version history extension — support for related records in version history tracking. (#508, #509) *(@pkarw)*
- `withAtomicFlush` — SPEC-018 extensions for atomic unit-of-work flushing, ensuring consistent data persistence. (#507) *(@pkarw)*
- Compound commands refactor and optimization — improved undo/redo command batching and performance. (#510) *(@pkarw)*
- Docker Compose dev mode with containerized app and hot reload — run the full stack in Docker with source-mounted volumes for automatic rebuilds. Recommended setup for Windows. (#466) *(@Sawarz)*
- Sidebar reorganization — restructured admin navigation for improved discoverability and grouping. (#467) *(@haxiorz)*
- Mobile UI improvements — better responsive layouts and touch interactions across the admin panel. (#518) *(@haxiorz)*
- Form headers and footers reorganization for a cleaner, more consistent CRUD form layout. (#477) *(@pkarw)*
- Prevent auto-reindex feedback loops in search indexing to avoid infinite reindex cycles. (#520) *(@simonkak)*
- Windows build and runtime compatibility spike — fixes for path handling, shell scripts, and platform-specific behaviors. (#516) *(@freakone)*

## Fixes
- Fixed mobile scroll issues reported in #451. (#465) *(@Sawarz)*
- Fixed wrong migration in workflows module (#409). (#474) *(@pat-lewczuk)*
- Fixed `extractUndoPayload` deduplication in the command system. (#480) *(@pkarw)*
- Fixed missing translations in workflows module for pl, es, and de locales. (#489) *(@pat-lewczuk)*
- Added missing translations in business rules module for pl, es, and de locales. (#490) *(@pat-lewczuk)*
- Fixed event emission issues in the events module. (#493) *(@simonkak)*
- Fixed unit of work changes tracking for reliable entity persistence. (#497) *(@pkarw)*
- Fixed search OpenAPI specs — added missing descriptions in OpenAPI params. (#504) *(@simonkak)*
- Fixed CMD+K shortcut opening both Search and AI Assistant dialogs simultaneously. (#506) *(@sapcik)*
- Fixed dark mode rendering in the visual workflow editor. (#534) *(@pat-lewczuk)*
- Fixed missing translations across multiple modules (issue #536). (#538) *(@karolkozer)*
- Added missing pl, de, and es translations in customer detail views (#540). (#541) *(@karolkozer)*
- Added environment variable overrides for superadmin credentials during init. (#459) *(@MStaniaszek1998)*
- Added storage volume configuration for image uploads. (#462) *(@MStaniaszek1998)*
- Improved DataTable pagination layout on mobile. (#503) *(@sapcik)*

## Specs & Documentation
- Two-factor authentication (2FA) specification. (#500) *(@pkarw)*
- Unit of work system solution specification (SPEC-018). (#499) *(@pkarw)*
- POS module specification. (#528) *(@matgren)*
- UI confirmation migration specification. (#530) *(@pat-lewczuk)*
- Financial module specification. (#531) *(@pat-lewczuk)*
- Catalog content localization specification (SPEC-023). (#537) *(@AK-300codes)*
- AI-assisted form suggestion specification. (#542) *(@pat-lewczuk)*
- README installation update. (#515) *(@michaelkrasuski)*

## Agent & Tooling
- Restructured AGENTS.md files with task router, detailed per-module guides, and best practices for Claude agents. (#469, #492, #519) *(@pkarw, @pat-lewczuk)*
- Added spec-writing skill for standardized specification authoring. (#525) *(@matgren)*
- Added code review skill for AI-assisted pull request reviews. (#526) *(@pat-lewczuk)*

## Dependencies
- Bump `npm_and_yarn` group across 1 directory with 2 updates. (#476)
- Bump `@modelcontextprotocol/sdk` from 1.25.3 to 1.26.0. (#487)

# 0.4.2 (2026-01-29)

## Highlights
This release introduces the **Notifications module**, **Agent Skills infrastructure**, **Dashboard Analytics Widgets**, and a major architectural improvement decoupling module setup with a centralized config. It also includes important security fixes, Docker infrastructure improvements, and dependency updates.

## Features
- Full implementation of the in-app notifications system, including notification types, subscribers, custom renderers, and user preferences. (#422, #457) *(@pkarw)*
- Created the foundational structure for agent skills in Open Mercato, enabling extensible AI-powered capabilities. (#455) *(@pat-lewczuk)*
- New analytics widgets for the dashboard, providing richer data visualization and insights. (#408) *(@haxiorz)*
- Decoupled module setup using a centralized `ModuleSetupConfig`, improving modularity and reducing coupling between modules. Resolves #410. (#446) *(@redjungle-as)*
- Reorganized architecture specs and added new specifications for SDD, messages, notifications, progress tracking, and record locking. (#436, #416) *(@pkarw)*
- Addressed CodeQL-identified security issues across the codebase. (#418) *(@pkarw)*

## Fixes
- Fixed an open redirect vulnerability in the authentication session refresh flow. (#429) *(@bartek-filipiuk)*
- Resolved issues in the AI assistant module. (#442) *(@fto-aubergine)*
- Corrected the dialog title for global search and added specs for new widgets. (#440) *(@pkarw)*
- Resolved Docker Compose service conflicts where services were overlapping. (#448, #449) *(@MStaniaszek1998)*
- General Docker Compose configuration fixes. (#423, #424) *(@pkarw)*
- Switched the OpenCode container base image to Debian for better compatibility. (#443) *(@MStaniaszek1998)*

## Infrastructure & DevOps
- Updated the default service port configuration. (#434) *(@MStaniaszek1998)*
- Added a dedicated Dockerfile for building and serving the documentation site. (#425) *(@MStaniaszek1998)*

## Dependencies
- Bump `tar` from 7.5.6 to 7.5.7 — security patch. (#454)
- Bump `npm_and_yarn` group across 2 directories. (#447)

# 0.3.3 (2025-11-16)

## Improvements
- Catalog UI pages - create products page, product price kind settings
- Shifted catalog product attributes onto custom-field fieldsets so vertical-specific definitions travel through CRUD forms, filters, and APIs without bespoke schema code.
- Product edit view now lists variant prices with inline edit/delete controls for quicker maintenance.
- Fixed product edit validation crashes and restricted variant actions to the proper ACL feature to avoid forced re-auth on delete.
- Added variant auto-generation and lighter edit page cards, and fixed the edit link routing for catalog variants.
- Channel offer form now surfaces a validation error if a price override is missing its price kind selection.
- `mercato init` seeds default USD regular and sale price kinds configured as tax-inclusive overrides.

# 0.3.0 (2025-10-31)

## Highlights
- Consolidated modular architecture across auth, customers, sales, dictionaries, query index, and vector search modules.
- Delivered multi-tenant RBAC, CLI scaffolding, and extensibility primitives for module discovery and entity customization.
- Added query index and vector pipelines with coverage monitoring, incremental re-indexing, and pgvector driver support.
- Hardened CRM workflows (tasks, todos, deals, dictionaries, custom data) and sales configuration (catalog, pricing, tax, shipping).
- Stabilized CRUD factories, undo/redo command bus, and background subscribers for predictable data sync.

## Improvements
- Standardized API endpoints, backend pages, and CLI entries for each module.
- Expanded documentation for the framework API, query index, and module guides.
- Introduced profiling flags, coverage metrics, and engine optimizations for faster indexing.
- Enhanced validation, custom field handling, and locale support across UI surfaces.

## Fixes
- Resolved dictionary filtering, customer coverage, ACL feature flags, and access log retention issues.
- Addressed form validation, undo/redo edge cases, and task linkage bugs across CRM pages.
- Improved type safety in API routes, CLI commands, and MikroORM entities.

## Tooling
- Added OpenAPI generator updates and shared registry cleanup.
- Hardened migrations for dictionaries, sales, and query index modules.
- Synchronized vector service CLI, background subscribers, and reindex tooling.

## Previous Releases
Releases prior to 0.3.0 are archived. Refer to git history for full details.
