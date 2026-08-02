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
| `--preset <id>` | Select the `classic`, `empty`, or `crm` starter without prompting |
| `--agents <list>` | Set up `claude-code`, `codex`, `cursor`, a comma-separated subset, `all`, or `none` without prompting |
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

# Create a classic app with every supported AI coding-tool configuration
npx create-mercato-app my-store --preset classic --agents all

# Set up only Claude Code and Codex
npx create-mercato-app my-store --agents claude-code,codex

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
- `--agents` is only supported for bare scaffolds; use `yarn mercato agentic:init` after importing a ready app
- Imported ready apps must not contain `.template` files; the scaffold fails closed if template files are found

## Standalone AI Harness

A bare scaffold can install a standalone-specific AI development harness for Claude Code, Codex, Cursor, or any selected subset. It combines a compact task router, module/task guides, local skills, an integrity-pinned subset of `open-mercato/skills`, exact installed-framework context, and a reproducible evaluation catalog.

### Install or refresh skills

Agentic setup attempts installation automatically. Re-run it after cloning, after an offline setup, or when selecting another tier:

```bash
yarn install-skills --list
yarn install-skills
yarn install-skills --with automation # opt in to loop/issue/release-maintenance workflows
```

The default is the 13 local core skills plus the 15-skill dependency-closed daily external tier. Advanced loop engines, issue authoring, and upgrade-note maintenance stay opt-in through `--with automation` (or `--all`). `.agents/skills/` is canonical; Claude Code receives compatibility links. The installer downloads the exact pinned `open-mercato/skills` archive, copies only individually hash-attested skill directories, and never executes archive or package-runner code. It activates the selected external set as one transaction: any failure restores the complete previous set before local installation continues. It preserves unknown user-owned skills and quarantines stale or modified installer-owned content.

### Upgrade an existing generated harness

After upgrading Open Mercato, refresh generated harness assets without overwriting local context:

```bash
yarn mercato agentic:init --update-harness
```

The ownership-aware update replaces unchanged generated files, recreates missing owned files, and refreshes the manifest atomically. Modified or unknown files remain in place; exact generated-path conflicts get an adjacent `.incoming` candidate. Managed paths are resolved below the canonical app root and a symlinked ancestor is rejected before publication. Use `--force` only when intentionally replacing known generated targets. External skill installation is a separate retryable phase, so offline installation does not roll back the harness update.

### Resolve installed framework context

Use the escape hatch when the routed guides do not contain an exact contract. It resolves the package versions selected by the app and their source/`AGENTS.md` chain without bulk-loading dependencies:

```bash
yarn framework:context --module customers --query makeCrudRoute
yarn framework:context --package @open-mercato/ui --query CrudForm
yarn framework:context --root
```

Bounded snapshots are written under ignored `.ai/framework-context/`; warnings make degraded dist/type-only context explicit.

### Evaluate and maintain the harness

Use deterministic checks during development:

```bash
yarn harness:validate --case OMH-009
yarn harness:validate --family testing
yarn harness:validate --all
```

`harness:validate --all` is the deterministic catalog gate, not the full release suite. Authenticated `--runner codex` / `--runner claude` live routing uses host filesystem containment on macOS (`sandbox-exec`) and Linux (Bubblewrap). The model gets no shell, process, environment, discovery, browser, or network tool: both CLIs receive only an evaluator-owned, `env -i` MCP server for exact-path reads and case-allowlisted writes. The selected app is intentionally readable through that narrow tool, so use a fresh or otherwise non-sensitive generated app. macOS `sandbox-exec` can enforce network-free lanes but cannot isolate loopback from the host; native macOS and Windows must use a contained Linux VM/container with Bubblewrap for the complete release gate.

Run the full matrix once per Open Mercato release from a fresh scaffold:

```bash
yarn install-skills
yarn harness:release --runner codex --prepare-targets /absolute/empty-release-targets --acknowledge-writes
```

The target directory must be absolute, new or empty, and outside the controller app. Select one blocking primary runner with `--runner codex` or `--runner claude`; it owns all 210 routing cases and every writable/review lane, with no per-case fallback. Optionally add the different authenticated runner through `--portability-runner` for the exact 48-case representative read-only lane. Omitting it is valid and recorded as not requested; once requested, its failures are blocking. Use a fresh, sanitized controller: automatic preparation fails before copying `.env`/`.env.*` local configuration (safe example/sample/template files remain allowed), credential files, or private-key files. The complete gate requires Linux with trusted system Bubblewrap (`bwrap`) and user namespaces because its Playwright API/browser lanes need a loopback namespace isolated from the host. Preflight rejects untrusted/no-op/pass-through executables and proves isolated loopback plus a capability-free payload before target preparation, provider invocation, or writes; native macOS and Windows therefore fail closed. The command also fails closed when a required runner, browser, or test runtime is unavailable. The 210-case catalog includes 93 framework-neutral business prompts and 48 writable implementation/regression cases (22.9%). The release command runs live routing, writable trusted oracles, per-target `generate`/`typecheck`/`lint`/`build`, any declared generated test, and isolated generated-code review for every writable result. Foundation and target validation—including `yarn build`—receive a minimal environment with network access denied, and persisted diagnostics redact sensitive environment values and URL userinfo. Test-authoring coverage executes a Jest unit test plus Linux/Bubblewrap loopback-only Playwright API and browser tests through fixed controller-owned commands against a read-only target; runtime reports must attest at least one passed test and zero skipped, todo, focused, flaky, or expected-failure tests. The suite then writes a schema-valid sanitized mode-`0600` report under `.ai/harness/results/` with the selected primary and optional portability runner policy.

Use the bundled `om-evolve-harness` skill to add a real case: reproduce failure first, select one smallest knowledge owner, run any generated unit/integration tests plus target checks, require code review, and finish with the full release suite. Open Mercato framework maintainers use the monorepo-only `$om-refresh-standalone-harness --from <ref> --to <ref>` workflow for every release range and retain its sanitized maintenance report.

For normal app changes, describe the business outcome directly or use the installed spec workflow for multi-phase work. Before handoff, run `yarn generate`, the smallest affected unit/integration tests, `yarn typecheck`, `yarn lint`, and `yarn build` as appropriate; applying migrations still requires explicit approval.

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
