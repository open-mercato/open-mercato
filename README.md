# 🚀 Open Mercato
Open Mercato is a new‑era, AI‑supportive platform for shipping enterprise‑grade CRMs, ERPs, and commerce backends. It’s modular, extensible, and designed so teams can mix their own modules, entities, and workflows while keeping the guardrails of a production-ready stack.

## Core Use Cases

- 💼 **CRM** – model customers, opportunities, and bespoke workflows with infinitely flexible data definitions.
- 🏭 **ERP** – manage orders, production, and service delivery while tailoring modules to match your operational reality.
- 🛒 **Commerce** – launch CPQ flows, B2B ordering portals, or full commerce backends with reusable modules.
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
    <td colspan="3" style="text-align:center;">
      <a href="docs/static/screenshots/open-mercato-homepage.png"><img src="docs/static/screenshots/open-mercato-homepage.png" alt="Home page showing enabled modules" width="520"/></a>
    </td>
  </tr>
  <tr>
    <td colspan="3" style="text-align:center;">Home overview with enabled modules list</td>
  </tr>
</table>

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

💡 Need a clean slate? Run `yarn mercato init --reinstall`. It wipes module migrations and **drops the database**, so only use it when you intentionally want to reset everything.

Full installation guide (including prerequisites and cloud deployment): [docs.openmercato.com/installation/setup](https://docs.openmercato.com/installation/setup)

### `yarn mercato init` output preview

```text
🎉 App initialization complete!

╔══════════════════════════════════════════════════════════════╗
║  🚀 You're now ready to start development!                   ║
║                                                              ║
║  Start the dev server:                                       ║
║    yarn dev                                                  ║
║                                                              ║
║  Users created:                                              ║
║    👑 Superadmin: superadmin@acme.com                        ║
║       Password: secret                                       ║
║    🧰 Admin:      admin@acme.com                             ║
║       Password: secret                                       ║
║    👷 Employee:   employee@acme.com                          ║
║       Password: secret                                       ║
║                                                              ║
║  Happy coding!                                               ║
╚══════════════════════════════════════════════════════════════╝
```

## Example: Todos with Custom Fields

The example module ships a simple Todos demo that showcases custom fields and the unified query layer.

Steps:

1) Ensure migrations are applied and global custom fields are seeded
- `yarn db:migrate` (runs migrations and seeds global custom fields)

2) Create an organization and admin user
- `yarn mercato auth setup --orgName "Acme" --email admin@acme.com --password secret --roles superadmin,admin`
- Note the printed `organizationId` (use it below)

3) Seed example Todos (entity + per‑org custom field definitions + sample data)
- `yarn mercato example seed-todos --org <organizationId> --tenant <tenantId>`

4) Open the Todos page
- Visit `/backend/example/todos` to filter/sort on base fields and custom fields (e.g., priority, severity, blocked).

## CLI Commands

### Quick Setup Commands

#### `yarn init` - Complete App Initialization
One-command setup that prepares the entire application:
```bash
# Basic setup with defaults
yarn init

# Custom setup
yarn init --org="My Company" --email="admin@mycompany.com" --password="mypassword" --roles="superadmin,admin"
```

**What it does:**
- Installs dependencies
- Prepares modules (registry, entities, DI)
- Generates database migrations
- Applies migrations
- Seeds default roles
- Creates admin user
- Seeds example todos
- Displays success message with admin credentials

#### `yarn db:greenfield` - Clean Slate Setup
Removes all migrations, snapshots, and checksum files for a fresh start:
```bash
yarn db:greenfield
```

**What it cleans:**
- Migration files (`Migration*.ts`)
- Snapshot files (`*.json` containing "snapshot")
- Checksum files (`*.checksum`)
- All modules (auth, entities, directory, example)

### Database Commands

#### `yarn db:generate` - Generate Migrations
Generates database migrations for all modules:
```bash
yarn db:generate
```

#### `yarn db:migrate` - Apply Migrations
Applies all pending migrations and seeds global custom fields:
```bash
yarn db:migrate
```

### Auth Module Commands

#### `yarn mercato auth setup` - Create Organization & Admin
Creates a tenant, organization, and admin user:
```bash
yarn mercato auth setup --orgName "Acme" --email admin@acme.com --password secret --roles superadmin,admin
```

#### `yarn mercato auth list-orgs` - List Organizations
Lists all organizations in the system:
```bash
yarn mercato auth list-orgs
```

#### `yarn mercato auth list-tenants` - List Tenants
Lists all tenants in the system:
```bash
yarn mercato auth list-tenants
```

#### `yarn mercato auth list-users` - List Users
Lists all users with filtering options:
```bash
# List all users
yarn mercato auth list-users

# Filter by organization
yarn mercato auth list-users --org <organizationId>

# Filter by tenant
yarn mercato auth list-users --tenant <tenantId>
```

#### `yarn mercato auth add-user` - Add User
Adds a new user to an organization:
```bash
yarn mercato auth add-user --email user@example.com --password secret --organizationId <orgId> --roles customer,employee
```

#### `yarn mercato auth set-password` - Set User Password
Changes the password for an existing user:
```bash
yarn mercato auth set-password --email user@example.com --password newPassword
```

**Required parameters:**
- `--email <email>` - user email address
- `--password <password>` - new password

#### `yarn mercato auth seed-roles` - Seed Default Roles
Creates default roles (customer, employee, admin, owner):
```bash
yarn mercato auth seed-roles
```

### Example Module Commands

#### `yarn mercato example seed-todos` - Seed Example Data
Creates sample todos with custom fields:
```bash
yarn mercato example seed-todos --org <organizationId> --tenant <tenantId>
```

**Required parameters:**
- `--org <organizationId>` - organization ID
- `--tenant <tenantId>` - tenant ID

### Other Commands

#### `yarn modules:prepare` - Prepare Modules
Generates module registry, entities, and DI configuration:
```bash
yarn modules:prepare
```

Notes:
- The Todos page uses `queryEngine` to select and sort `cf:*` fields. Custom field definitions must exist for the current organization; the seeding command ensures they do.

## Documentation

- Introduction – https://docs.openmercato.com/
- Installation – https://docs.openmercato.com/installation/setup
- User Guide – https://docs.openmercato.com/user-guide/overview
- Architecture – https://docs.openmercato.com/architecture/system-overview
- CLI – https://docs.openmercato.com/cli/overview
- Customization Tutorials – https://docs.openmercato.com/customization/build-first-app
- Hands-on Tutorials – https://docs.openmercato.com/tutorials/first-app
- Framework Reference – https://docs.openmercato.com/framework/ioc/container
- Appendix – https://docs.openmercato.com/appendix/troubleshooting

## Architecture Overview

- 🧩 Modules: Each feature lives under `src/modules/<module>` with auto‑discovered frontend/backend pages, APIs, CLI, i18n, and DB entities.
- 🗃️ Database: MikroORM with per‑module entities and migrations; no global schema. Migrations are generated and applied per module.
- 🧰 Dependency Injection: Awilix container constructed per request. Modules can register and override services/components via `di.ts`.
- 🏢 Multi‑tenant: Core `directory` module defines `tenants` and `organizations`. Most entities carry `tenant_id` + `organization_id`.
- 🔐 Security: zod validation, bcryptjs hashing, JWT sessions, role‑based access in routes and APIs.

## License

- MIT — see `LICENSE` for details.
