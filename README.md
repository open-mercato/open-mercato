<p align="center">
  <img src="./apps/mercato/public/open-mercato.svg" alt="Open Mercato logo" width="120" />
</p>

# Open Mercato

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Docs](https://img.shields.io/badge/docs-openmercato.com-1F7AE0.svg)](https://docs.openmercato.com/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-ff69b4.svg)](https://github.com/open-mercato/open-mercato/issues)
[![Built with Next.js](https://img.shields.io/badge/Built%20with-Next.js-black?logo=next.js)](https://nextjs.org/)

**Open Mercato - the AI-Engineering Foundation Framework.**

AI code assistants generate code. They don't decide where it goes, how it should be layered, or whether it stays consistent across 30 or 50 engineers in the team.

Open Mercato is the open-source foundation framework that solves it:

- **Architecture-aware AI harness** - agents know where in the project to place code, not just how to write it, they are provided with autonomous skills for everything from adding data table, Design-System coherent forms to implementing whole features with unit and integration tests,
- **Spec-first development** - specs ship with the repo, AI output becomes reproducible
- **Including AI harness and skills for human cooperation** - code review, ticketing flow and debugging
- **Ready-made CRM/ERP domain modules** - start at 80% done
- **Open-source, no lock-in** - full code ownership, no per-seat pricing trap
- **Teachable** - the whole team enters AI-assisted dev, not just 1–2 seniors

End with „almost ready apps”. Ship it pro, ship it fast. We’ve got you!

Built for CTOs who have already deployed Cursor/Copilot and noticed it isn't enough. Built for developers who want to build professional business apps and backends without constantly checking their back.

## Start with 80% done.

**Buy vs. build?** Now, you can have best of both. Use **Open Mercato** enterprise-ready business features like CRM, Sales, OMS, Encryption, and build the remaining **20&percnt;** that really makes the difference for your business.

[![Watch: What “Start with 80% done” means](https://img.youtube.com/vi/53jsDjAXXhQ/maxresdefault.jpg)](https://www.youtube.com/watch?v=53jsDjAXXhQ)


## Core Use Cases

- 🛒 **Commerce** – launch CPQ flows, B2B ordering portals, or full commerce backends with reusable modules.
- 🌐 **Headless/API platform/Custom Backend** – expose rich, well-typed APIs for mobile and web apps using the same extensible data model.
- 💼 **CRM** – model customers, opportunities, and bespoke workflows with infinitely flexible data definitions.
- 🏭 **ERP** – manage orders, production, and service delivery while tailoring modules to match your operational reality.
- 🤝 **Self-service system** – spin up customer or partner portals with configurable forms, guided flows, and granular permissions.
- 🔄 **Workflows** – orchestrate custom data lifecycles and document workflows per tenant or team.
- 🧵 **Production** – coordinate production management with modular entities, automation hooks, and reporting.

## Highlights

- 🧩 **Modular architecture** – drop in your own modules, pages, APIs, and entities with auto-discovery and overlay overrides.
- 🧬 **Custom entities & dynamic forms** – declare fields, validators, and UI widgets per module and manage them live from the admin.
- 🏢 **Multi-tenant by default** – SaaS-ready tenancy with strict organization/tenant scoping for every entity and API.
- 🏛️ **Multi-hierarchical organizations** – built-in organization trees with role- and user-level visibility controls.
- 🛡️ **Feature-based RBAC** – combine per-role and per-user feature flags with organization scoping to gate any page or API.
- ⚡ **Data indexing & caching** – hybrid JSONB indexing and smart caching for blazing-fast queries across base and custom fields.
- 🔔 **Event subscribers & workflows** – publish domain events and process them via persistent subscribers (local or Redis).
- ✅ **Growing test coverage** – expanding unit and integration tests ensure modules stay reliable as you extend them.
- 🧠 **AI-supportive foundation** – structured for assistive workflows, automation, and conversational interfaces.
- ⚙️ **Modern stack** – Next.js App Router, TypeScript, zod, Awilix DI, MikroORM, and bcryptjs out of the box.


## Screenshots

<table>
  <tr>
    <td><a href="./apps/docs/static/screenshots/open-mercato-orders-order-shipments.png"><img src="./apps/docs/static/screenshots/open-mercato-orders-order-shipments.png" alt="Order shipments timeline" width="260"/></a></td>
    <td><a href="./apps/docs/static/screenshots/open-mercato-edit-organization.png"><img src="./apps/docs/static/screenshots/open-mercato-edit-organization.png" alt="Editing an organization" width="260"/></a></td>
    <td><a href="./apps/docs/static/screenshots/open-mercato-users-management.png"><img src="./apps/docs/static/screenshots/open-mercato-users-management.png" alt="Users management view" width="260"/></a></td>
  </tr>
  <tr>
    <td style="text-align:center;">Order Shipments</td>
    <td style="text-align:center;">Organizations</td>
    <td style="text-align:center;">Users</td>
  </tr>
  <tr>
    <td><a href="./apps/docs/static/screenshots/open-mercato-managing-roles.png"><img src="./apps/docs/static/screenshots/open-mercato-managing-roles.png" alt="Managing roles and permissions" width="260"/></a></td>
    <td><a href="./apps/docs/static/screenshots/open-mercato-define-custom-fields.png"><img src="./apps/docs/static/screenshots/open-mercato-define-custom-fields.png" alt="Defining custom fields" width="260"/></a></td>
    <td><a href="./apps/docs/static/screenshots/open-mercato-custom-entity-records.png"><img src="./apps/docs/static/screenshots/open-mercato-custom-entity-records.png" alt="Managing custom entity records" width="260"/></a></td>
  </tr>
  <tr>
    <td style="text-align:center;">Roles &amp; ACL</td>
    <td style="text-align:center;">Custom Fields</td>
    <td style="text-align:center;">Custom Entity Records</td>
  </tr>
  <tr>
    <td><a href="./apps/docs/static/screenshots/open-mercato-people-add-new.png"><img src="./apps/docs/static/screenshots/open-mercato-people-add-new.png" alt="Add new customer form" width="260"/></a></td>
    <td><a href="./apps/docs/static/screenshots/open-mercato-deals-listing.png"><img src="./apps/docs/static/screenshots/open-mercato-deals-listing.png" alt="Deals pipeline board" width="260"/></a></td>
    <td><a href="./apps/docs/static/screenshots/open-mercato-people-notes.png"><img src="./apps/docs/static/screenshots/open-mercato-people-notes.png" alt="Customer notes timeline" width="260"/></a></td>
  </tr>
  <tr>
    <td style="text-align:center;">Add New Customer</td>
    <td style="text-align:center;">Deals Pipeline</td>
    <td style="text-align:center;">Customer Notes</td>
  </tr>
  <tr>
    <td><a href="./apps/docs/static/screenshots/open-mercato-sales-pipeline.png"><img src="./apps/docs/static/screenshots/open-mercato-sales-pipeline.png" alt="Sales pipeline board view" width="260"/></a></td>
    <td><a href="./apps/docs/static/screenshots/open-mercato-orders-order-shipments.png"><img src="./apps/docs/static/screenshots/open-mercato-orders-order-shipments.png" alt="Order shipments timeline" width="260"/></a></td>
    <td><a href="./apps/docs/static/screenshots/open-mercato-orders-order-totals.png"><img src="./apps/docs/static/screenshots/open-mercato-orders-order-totals.png" alt="Order totals breakdown" width="260"/></a></td>
  </tr>
  <tr>
    <td style="text-align:center;">Sales Pipeline</td>
    <td style="text-align:center;">Order Shipments</td>
    <td style="text-align:center;">Order Totals</td>
  </tr>
  <tr>
    <td><a href="./apps/docs/static/screenshots/open-mercato-catalog-products.png"><img src="./apps/docs/static/screenshots/open-mercato-catalog-products.png" alt="Catalog products list" width="260"/></a></td>
    <td><a href="./apps/docs/static/screenshots/open-mercato-sales-channels.png"><img src="./apps/docs/static/screenshots/open-mercato-sales-channels.png" alt="Sales channels overview" width="260"/></a></td>
    <td><a href="./apps/docs/static/screenshots/open-mercato-all-sales-channels-offers.png"><img src="./apps/docs/static/screenshots/open-mercato-all-sales-channels-offers.png" alt="Sales channel offers listing" width="260"/></a></td>
  </tr>
  <tr>
    <td style="text-align:center;">Catalog Products</td>
    <td style="text-align:center;">Sales Channels</td>
    <td style="text-align:center;">Channel Offers</td>
  </tr>
  <tr>
    <td colspan="3" style="text-align:center;" halign="center">
      <a href="./apps/docs/static/screenshots/open-mercato-homepage.png"><img src="./apps/docs/static/screenshots/open-mercato-homepage.png" alt="Home page showing enabled modules" width="520"/></a>
    </td>
  </tr>
  <tr>
    <td colspan="3" style="text-align:center;">Home overview with enabled modules list</td>
  </tr>
</table>


## Architecture Overview

- 🧩 Modules: Each feature lives under `src/modules/<module>` with auto‑discovered frontend/backend pages, APIs, CLI, i18n, and DB entities.
- 🗃️ Database: MikroORM with per‑module entities and migrations; no global schema. Migrations are generated and applied per module.
- 🧰 Dependency Injection: Awilix container constructed per request. Modules can register and override services/components via `di.ts`.
- 🏢 Multi‑tenant: Core `directory` module defines `tenants` and `organizations`. Most entities carry `tenant_id` + `organization_id`.
- 🔐 Security: RBAC roles, zod validation, bcryptjs hashing, JWT sessions, role‑based access in routes and APIs.

Read more on the [Open Mercato Architecture](https://docs.openmercato.com/architecture/system-overview)

## Official Modules

Open Mercato ships with a module system that lets you add features to your app without forking or modifying the platform. The **[Official Modules](https://github.com/open-mercato/official-modules)** repo is where the community publishes those features.

Every module there:

- 🔌 **Installs in one command** — no manual wiring, no config files to edit
- 🔒 **Stays isolated** — each module is its own npm package that hooks into the platform through declared extension points, never by patching core code
- 🧬 **Is ejectable** — run `--eject` to copy the module into your app and own it fully
- 🤝 **Gets reviewed** — every submission goes through core team review before reaching npm

Whether you're adding a small UI widget or shipping a full vertical feature with its own entities, API routes, and admin pages — if it runs on Open Mercato, it belongs there.

## AI Assistant

Open Mercato ships with focused AI assistants that open inside the admin pages where your team already works. Agents are scoped by module, permissions, and tool allowlists, and any write is staged behind an explicit approval card before data changes.

<table>
  <tr>
    <td><a href="apps/docs/static/screenshots/open-mercato-ai-assistant-available-assistants.png"><img src="apps/docs/static/screenshots/open-mercato-ai-assistant-available-assistants.png" alt="AI Assistant global launcher listing available assistants" width="390"/></a></td>
    <td><a href="apps/docs/static/screenshots/open-mercato-ai-assistant-mutations-approvals.png"><img src="apps/docs/static/screenshots/open-mercato-ai-assistant-mutations-approvals.png" alt="AI Assistant mutation approval flow" width="390"/></a></td>
  </tr>
  <tr>
    <td style="text-align:center;">Global launcher</td>
    <td style="text-align:center;">Mutation approvals</td>
  </tr>
</table>

Use the global launcher to find every assistant you can access, or embed `<AiChat>` directly in module pages for contextual workflows such as customer account exploration and catalog merchandising. Operators can tune prompts, downgrade mutation policies, and disable individual tools per tenant without redeploying.

- [Getting started](https://docs.openmercato.com/framework/ai-assistant/overview)
- [How to configure it](https://docs.openmercato.com/framework/ai-assistant/settings)
- [User guide](https://docs.openmercato.com/user-guide/ai-assistant)
- [Legacy MCP assistant docs](.ai/specs/SPEC-012-2026-01-27-ai-assistant-schema-discovery.md)

## Data Encryption

Open Mercato ships with tenant-scoped, field-level data encryption so PII and sensitive business data stay protected while you keep the flexibility of custom entities and fields. Encryption maps live in the admin UI/database, letting you pick which system and custom columns are encrypted; MikroORM hooks automatically encrypt on write and decrypt on read while keeping deterministic hashes (e.g., `email_hash`) for lookups.

Architecture in two lines: Vault/KMS (or a derived-key fallback) issues per-tenant DEKs and caches them so performance stays snappy; AES-GCM wrappers sit in the ORM lifecycle, storing ciphertext at rest while CRUD and APIs keep working with plaintext. Read the docs to dive deeper: [docs.openmercato.com/user-guide/encryption](https://docs.openmercato.com/user-guide/encryption).


## Getting Started

### ⚡ Quick start

**You need:** [Node.js 24](https://nodejs.org/en/download) · [Git](https://git-scm.com/) · PostgreSQL + Redis (easiest via [Docker Desktop](https://www.docker.com/products/docker-desktop/))

<details>
<summary><strong>🔧 Monorepo</strong> — core development / full demo</summary>

```bash
# macOS / Linux
brew install node@24   # or: nvm install 24 && nvm use 24
corepack enable && corepack prepare yarn@4.12.0 --activate

git clone https://github.com/open-mercato/open-mercato.git
cd open-mercato && git checkout develop
docker compose up -d                  # starts PostgreSQL, Redis, Meilisearch
cp apps/mercato/.env.example apps/mercato/.env
# set DATABASE_URL / JWT_SECRET / REDIS_URL in apps/mercato/.env
yarn dev:greenfield                   # installs, builds, seeds, starts the app
```

```powershell
# Windows (PowerShell as Administrator — or use Git Bash / cmd)
# 1. Install Node.js 24 MSI from https://nodejs.org/en/download, then open a new terminal
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
corepack enable; corepack prepare yarn@4.12.0 --activate

git clone https://github.com/open-mercato/open-mercato.git
cd open-mercato; git checkout develop
docker compose up -d                  # or use native PostgreSQL + pgAdmin: https://www.postgresql.org/download/windows/
Copy-Item apps\mercato\.env.example apps\mercato\.env
# set DATABASE_URL / JWT_SECRET / REDIS_URL in apps\mercato\.env
yarn dev:greenfield
```

Open **http://localhost:3000/backend** — credentials printed in the terminal.

</details>

<details>
<summary><strong>📦 Standalone app</strong> — build on Open Mercato without touching the core</summary>

```bash
# macOS / Linux
brew install node@24   # or: nvm install 24 && nvm use 24
corepack enable && corepack prepare yarn@4.12.0 --activate

npx create-mercato-app my-app
cd my-app
docker compose up -d                  # starts PostgreSQL, Redis, Meilisearch
# set DATABASE_URL / JWT_SECRET / REDIS_URL in .env
yarn setup                            # installs, seeds, starts the app
```

```powershell
# Windows (PowerShell as Administrator — or use Git Bash / cmd)
# 1. Install Node.js 24 MSI from https://nodejs.org/en/download, then open a new terminal
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
corepack enable; corepack prepare yarn@4.12.0 --activate

npx create-mercato-app my-app
cd my-app
docker compose up -d                  # or use native PostgreSQL + pgAdmin: https://www.postgresql.org/download/windows/
# set DATABASE_URL / JWT_SECRET / REDIS_URL in .env
yarn setup
```

Open **http://localhost:3000/backend** — credentials printed in the terminal.

</details>

#### Running multiple persistent local instances

To keep two long-lived local instances pointing at the same PostgreSQL server (e.g. `client-a` next to a stock `open-mercato`), pass an optional database-name override to `yarn dev`, `yarn dev:greenfield`, or `yarn setup`:

```bash
# Monorepo: explicit database name; .env update is offered (default yes)
yarn dev:greenfield --database-name=my_db

# Monorepo: derive database name from the current working directory
yarn dev --database-name

# Standalone app: same flag, applied to ./.env
yarn setup --database-name=client_a

# One-off run that does not touch .env (current child process only)
yarn dev --database-name=review_1720 --no-update-env
```

Without the flag, behavior is unchanged (no prompt, no `.env` mutation). See the [installation guides](https://docs.openmercato.com/installation/monorepo) and [`yarn setup`](https://docs.openmercato.com/installation/setup) for details.

---

### Detailed guides (prerequisites, native services, troubleshooting)

Each guide below is self-contained and covers all prerequisites, infrastructure setup (native services or Docker), and every command from zero to a running app.

| | Guide |
|---|---|
| 🔧 **Monorepo** — contribute to the core or demo the full platform | [🍎 macOS](https://docs.openmercato.com/installation/monorepo#macos) · [🐧 Linux](https://docs.openmercato.com/installation/monorepo#linux) · [🪟 Windows](https://docs.openmercato.com/installation/monorepo#windows) |
| 📦 **Standalone app** — build your product without modifying the core | [🍎 macOS](https://docs.openmercato.com/installation/standalone#macos) · [🐧 Linux](https://docs.openmercato.com/installation/standalone#linux) · [🪟 Windows](https://docs.openmercato.com/installation/standalone#windows) |
| 🐧 **Windows with WSL2** — Ubuntu on Windows: memory config, Docker, GitHub CLI, native Postgres bridging | [WSL2 guide →](https://docs.openmercato.com/installation/wsl2) |
| 🐳 **Docker dev** — full containerized dev with hot reload, no local toolchain | [All platforms →](https://docs.openmercato.com/installation/docker) |
| 🚀 **VPS / production** — deploy a full stack to any Linux server | [Deploy guide →](https://docs.openmercato.com/installation/vps) |
| 🛠️ **Dev Container** — zero-install VS Code environment | [Setup guide →](https://docs.openmercato.com/installation/devcontainer) |
| ☁️ **Railway** — one-click cloud deployment | [Railway guide →](https://docs.openmercato.com/installation/railway) |

<table>
  <tr>
    <td align="center">
      <strong>Getting Started for Core Contributions</strong><br/><br/>
      <a href="https://youtu.be/-ba8Bmc56EQ"><img src="https://img.youtube.com/vi/-ba8Bmc56EQ/hqdefault.jpg" alt="Getting Started for Core Contributions" width="400"/></a>
    </td>
    <td align="center">
      <strong>Building Standalone App on Linux/Mac</strong><br/><br/>
      <a href="https://www.youtube.com/watch?v=uJn42SLVyI0"><img src="https://img.youtube.com/vi/uJn42SLVyI0/hqdefault.jpg" alt="Building Standalone App on Linux/Mac" width="400"/></a>
    </td>
    <td align="center">
      <strong>How to install Open Mercato on Windows</strong><br/><br/>
      <a href="https://www.youtube.com/watch?v=eX1SqfDPhkU"><img src="https://img.youtube.com/vi/eX1SqfDPhkU/maxresdefault.jpg" alt="How to Install" width="400"/></a>
    </td>
  </tr>
</table>


## Release Channels

- `latest` is the stable npm channel published from `main`.
- `develop` is the moving prerelease channel published from pushes to `develop`.
- Exact snapshot versions remain installable for debugging or rollback when you need to pin one specific build.

Examples:

```bash
yarn add @open-mercato/core@develop
npx create-mercato-app@develop my-app
```

## Docker Setup

Open Mercato ships two Docker Compose configurations — one for hot-reload development and one for production. Full step-by-step guides with environment variables, troubleshooting, and upgrade instructions:

- 🐳 [Docker dev setup](https://docs.openmercato.com/installation/docker) — hot reload, no local toolchain required
- 🚀 [VPS / production deployment](https://docs.openmercato.com/installation/vps) — full production stack with security guidance and backup instructions
- 🛠️ [Dev Container](https://docs.openmercato.com/installation/devcontainer) — zero-install VS Code environment (12 GB RAM recommended)
- ☁️ [Deploy on Railway](https://docs.openmercato.com/installation/railway) — one-click cloud deployment

## Live demo

[![Explore the Open Mercato live demo](./apps/docs/static/screenshots/open-mercato-onboarding-showoff.png)](https://demo.openmercato.com)

## Documentation

Browse the full documentation at [docs.openmercato.com](https://docs.openmercato.com/).

- [Introduction](https://docs.openmercato.com/introduction/overview)
- [Installation](https://docs.openmercato.com/installation)
- [User Guide](https://docs.openmercato.com/user-guide/overview)
- [Tutorials](https://docs.openmercato.com/tutorials/first-app)
- [Customization](https://docs.openmercato.com/customization/build-first-app)
- [Architecture](https://docs.openmercato.com/architecture/system-overview)
- [Framework](https://docs.openmercato.com/framework/modules/overview)
- [API Reference](https://docs.openmercato.com/api/overview)
- [CLI Reference](https://docs.openmercato.com/cli/overview)
- [Appendix](https://docs.openmercato.com/appendix/troubleshooting)

## Spec Driven Development

Open Mercato follows a **spec-first development approach**. Before implementing new features or making significant changes, we document the design in the `.ai/specs/` folder.

### Why Specs?

- **Clarity**: Specs ensure everyone understands the feature before coding starts
- **Consistency**: Design decisions are documented and can be referenced by humans and AI agents
- **Traceability**: Each spec maintains a changelog tracking the evolution of the feature

### How It Works

1. **Before coding**: Check if a spec exists in `.ai/specs/` (named `{YYYY-MM-DD}-{title}.md`)
2. **New features**: Create or update the spec with your design before implementation
3. **After changes**: Update the spec's changelog with a dated summary

**Naming convention**: Specs use the format `{YYYY-MM-DD}-{title}.md` (e.g., `2026-01-26-sidebar-reorganization.md`)

See [`.ai/specs/README.md`](.ai/specs/README.md) for the full specification directory and [`.ai/specs/AGENTS.md`](.ai/specs/AGENTS.md) for detailed guidelines on maintaining specs.

## Join us on Discord

Connect with the team and other builders in our Discord community: [https://discord.gg/f4qwPtJ3qA](https://discord.gg/f4qwPtJ3qA).

## 🏆 Hall of Fame

Honoring the champions of the **Open Mercato Agentic Hackathon** — Sopot, 10–12 April 2026.

### 🥇 Team MercatoMinds — 378 pts · 36 PRs

| # | Contributor | GitHub | Points | PRs |
|---|-------------|--------|-------:|----:|
| 1 | Michał Strześniewski | [@strzesniewski](https://github.com/strzesniewski) | 106 | 9 |
| 2 | Wiktor Idzikowski | [@WXYZx](https://github.com/WXYZx) | 93 | 11 |
| 3 | Adam Kardasz | [@WH173-P0NY](https://github.com/WH173-P0NY) | 87 | 7 |
| 4 | Karol Roman | [@RMN-45](https://github.com/RMN-45) | 39 | 3 |
| 5 | Adam Kanigowski | [@AK-300codes](https://github.com/AK-300codes) | 29 | 3 |
| 6 | Tomasz Jeleszuk | [@Tomeckyyyy](https://github.com/Tomeckyyyy) | 24 | 3 |

Huge thanks for the incredible energy, craftsmanship, and contributions delivered over the weekend. 🎉

## Contributing

We welcome contributions of all sizes—from fixes and docs updates to new modules. Start by reading [CONTRIBUTING.md](CONTRIBUTING.md) for branching conventions (`main`, `develop`, `feat/<feature>`), release flow, and the full PR checklist. Then check the open issues or propose an idea in a discussion, and:

1. Fork the repository and create a branch that reflects your change.
2. Install dependencies with `yarn install` and bootstrap via `yarn mercato init` (add `--no-examples` to skip demo CRM content; `--stresstest` for thousands of synthetic contacts, companies, deals, and timeline interactions; or `--stresstest --lite` for high-volume contacts without the heavier extras).
3. Develop and validate your changes (`yarn lint`, `yarn test`, or the relevant module scripts).
4. Open a pull request referencing any related issues and outlining the testing you performed.

Refer to [AGENTS.md](AGENTS.md) for deeper guidance on architecture and conventions when extending modules.

Open Mercato is proudly supported by [Catch The Tornado](https://catchthetornado.com/).

<div align="center">
  <a href="https://catchthetornado.com/">
    <img src="./apps/mercato//public/catch-the-tornado-logo.png" alt="Catch The Tornado logo" width="96" />
  </a>
</div>

## CLI Commands

Open Mercato let the module developers to expose the custom CLI commands for variouse maintenance tasks. Read more on the [CLI documentation](https://docs.openmercato.com/cli/overview)

## Considering a project on Open Mercato?

If you're planning to build on Open Mercato, don’t go it alone.

### Certified Partner Agencies

**Reach out to us** - we will connect you with one of our Certified Partner Agencies. Our Partnership Program certifies software consultancies that actively use and contribute to Open Mercato.

Our mission is simple: ensure every Open Mercato deployment is successful, secure, and scalable.

## License

- MIT — see `LICENSE` for details. Enterprise licensing details are documented in [`packages/enterprise/README.md`](packages/enterprise/README.md).

## Enterprise Edition

Open Mercato Core is and always will be MIT Licensed, fully Open Source.

### Open Mercato Enterprise Subscription

The Open Mercato Enterprise Subscription helps ensure your deployment is secure, scalable, and production-ready without surprises before go-live.

It combines certification, expert reviews, and ongoing advisory support for teams building serious systems on Open Mercato.

What’s included:
- Architecture & Production Readiness
- Pre-deployment architecture audit
- Production approval before go-live
- Hosting and deployment best practices
- Security & Quality (monthly reviews)
- Customer Success Manager (pre-go-live)
- Priority technical support channel
- Platform Continuity - access to security patches and new features

Contact us to get support for your implementation: [info@openmercato.com](mailto:info@openmercato.com)

Enterprise features are delivered under the `@open-mercato/enterprise` package (`/packages/enterprise`) and are not part of the open source license scope.
