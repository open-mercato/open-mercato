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

## Requirements

- Node.js 24 or later
- PostgreSQL database
- Yarn (recommended) or npm

## Test Locally From The Monorepo

If you are developing `create-mercato-app` inside the Open Mercato monorepo, use the root-level test commands to validate the standalone scaffold without publishing packages first.

### Scaffold-only smoke test

From the monorepo root:

```bash
yarn test:create-app
```

What it does:
- builds the current branch packages
- scaffolds a fresh standalone app in a temporary directory
- rewrites `@open-mercato/*` dependencies to local tarballs built from your current branch
- opens a shell in that generated app directory so you can continue manually as if you were a standalone user

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
- builds local package artifacts
- scaffolds a temporary standalone app
- installs local packed `@open-mercato/*` tarballs into that app
- runs the standalone app integration suite via the local CLI

This command requires Docker because the ephemeral integration environment boots the standalone app and its services.

## Learn More

For more information about Open Mercato, visit:
- [GitHub Repository](https://github.com/open-mercato/open-mercato)
- [Documentation](https://docs.openmercato.com)
