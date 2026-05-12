# create-mercato-app

Create a new Open Mercato application with a single command.

## Quick Start

```bash
npx create-mercato-app my-app
cd my-app
yarn setup
```

Official and external ready apps can also be bootstrapped directly:

```bash
npx create-mercato-app my-prm --app prm
npx create-mercato-app my-marketplace --app-url https://github.com/some-agency/ready-app-marketplace
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
| `--app <name>` | Bootstrap an official Open Mercato ready app from `open-mercato/ready-app-<name>` |
| `--app-url <url>` | Bootstrap a ready app from a GitHub repository URL |
| `--skip-agentic-setup` | Skip the interactive agentic setup wizard |
| `--init-git` | Initialize a local Git repository after scaffolding |
| `--no-init-git` | Do not prompt for or initialize a local Git repository |
| `--registry <url>` | Custom npm registry URL |
| `--verdaccio` | Use local Verdaccio registry (http://localhost:4873) |
| `--help`, `-h` | Show help |
| `--version`, `-v` | Show version |

### Examples

```bash
# Create a new app using the public npm registry
npx create-mercato-app my-store

# Create an official Open Mercato ready app
npx create-mercato-app my-prm --app prm

# Create an app from an external GitHub-hosted ready app
npx create-mercato-app my-marketplace --app-url https://github.com/some-agency/ready-app-marketplace

# Create a new app using a local Verdaccio registry
npx create-mercato-app my-store --verdaccio

# Create a new app using a custom registry
npx create-mercato-app my-store --registry http://localhost:4873

# Create a new app without the agentic setup wizard
npx create-mercato-app my-store --skip-agentic-setup

# Create a new app and initialize a local Git repository
npx create-mercato-app my-store --init-git
```

## Ready App Behavior

- `--app <name>` resolves to `open-mercato/ready-app-<name>` and fetches the exact tag `v<create-mercato-app version>`
- `--app-url <url>` only supports GitHub repository URLs in v1 and honors `/tree/<ref>` when present
- `--app` and `--app-url` are mutually exclusive
- `--skip-agentic-setup` skips only the interactive agentic setup wizard
- Imported ready apps are copied as raw source snapshots: the CLI does not rewrite dependency versions, package names, or application source files
- Imported ready apps skip the interactive agentic setup wizard; if you want agentic tooling later, run `yarn mercato agentic:init` inside the generated app
- Imported ready apps must not contain `.template` files; the scaffold fails closed if template files are found

## Git And GitHub

Interactive scaffolds ask whether to initialize a local Git repository after the app is created. Non-interactive scaffolds skip Git initialization unless `--init-git` is passed.

To publish the generated app to GitHub after creation:

```bash
cd my-app
git add -A
git commit -m "Initial commit"
gh repo create --source=. --remote=origin --push
```

If you did not initialize Git during scaffolding, run this first:

```bash
git init -b main
```

Without GitHub CLI, create an empty repository on GitHub and connect it manually:

```bash
git remote add origin https://github.com/<owner>/<repo>.git
git push -u origin main
```

The standalone dev splash also exposes a GitHub publishing panel after `yarn dev` when `gh` is installed.

## After Creating A Bare Scaffold

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

   To run several persistent local apps against the same PostgreSQL server, pass an optional database-name override. The flag is purely additive — omitting it preserves existing behavior.

   ```bash
   # explicit name; .env is updated by default after a confirmation prompt
   yarn setup --database-name=client_a

   # bare flag derives the database name from the current directory name
   yarn setup --database-name

   # one-off run that only injects DATABASE_URL into the current child env
   yarn dev --database-name=review_1720 --no-update-env
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
   On native local runs, `yarn dev` opens the standalone splash screen on `http://localhost:4000` by default, shows live startup progress, and keeps routine logs folded. Once the app is ready, the splash can also:
   - launch supported coding tools from the `Start coding with AI` menu
   - create or publish a GitHub repository through `gh` when `OM_DEV_CREATE_GIT_REPO_FLOW` is enabled and GitHub CLI is installed

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

## After Importing A Ready App

1. Navigate to your app directory:
   ```bash
   cd my-prm
   ```

2. Install dependencies:
   ```bash
   yarn install
   ```

3. Initialize the application:
   ```bash
   yarn initialize
   ```

4. Start the development server:
   ```bash
   yarn dev
   ```

5. If you want standalone agentic tooling later:
   ```bash
   yarn mercato agentic:init
   ```

## Requirements

- Node.js 24 or later
- PostgreSQL database
- Yarn (recommended) or npm
- GitHub CLI (`gh`) is strongly recommended if you want to use the splash-based GitHub repository publish flow

## Recommended Local Tooling

The standalone dev splash works best when you install the recommended Git and AI tooling up front.

### Required for GitHub publish from the splash

- GitHub CLI (`gh`) lets the standalone splash create or publish a GitHub repository once the app is ready.
- Install docs: <https://cli.github.com/>
- After installation, authenticate once with:

```bash
gh auth login
```

### Recommended AI coding tools

- Codex CLI is the recommended OpenAI terminal workflow for the splash `Start coding with AI` menu.
  - Install guide: <https://developers.openai.com/codex/cli>
  - Install command:

```bash
npm i -g @openai/codex
```

- Claude Code is the recommended Anthropic terminal workflow for the splash `Start coding with AI` menu.
  - Install guide: <https://code.claude.com/docs/en/setup>
  - Native installer:

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

- Visual Studio Code is the recommended general-purpose editor for standalone Open Mercato apps.
  - Download and install: <https://code.visualstudio.com/Download>

- Cursor is a recommended AI-first editor if you prefer an IDE workflow over a terminal-only CLI workflow.
  - Download and install: <https://cursor.com/download>

## Dev Splash Environment Variables

The standalone compact dev runtime supports these splash-related environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `OM_DEV_SPLASH_PORT` | `4000` | Port used by the splash page. Use `random` or `0` for an ephemeral free port. |
| `OM_DEV_AUTO_OPEN` | `1` | Set to `0` to keep the splash from opening automatically in a browser. |
| `OM_DEV_CREATE_GIT_REPO_FLOW` | `true` | Enables the standalone splash GitHub publish panel. Set to `false` to hide it. |
| `OM_ENABLE_CODING_FLOW_FROM_SPLASH` | `true` | Enables the `Start coding with AI` splash menu. Set to `false` to hide it. |
| `OM_DEV_SPLASH_VSCODE_PATH` | auto-detect | Optional path override for the VS Code CLI used by the splash coding menu. |
| `OM_DEV_SPLASH_CURSOR_PATH` | auto-detect | Optional path override for the Cursor CLI used by the splash coding menu. |
| `OM_DEV_SPLASH_CLAUDE_CODE_PATH` | auto-detect | Optional path override for the Claude Code CLI used by the splash coding menu. |
| `OM_DEV_SPLASH_CODEX_PATH` | auto-detect | Optional path override for the Codex CLI used by the splash coding menu. |

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
- opens a shell in the generated app directory when run interactively
- prints the generated app path so you can continue there manually or rerun non-interactively

If you want to keep the smoke test non-interactive:

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
