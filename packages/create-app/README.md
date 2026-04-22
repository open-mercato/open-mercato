# create-mercato-app

Create a new Open Mercato application with a single command.

## Quick Start

```bash
npx create-mercato-app my-app
cd my-app
yarn setup
```

## Usage

```bash
npx create-mercato-app <app-name> [options]
```

### Arguments

| Argument | Description |
|----------|-------------|
| `app-name` | Name of the application (creates folder with this name) |

### Options

| Option | Description |
|--------|-------------|
| `--registry <url>` | Custom npm registry URL |
| `--verdaccio` | Use local Verdaccio registry (http://localhost:4873) |
| `--help`, `-h` | Show help |
| `--version`, `-v` | Show version |

### Examples

```bash
# Create a new app using the public npm registry
npx create-mercato-app my-store

# Create a new app using a local Verdaccio registry
npx create-mercato-app my-store --verdaccio

# Create a new app using a custom registry
npx create-mercato-app my-store --registry http://localhost:4873
```

## After Creating Your App

1. Navigate to your app directory:
   ```bash
   cd my-app
   ```

2. Fast path:
   ```bash
   yarn setup
   ```
   If you need to reset and initialize from scratch instead:
   ```bash
   yarn setup --reinstall
   ```
   Alias:
   ```bash
   yarn setup:reinstall
   ```

3. Manual alternative if you want to edit the environment first:
   ```bash
   cp .env.example .env
   # Edit .env with your database credentials
   ```

4. Install dependencies:
   ```bash
   yarn install
   ```

5. Generate required files:
   ```bash
   yarn generate
   ```

6. Run database migrations:
   ```bash
   yarn db:migrate
   ```

7. Initialize the application:
   ```bash
   yarn initialize
   ```

8. Start the development server:
   ```bash
   yarn dev
   ```

9. Docker alternatives:
   ```bash
   cp .env.example .env
   yarn install
   docker compose -f docker-compose.fullapp.dev.yml up --build
   ```
   Or for the production-style stack:
   ```bash
   cp .env.example .env
   yarn install
   docker compose -f docker-compose.fullapp.yml up --build
   ```
   Run `cp .env.example .env` and `yarn install` before either Docker command. Skipping those preparation steps can cause the stack to fail during startup.

## Requirements

- Node.js 24 or later
- PostgreSQL database
- Yarn (recommended) or npm

## Test Locally From The Monorepo

If you are developing `create-mercato-app` inside the Open Mercato monorepo, use a local Verdaccio registry to validate the standalone scaffold. Both paths below use Verdaccio.

Optional one-time setup if you want npm auth stored for Verdaccio:

```bash
yarn registry:setup-user
```

### Fast path via root scripts

Use the root scripts when you want the quickest repeatable flow.

### Scaffold-only smoke test

From the monorepo root:

```bash
yarn test:create-app
```

What it does:
- starts Verdaccio if needed
- republishes the current branch packages to Verdaccio
- scaffolds a fresh standalone app configured for that local registry
- installs dependencies in the generated app
- opens a shell in that generated app directory so you can continue with `yarn setup`

If you only want the path without opening a shell:

```bash
yarn test:create-app --no-shell
```

### Full standalone integration parity

To run the same ephemeral standalone integration flow used for CI-style parity checks:

```bash
yarn test:create-app:integration
```

What it does:
- starts Verdaccio if needed
- republishes the current branch packages to Verdaccio
- scaffolds a temporary standalone app configured for that registry
- installs the standalone app from Verdaccio, including enterprise for the parity run
- runs the standalone app's ephemeral integration suite via `yarn test:integration:ephemeral`

This command requires Docker because the ephemeral integration environment boots the standalone app and its services.

### Manual Verdaccio workflow

Use this path when you want to keep a standalone app around and iterate on it directly.

```bash
docker compose up -d verdaccio
yarn registry:publish
node packages/create-app/dist/index.js /tmp/my-test-app --verdaccio
cd /tmp/my-test-app
yarn install
yarn setup
```

To rerun against newly published packages in an existing standalone app:

```bash
cd /tmp/my-test-app
rm -rf node_modules .mercato/next
yarn install
yarn dev
```

## Learn More

For more information about Open Mercato, visit:
- [GitHub Repository](https://github.com/open-mercato/open-mercato)
- [Documentation](https://docs.openmercato.com)
