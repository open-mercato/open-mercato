<p align="center">
  <img src="./public/open-mercato.svg" alt="Open Mercato logo" width="120" />
</p>

# Open Mercato

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Docs](https://img.shields.io/badge/docs-openmercato.com-1F7AE0.svg)](https://docs.openmercato.com/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-ff69b4.svg)](https://github.com/open-mercato/open-mercato/issues)
[![Built with Next.js](https://img.shields.io/badge/Built%20with-Next.js-black?logo=next.js)](https://nextjs.org/)

Open Mercato is a new‑era, AI‑supportive platform for shipping enterprise‑grade CRMs, ERPs, and commerce backends. It’s modular, extensible, and designed so teams can mix their own modules, entities, and workflows while keeping the guardrails of a production-ready stack.

## Core Use Cases

- 💼 **CRM** – model customers, opportunities, and bespoke workflows with infinitely flexible data definitions.
- 🏭 **ERP** – manage orders, production, and service delivery while tailoring modules to match your operational reality.
- 🛒 **Commerce** – launch CPQ flows, B2B ordering portals, or full commerce backends with reusable modules.
- 🤝 **Self-service system** – spin up customer or partner portals with configurable forms, guided flows, and granular permissions.
- 🔄 **Workflows** – orchestrate custom data lifecycles and document workflows per tenant or team.
- 🛎️ **Services** – oversee bookings, team availability, and resource scheduling from a centralized workspace.
- 🧵 **Production** – coordinate production management with modular entities, automation hooks, and reporting.
- 🌐 **Headless/API platform** – expose rich, well-typed APIs for mobile and web apps using the same extensible data model.

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
    <td><a href="docs/static/screenshots/open-mercato-dashboard.png"><img src="docs/static/screenshots/open-mercato-dashboard.png" alt="Open Mercato dashboard" width="260"/></a></td>
    <td><a href="docs/static/screenshots/open-mercato-edit-organization.png"><img src="docs/static/screenshots/open-mercato-edit-organization.png" alt="Editing an organization" width="260"/></a></td>
    <td><a href="docs/static/screenshots/open-mercato-users-management.png"><img src="docs/static/screenshots/open-mercato-users-management.png" alt="Users management view" width="260"/></a></td>
  </tr>
  <tr>
    <td style="text-align:center;">Dashboard</td>
    <td style="text-align:center;">Organizations</td>
    <td style="text-align:center;">Users</td>
  </tr>
  <tr>
    <td><a href="docs/static/screenshots/open-mercato-managing-roles.png"><img src="docs/static/screenshots/open-mercato-managing-roles.png" alt="Managing roles and permissions" width="260"/></a></td>
    <td><a href="docs/static/screenshots/open-mercato-define-custom-fields.png"><img src="docs/static/screenshots/open-mercato-define-custom-fields.png" alt="Defining custom fields" width="260"/></a></td>
    <td><a href="docs/static/screenshots/open-mercato-custom-entity-records.png"><img src="docs/static/screenshots/open-mercato-custom-entity-records.png" alt="Managing custom entity records" width="260"/></a></td>
  </tr>
  <tr>
    <td style="text-align:center;">Roles &amp; ACL</td>
    <td style="text-align:center;">Custom Fields</td>
    <td style="text-align:center;">Custom Entity Records</td>
  </tr>
  <tr>
    <td colspan="3" style="text-align:center;" halign="center">
      <a href="docs/static/screenshots/open-mercato-homepage.png"><img src="docs/static/screenshots/open-mercato-homepage.png" alt="Home page showing enabled modules" width="520"/></a>
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


## Getting Started

Follow these steps after the prerequisites are in place:

1. **Clone the repository**
   ```bash
   git clone https://github.com/open-mercato/open-mercato.git
   cd open-mercato
   ```

2. **Install workspace dependencies**
   ```bash
   yarn install
   ```

3. **Bootstrap everything with one command**
   ```bash
   yarn mercato init
   ```
   This script prepares module registries, generates/applies migrations, seeds default roles, and provisions an admin user.

4. **Launch the app**
   ```bash
   yarn dev
   ```
   Navigate to `http://localhost:3000/backend` and sign in with the credentials printed by `yarn mercato init`.

   > Optional: create a `.env.local` file with `VECTOR_SEARCH_OPENAI_API_KEY=<your OpenAI key>` (or reuse `OPENAI_API_KEY`) so the new vector search overlay can generate embeddings.

💡 Need a clean slate? Run `yarn mercato init --reinstall`. It wipes module migrations and **drops the database**, so only use it when you intentionally want to reset everything.

Full installation guide (including prerequisites and cloud deployment): [docs.openmercato.com/installation/setup](https://docs.openmercato.com/installation/setup)

## Contributing

We welcome contributions of all sizes—from fixes and docs updates to new modules. Start by checking the open issues or proposing an idea in a discussion, then:

1. Fork the repository and create a branch that reflects your change.
2. Install dependencies with `yarn install` and bootstrap via `yarn mercato init`.
3. Develop and validate your changes (`yarn lint`, `yarn test`, or the relevant module scripts).
4. Open a pull request referencing any related issues and outlining the testing you performed.

Refer to [AGENTS.md](AGENTS.md) for deeper guidance on architecture and conventions when extending modules.

Open Mercato is proudly supported by [Catch The Tornado](https://catchthetornado.com/).

<div align="center">
  <a href="https://catchthetornado.com/">
    <img src="./public/catch-the-tornado-logo.png" alt="Catch The Tornado logo" width="96" />
  </a>
</div>

## CLI Commands

Open Mercato let the module developers to expose the custom CLI commands for variouse maintenance tasks. Read more on the [CLI documentation](https://docs.openmercato.com/cli/overview)


## Documentation

Explore the [full project documentation](https://docs.openmercato.com/) - quick links to the main sections:

- [Introduction](https://docs.openmercato.com/introduction/overview)
- [Installation](https://docs.openmercato.com/installation/setup)
- [User Guide](https://docs.openmercato.com/user-guide/overview)
- [Tutorials](https://docs.openmercato.com/tutorials/first-app)
- [Customization](https://docs.openmercato.com/customization/build-first-app)
- [Architecture](https://docs.openmercato.com/architecture/system-overview)
- [Framework](https://docs.openmercato.com/framework/modules/overview)
- [API Reference](https://docs.openmercato.com/api/overview)
- [CLI Reference](https://docs.openmercato.com/cli/overview)
- [Appendix](https://docs.openmercato.com/appendix/troubleshooting)

## License

- MIT — see `LICENSE` for details.
