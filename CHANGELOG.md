# 0.4.8 (2026-03-17)

## Highlights
This release delivers the **Customer Accounts & Portal** (SPEC-060) — a full customer identity and portal authentication module with RBAC, magic links, CRM auto-linking, and an extensible customer portal with dashboard, sidebar, and widget injection. It also ships **Order Returns**, **AI Inbox Phase 2** enhancements, migration generation improvements for standalone apps, and numerous security, validation, and UX fixes.

## ✨ Features

### 👤 Customer Accounts & Portal (SPEC-060)
- Customer Accounts module — two-tier `CustomerUser` identity model with JWT pipeline, invitation system, signup/login/magic links, customer RBAC, and CRM auto-linking. (#973) *(@pat-lewczuk)*
- Customer Portal — extensible portal shell with dashboard, sidebar navigation, notifications, and full UMES widget injection support. (#973) *(@pat-lewczuk)*
- Portal feature toggle gate — portal access gated behind a feature flag for controlled rollout. *(@pat-lewczuk)*
- Admin user management — staff-facing APIs for managing customer accounts from the backoffice. *(@pat-lewczuk)*
- Server-side portal auth and org resolution — eliminated all layout blink on portal pages. *(@pat-lewczuk)*

### 📦 Order Returns
- Full order returns workflow — customers and staff can initiate, review, and process product returns with status tracking. (#907) *(@Sawarz)*

### 🤖 AI Inbox Phase 2
- Enhanced AI-powered inbox operations with improved message processing, action fixes, and agent capabilities. (#976) *(@haxiorz)*

### 🗃️ Other Features
- Integration tests Phase 2 coverage for AI Inbox flows. (#975) *(@janzaremski)*

## 🔒 Security
- 🔑 Require current password for self-service password change — prevents unauthorized password changes from stolen sessions. (#961) *(@mkadziolka)*

## 🐛 Fixes
- 📧 Add client-side email validation to reset password form — prevents invalid submissions before server round-trip. (#974) *(@JSzarras)*
- 📎 Avoid duplicate file-required validation message on attachment fields. (#986) *(@musman)*
- 👥 Fix duplicate "Add address" actions in Customer addresses empty state. (#977) *(@mkadziolka)*
- 💰 Validate price amounts before DB flush to avoid 500 on overflow for very large values (fixes #908). (#963) *(@mkadziolka)*
- 🌍 Translate CRUD validation messages — server-side zod errors now return localized strings. (#962) *(@mkadziolka)*
- 🔐 Localize profile update validation errors in auth module. *(@mkadziolka)*
- 📦 Resolve `workspace:*` protocol leaking into published npm packages. (#985) *(@pat-lewczuk)*
- 🔧 Add missing `"type": "module"` to standalone app template. *(@pat-lewczuk)*
- 🔄 Replace raw `fetch` with `apiCall` in portal hooks and sync template. *(@pat-lewczuk)*

## 🛠️ Improvements
- 🗂️ Migration generation improvements for `@app` modules — separate tsx detection from ts import fallback, idempotent constraint drops, CLI jest alias mapping. (#905) *(@armal)*
- 🐳 Forward ports for PostgreSQL, Redis, and Meilisearch services in dev container. (#957) *(@jhorubala)*
- 📖 Customer accounts AGENTS.md documentation and standalone app guide updates. *(@pat-lewczuk)*

## 🚀 CI/CD & Infrastructure
- 🔧 CI release flow and canary publish fixes. *(@pkarw)*
- 📦 Dependabot security insights integration. *(@pkarw)*

## 👥 Contributors

- @pat-lewczuk
- @Sawarz
- @haxiorz
- @mkadziolka
- @janzaremski
- @JSzarras
- @armal
- @pkarw
- @jhorubala
- @musman

---

# 0.4.7 (2026-03-12)

## Highlights
This release delivers the **Integration Marketplace** with Payment Gateways, Shipping Carriers hubs, and the first integration provider — **Akeneo PIM sync** (SPEC-044/045c/045h). It also ships **Agentic Tool Setup** for standalone apps (SPEC-058), **Docker Command Parity** for Windows developers (SPEC-054), a critical **session invalidation security fix**, **Railway deployment** support, and numerous sales and UX bug fixes.

## ✨ Features

### 🔌 Integration Marketplace — Payment & Shipping Hubs (SPEC-044/045c/045h)
- Payment Gateways hub module — unified `GatewayAdapter` contract, payment session lifecycle (create/capture/refund/cancel), transaction entity with status machine, webhook receiver with signature verification, status polling worker, and admin UI. (#859) *(@pkarw)*
- Shipping Carriers hub module — unified carrier adapter contract, shipment tracking, label generation, and rate calculation infrastructure. (#859) *(@pkarw)*
- Akeneo PIM integration provider — full product sync adapter with field mapping, scheduled sync, and Integration Marketplace wiring. (#935) *(@pkarw)*

### 🤖 Agentic Tool Setup for Standalone Apps (SPEC-058)
- Standalone app developers using AI coding tools now get auto-generated AGENTS.md, CLAUDE.md, and tool configuration out of the box. (#932) *(@pat-lewczuk)*

### 🐳 Docker Command Parity for Windows (SPEC-054)
- Cross-platform Docker command wrappers (`scripts/docker-exec.mjs`) enabling Windows developers to run any monorepo command from their native terminal without WSL. (#866) *(@dominikpalatynski)*

### 🗃️ Other Features
- 🏠 Moved demo-credentials hint from /login to the start page for production build visibility. (#873) *(@mkadziolka)*

## 🔒 Security
- 🔑 Invalidate all user sessions (access + refresh tokens) on password change and reset — prevents stolen token reuse. (#888) *(@mkadziolka)*

## 🐛 Fixes
- 🛒 Cancel/back on document creation now returns to the correct list page instead of `/backend/sales/channels`. (#942) *(@rengare)*
- 📦 Auto-select primary shipping address when a customer is chosen on document creation forms. (#943) *(@rengare)*
- 🖼️ Enrich quote/order line images with current product media when catalog images are updated. (#914) *(@piorot)*
- 🔍 Scroll active result into view on arrow key navigation in global search dialog. (#884) *(@MrBuldops)*
- 🔐 Show access denied page instead of login redirect for authenticated users lacking permissions (#807). (#874) *(@Gajam19)*
- 🔧 Fix deal pipeline data not saving when adding a new deal. (#924) *(@MYMaj)*
- 📋 Display fallback "Select" option when form value is empty — fixes TenantSelect validation mismatch. (#882) *(@wisniewski94)*
- 💰 Handle price variant validation properly with improved coverage (#904). (#913) *(@Magiczne)*
- 📦 Return user-friendly validation error for duplicate SKU instead of 500 (#909). (#912) *(@michal1986)*
- 🔄 Finish duplicate definition flow in workflows and add regression tests. (#887) *(@mkadziolka)*
- 🔢 Validate quantity limit on sales line items to prevent `NUMERIC field overflow` on extremely large values (#920). (#925) *(@michal1986)*
- 🕐 Consistent timestamp format in Payments table tooltip — localized time instead of raw UTC ISO string (#946). (#951) *(@michal1986)*
- 💳 Fix payment method not displayed in Order Details after adding a payment (#947). (#952) *(@michal1986)*

## 🧪 Testing
- 🔍 Cover search fallback presenter and improve name/title resolution with unit tests. (#886) *(@mkadziolka)*
- 🔑 Add route-level GET tests for `/api/auth/users` and `/api/auth/roles` with tenant/RBAC filtering. (#885) *(@mkadziolka)*

## 📝 Specs & Documentation
- 📋 SPEC-060: Customer Identity & Portal Authentication — two-tier `CustomerUser` identity model with RBAC, JWT pipeline, invitation system, and CRM auto-linking. (#863) *(@pat-lewczuk)*
- 📖 Add screenshots and fix search documentation to match actual codebase state (#331). (#881) *(@MrBuldops)*

## 🚀 CI/CD & Infrastructure
- 🚂 Railway deployment support with dependency hardening — fixes `@ai-sdk/openai` version conflicts and hoisting issues. (#937) *(@freakone)*

## 👥 Contributors

- @pkarw
- @pat-lewczuk
- @mkadziolka
- @rengare
- @MrBuldops
- @dominikpalatynski
- @michal1986
- @piorot
- @MYMaj
- @freakone

### 🌟 First-time Contributors

Welcome and thank you to our new contributors! 🙌

- @mkadziolka
- @Magiczne
- @wisniewski94
- @Gajam19

---

# 0.4.6 (2026-03-06)

## Highlights
This release delivers **Single Sign-On (SSO)** 🔐 — a full enterprise-grade SSO module with OIDC, SCIM directory sync, and JIT provisioning supporting Google Workspace, Microsoft Entra ID, and Zitadel. It also ships the **Integration Hub** foundation (SPEC-045a/b), **VS Code Dev Container** for one-click development, major **UMES progression** (phases E–N covering mutation lifecycle, query engine extensibility, recursive widgets, DevTools, and integration extensions), **SSE-based real-time notifications & progress**, **Actionable Notifications** (SPEC-042/043), **AI Inbox Phase 2**, and **Preview Environments** for QA. Welcome to **7 first-time contributors**! 🎉

## ✨ Features

### 🔐 Single Sign-On (SSO) — Enterprise
- Full SSO module with OIDC provider support (Google Workspace, Microsoft Entra ID, Zitadel) including login flow, error handling, and email verification. (#765) *(@MStaniaszek1998, @pkarw)*
- SCIM 2.0 directory sync with filter and patch operations for automated user provisioning. *(@pkarw)*
- Just-In-Time (JIT) provisioning with mutual exclusivity enforcement between JIT and SCIM modes. *(@pkarw)*
- Administrator UI for configuring SSO domains via widget injection (decoupled from core auth). *(@pkarw)*
- Google Workspace OIDC blockers resolved with automatic provider detection. *(@pkarw)*
- Security audit fixes addressing critical and high severity findings. *(@pkarw)*
- Enterprise feature flag toggle for SSO module visibility. *(@pkarw)*
- SSO documentation with setup guides for Entra ID, Google Workspace, and Zitadel. (#862) *(@MStaniaszek1998)*
- Multi-language i18n support (EN, PL, DE, ES) for all SSO strings. *(@pkarw)*

### 🔌 Integration Hub (SPEC-045)
- 🏪 Integration Marketplace foundation — registry, bundles, credentials, state management, health checks, logs, and admin UI. (#831) *(@pkarw)*
- 🔄 Data Sync Hub — adapters, run lifecycle, workers, mapping APIs, scheduled sync, and progress linkage. (#831) *(@pkarw)*
- 📋 Gap-filling for integration hub specifications and edge cases. (#828) *(@pkarw)*

### 🔄 UMES (Unified Module Event System) — Phases E–N
- 📦 Phases E–H — extended module event patterns and subscriber infrastructure. (#751) *(@pkarw)*
- 🔗 Phase L — integration extensions enabling cross-module event wiring. (#781) *(@pat-lewczuk)*
- 🧬 Phase M — mutation lifecycle hooks (m1–m4) with before/after guards and sync subscribers. (#782) *(@pat-lewczuk)*
- 🔍 Phase N — query engine extensibility with query-level enrichers and sync query events. (#811) *(@pat-lewczuk)*
- 🔁 Phase J — recursive widgets for nested injection patterns. (#821) *(@pkarw)*
- 🛠️ Phase K — UMES DevTools with conflict detection for debugging event flows. (#834) *(@pat-lewczuk)*

### 📢 Actionable Notifications & Multi-ID Filtering (SPEC-042/043)
- Actionable notification handlers with `useNotificationEffect`, record locks polling refactor, and filter-by-IDs query parameter support. (#797) *(@pkarw)*

### 📡 SSE Real-Time Notifications & Progress
- Migration of progress tracking and notifications from polling to Server-Sent Events (SSE) for real-time browser updates. (#810) *(@pkarw)*

### 🤖 AI Inbox Phase 2 (SPEC-053)
- Enhanced AI-powered inbox operations with improved message processing and agent capabilities. (#816) *(@haxiorz)*

### 🐳 VS Code Dev Container
- One-click development setup with full VS Code Dev Container configuration (PostgreSQL, Redis, Elasticsearch). (#758) *(@kurrak)*
- Dev container maintenance skill and migration to Debian-slim base image. *(@pkarw)*
- Corepack download prompt disabled in lifecycle scripts. *(@pkarw)*

### 🚀 Preview Environments
- Preview Docker build stage and entrypoint script for automated QA environment deployments. *(@pkarw)*
- QA deployment documentation for Dokploy-based ephemeral environments. (#851) *(@dominikpalatynski)*

### 🧹 Code Quality
- SPEC-051 deduplication — SonarQube-safe phase 1 removing code duplications across modules. (#813) *(@haxiorz)*
- SonarQube fixes first batch — addressing static analysis findings. (#784) *(@haxiorz)*
- Mandatory CI/CD-like verification gate added to code-review skill. (#788) *(@haxiorz)*

### 🗃️ Other Features
- 🐘 Support for custom PostgreSQL schema via `DATABASE_URL` — enables multi-schema deployments. (#753) *(@jtomaszewski)*
- 💬 Universal message object attachments for the messages module. (#756) *(@dominikpalatynski)*
- 🔔 Unified notification and message icons across the platform. (#836) *(@karolkozer)*
- 📊 SPEC-050 catalog unit tests phase 1. (#766) *(@migsilva89)*
- 📜 Messages ACL check reworked for backward compatibility. (#762) *(@pkarw)*
- 🔧 AI Inbox Actions Phase 1 gap fixes. (#760) *(@haxiorz)*
- 🖱️ Added scroll function for improved UX navigation. (#789) *(@michal1986)*

## 🐛 Fixes
- 💰 Variant price no longer decreases by VAT on reopen — fixes pricing recalculation bug. (#786) (#860) *(@knatalicz)*
- 🔄 CrudForm infinite loop — resolved re-render loop in form initialization. (#845) *(@haxiorz)*
- 📄 Hide pagination bar on empty results and fix loading flash. (#806) (#867) *(@rengare)*
- 🧭 Reset stale breadcrumb on client-side navigation. (#847) (#848) *(@knatalicz)*
- 💱 Correct `handleSetBase` API path in currencies module. (#843) (#844) *(@knatalicz)*
- 🤖 AI assistant visibility fix — proper feature flag toggling. (#852) (#855) *(@MrBuldops)*
- 👥 Fix `updatedAt` value in customer people API route. (#812) *(@karolkozer)*
- ✅ Resolve 404 loop and duplicate loading/error state in CustomerTodosTable. (#808) (#850) *(@michal1986)*
- 🔍 Fix search settings visibility. (#746) (#840) *(@MrBuldops)*
- 📂 TenantSelect 400 error, misleading validation response, and missing auto-select. (#857) (#858) *(@knatalicz)*
- 🌙 Fix text not visible in dropdown using dark mode. (#800) *(@haxiorz)*
- 🚪 Fix dead-end screens UX — improved navigation fallbacks. (#801) *(@haxiorz)*
- 🔧 Remove redundant ternary branches in DataTable error display. (#839) *(@rengare)*
- 🪟 Fix create-app Windows ESM import compatibility. (#776) *(@armal)*
- 🧩 Zod v4 `.partial()` on refined product schema. (#750) *(@andrzejewsky)*
- 🔑 Update `requireFeatures` for GET requests in metadata to align with permissions. *(@pkarw)*
- 🐳 Remove preview stage from root Dockerfile. (#865) *(@dominikpalatynski)*
- 🪟 Normalize shell script EOL and set Testcontainers Docker Desktop overrides for Windows. *(@pkarw)*
- 🔒 CodeQL security fixes. *(@pkarw)*

## 📝 Specs & Documentation
- 📋 SPEC-053: B2B PRM Starter & Operations documentation. (#826) *(@matgren)*
- 📋 SPEC-037: WhatsApp external communication + AI chat integration. (#674) *(@MastalerzKamil)*
- 📋 SPEC-046b/046c: Customer detail workstreams alignment. (#771) (#775) *(@matgren, @michal1986)*
- 📋 SPEC-051: Code duplication fixes specification. (#799) *(@haxiorz)*
- 📖 UMES Phase N implementation documentation. (#829) *(@pat-lewczuk)*
- 📖 Updated README and QA deployment guide for ephemeral environments. (#851) *(@dominikpalatynski)*
- 📖 Database migration docs update. (#767) *(@kriss145)*

## 🚀 CI/CD & Infrastructure
- 🐳 Dev Container setup with Docker Compose, lifecycle scripts, and Debian-slim base. (#758)
- 🚀 Preview environment Docker build stage for automated QA deployments.
- 🔒 CodeQL security scanning fixes across the codebase.

## 👥 Contributors

- @pkarw
- @pat-lewczuk
- @haxiorz
- @knatalicz
- @dominikpalatynski
- @michal1986
- @karolkozer
- @jtomaszewski
- @MStaniaszek1998
- @matgren
- @rengare
- @MrBuldops
- @migsilva89
- @andrzejewsky
- @kriss145

### 🌟 First-time Contributors

Welcome and thank you to our new contributors! 🙌

- @armal
- @kurrak
- @rengare
- @knatalicz
- @MrBuldops
- @kjuliaa
- @MastalerzKamil

---

# 0.4.5 (2026-02-26)

## Highlights
This release delivers the **Unified Module Event System (UMES)** — a major architectural upgrade unifying all module events across the platform, the **Messages module**, **Multiple CRM Pipelines** (SPEC-028), **Units of Measure**, **Record Locking** (enterprise), **Inbox Email Parser Phase 1**, the **Progress Tracking module**, **Database Decryption CLI** (SPEC-031), and **header-based auth token refresh** for mobile/API clients. It also ships significant CI/CD improvements, expanded test coverage, and numerous bug fixes. Welcome to **19 first-time contributors**!

## ✨ Features
- 🔄 Unified Module Event System (UMES) — phases A+B+C+D implementing a unified, typed event infrastructure across all modules with consistent emit/subscribe patterns and client broadcast support. (#734) *(@pkarw)*
- 💬 Messages module — full in-app messaging system for internal communication between users. (#569) *(@dominikpalatynski)*
- 🔀 Multiple CRM pipelines (SPEC-028) — support for multiple sales pipelines in CRM with configurable stages, drag-and-drop, and pipeline switching. (#694) *(@MYMaj)*
- 📏 Units of measure — define and manage measurement units for products and inventory tracking. (#636) *(@msoroka)*
- 🔐 Record locking (SPEC-005, enterprise) — pessimistic record locking to prevent concurrent edit conflicts. (#635) *(@pkarw)*
- 📧 Inbox Email Parser Phase 1 — initial email parsing infrastructure for the Inbox Ops module. (#682) *(@haxiorz)*
- ⏳ Progress tracking module — real-time progress tracking for long-running operations with UI feedback. (#645) *(@piotrchabros)*
- 🔓 Database decryption CLI (SPEC-031) — CLI tool for decrypting encrypted database fields for data export and migration. (#610) *(@strzesniewski)*
- 🔑 Header-based token refresh for mobile/API clients — enables auth token refresh via response headers, supporting non-browser clients. (#729) *(@jtomaszewski)*
- 🌍 Translations command pattern with undo — save/delete translation operations now use the command pattern for undo/redo support. (#695) *(@marcinwadon)*
- 🔍 Autocomplete in events selector — improved event selection UX with type-ahead search. (#654) *(@karolkozer)*
- 🐳 Auto-detect Docker socket from active context — CLI now automatically detects the correct Docker socket. (#727) *(@jtomaszewski)*
- 📅 DatePicker/DateTimePicker components (SPEC-034) — new reusable date and datetime picker UI components. (#663) *(@michal1986)*
- 🧹 Removed scaffolding code from CLI — cleaner CLI codebase with updated AGENTS.md. (#726) *(@kurs0n)*
- 🗂️ Module directory scanning refactor — improved module registry with cleaner directory scanning. (#598) *(@redjungle-as)*
- 🎨 Layout refactor with buttons — improved layout consistency and button patterns. (#638) *(@kriss145)*

## 🐛 Fixes
- 🔧 Pre-release fixes for v0.4.5 stability. (#747) *(@pkarw)*
- 🔗 Parse Redis URL before passing to BullMQ — fixes queue connections with `redis://` URLs. (#737) *(@jtomaszewski)*
- 🌙 Fix SEO widget headers invisible in dark mode. (#733) *(@karolkozer)*
- 👤 Fix user update command in auth module. (#732) *(@michal1986)*
- 🔍 Fix vector search ignoring selected organization — search now properly scopes to tenant. (#730) *(@gsobczyk)*
- 🛡️ Fix superadmin null orgId returning 401 — superadmin requests now handled correctly. (#701) *(@Dawidols)*
- 🌐 Replace hardcoded strings with translation keys and add missing translations. (#693) *(@marcinwadon)*
- 🔗 Restore dynamic User Entities sidebar links in auth/UI. (#677) *(@adam-marszowski)*
- 📝 Fix translations CrudForm integration for all entity types. (#656) *(@idziakjakub)*
- 📦 Align module metadata with ModuleInfo type across all packages. (#655) *(@piorot)*
- 🏗️ Rebuild packages after generate in dev:greenfield script. (#652) *(@michalpikosz)*
- 🔄 Prevent CrudForm from resetting fields on initialValues change. (#650) *(@marcinprusinowski)*
- 🛠️ dev:greenfield ephemeral dev mode for working-trees. (#648) *(@pkarw)*
- 📐 Align resource detail header with version history pattern. (#639) *(@sebapaszynski)*
- 🌍 Fix base values not displayed in Translation Manager. (#637) *(@idziakjakub)*
- 🧹 Deduplication and code cleanup refactor. (#628) *(@mkutyba)*
- 📜 Fix SPEC-006 show action and comments in History. (#681) *(@MYMaj)*

## 🧪 Testing
- 🧪 Integration tests for staff module. (#745) *(@Eclip7e)*
- 📈 Improved test code coverage across modules. (#683) *(@janzaremski)*
- 🧪 SPEC-030 catalog unit tests. (#632) *(@migsilva89)*
- 🔄 Add standalone app integration tests to snapshot CI. (#714) *(@andrzejewsky)*

## 📝 Specs & Documentation
- 📋 UMES specification — initial Unified Module Event System spec. (#710) *(@pkarw)*
- 📋 SPEC-029: User Invite via Email. (#689) *(@matgren)*
- 📋 SPEC-037: Promotions module. (#680) *(@B0G3)*
- 📋 SPEC-034: Document Parser Module. (#665) *(@fto-aubergine)*
- 📋 SPEC-006 v2: Version History update. (#646) *(@MYMaj)*
- 📖 Improve standalone-app guide and add cross-links from overview and setup pages. (#705) *(@abankowski)*
- 📖 Surface `create-mercato-app` in docs and homepage. (#713) *(@andrzejewsky)*
- 📖 Fix deprecated module creation guide. (#643) *(@abankowski)*
- 📖 Lessons learned and AGENTS.md update for the UI package. (#649) *(@pkarw)*
- 📖 Update enterprise description in README. (#692) *(@pat-lewczuk)*
- 🤖 AI skills: add Socratic questions skills. (#715) *(@michal1986)*

## 🚀 CI/CD & Infrastructure
- 📣 GitHub Actions annotations for test and lint errors. (#718) *(@jtomaszewski)*
- 🔄 Unify snapshot and canary release into a single workflow. (#711) *(@andrzejewsky)*
- 🔧 Fix standalone app: sync i18n templates and add scheduler to publish. (#709) *(@andrzejewsky)*
- 🔧 Add dedicated develop-branch release workflow. (#707) *(@andrzejewsky)*

## 👥 Contributors

- @pkarw
- @jtomaszewski
- @andrzejewsky
- @MYMaj
- @karolkozer
- @michal1986
- @marcinwadon
- @idziakjakub
- @haxiorz
- @abankowski
- @pat-lewczuk
- @matgren
- @sebapaszynski

### 🌟 First-time Contributors

Welcome and thank you to our new contributors! 🙌

- @dominikpalatynski
- @msoroka
- @piotrchabros
- @Eclip7e
- @gsobczyk
- @Dawidols
- @adam-marszowski
- @piorot
- @michalpikosz
- @marcinprusinowski
- @mkutyba
- @janzaremski
- @migsilva89
- @B0G3
- @kurs0n
- @jtomaszewski
- @marcinwadon
- @michal1986
- @abankowski

---

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
