# 🚀 Open Mercato

Open Mercato is a new‑era, AI‑supportive ERP foundation framework for service‑ and product‑based companies — built to power bookings, operations, and growth. It’s modular, extensible, and designed for teams that want strong defaults with room to customize everything.

## Highlights

- 🧩 Modular architecture with auto‑discovery (pages, APIs, CLI)
- 🧠 AI‑supportive foundation ready for assistive workflows
- 🗃️ Per‑module entities and migrations via MikroORM
- 🧬 Entity extensions + custom fields (EAV) without forking core schemas
- 🧱 Strong multi‑tenant model (tenants + organizations)
- 🧰 Dependency Injection (Awilix) for service/component overrides
- 🔔 Event Bus with subscribers (local/redis) + offline processing
- 🔐 Authentication, roles, sessions included
- ⚙️ Next.js app router, TypeScript, zod, bcryptjs

<img src="./docs//open-mercato-homepage.jpg" alt="Open Mercato homepage"/>

## Getting Started

1) Prerequisites
- Node.js 20+
- PostgreSQL database
- Environment variables in `.env` (copy from `.env.example`):
  - `DATABASE_URL=postgres://user:password@localhost:5432/mercato`
  - `JWT_SECRET=some-strong-secret`

2) Quick setup (recommended)

- `yarn init` - Automatically installs dependencies, prepares modules, runs migrations, and creates admin user
- Customize admin user: `yarn init --org="My Company" --email="admin@mycompany.com" --password="mypassword" --roles="owner,admin"`

**OR** Manual setup:

2) Install dependencies

- `yarn install`

3) Prepare modules (registry, entities, DI)

- `yarn modules:prepare`

4) Database migrations (per‑module)

- Generate: `yarn db:generate`
- Apply: `yarn db:migrate` (also seeds global custom fields)

5) Seed roles and bootstrap an organization + admin user

- Seed default roles: `yarn mercato auth seed-roles`
- Setup tenant/org/admin:
  - `yarn mercato auth setup --orgName "Acme" --email admin@acme.com --password secret --roles owner,admin`

6) Run the app

- `yarn dev`
- Open http://localhost:3000

## Example: Todos with Custom Fields

The example module ships a simple Todos demo that showcases custom fields and the unified query layer.

Steps:

1) Ensure migrations are applied and global custom fields are seeded
- `yarn db:migrate` (runs migrations and seeds global custom fields)

2) Create an organization and admin user
- `yarn mercato auth setup --orgName "Acme" --email admin@acme.com --password secret --roles owner,admin`
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
yarn init --org="My Company" --email="admin@mycompany.com" --password="mypassword" --roles="owner,admin"
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

#### `yarn greenfield` - Clean Slate Setup
Removes all migrations, snapshots, and checksum files for a fresh start:
```bash
yarn greenfield
```

**What it cleans:**
- Migration files (`Migration*.ts`)
- Snapshot files (`*.json` containing "snapshot")
- Checksum files (`*.checksum`)
- All modules (auth, custom_fields, directory, example)

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
yarn mercato auth setup --orgName "Acme" --email admin@acme.com --password secret --roles owner,admin
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

### Getting Started
- <a href="./docs/tutorials/first-app.md">Quickstart tutorial</a>
- <a href="./docs/tutorials/testing.md">Writing unit tests</a>
- <a href="./docs/tutorials/api-data-fetching.md">API Data Fetching Tutorial</a>

### Core Concepts
- <a href="./docs/modules.md">Modules authoring and usage</a>
- <a href="./docs/routes-and-pages.md">Creating Routes and Pages</a>
- <a href="./docs/data-extensibility.md">Entity extensions and custom fields</a>
- <a href="./docs/query-layer.md">Unified query layer (filters, paging, fields)</a>
- <a href="./docs/events-and-subscribers.md">Events & subscribers</a>
- <a href="./docs/api/crud-factory.md">CRUD API factory (reusable handlers, hooks, events)</a>

### CLI

- auth: add-user, seed-roles, add-org, setup
- events: process, emit, clear, clear-processed
- example: hello
- custom_fields: install (upsert module-declared field definitions; use --global or --org ,<id>), add-field

## Architecture Overview

- 🧩 Modules: Each feature lives under `src/modules/<module>` with auto‑discovered frontend/backend pages, APIs, CLI, i18n, and DB entities.
- 🗃️ Database: MikroORM with per‑module entities and migrations; no global schema. Migrations are generated and applied per module.
- 🧰 Dependency Injection: Awilix container constructed per request. Modules can register and override services/components via `di.ts`.
- 🏢 Multi‑tenant: Core `directory` module defines `tenants` and `organizations`. Most entities carry `tenant_id` + `organization_id`.
- 🔐 Security: zod validation, bcryptjs hashing, JWT sessions, role‑based access in routes and APIs.

## License

- MIT — see `LICENSE` for details.
