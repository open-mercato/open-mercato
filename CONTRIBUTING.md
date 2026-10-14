# Contributing to Open Mercato

We’re excited to collaborate with folks building on top of Open Mercato. This guide explains how we organize releases, structure branches, and prepare pull requests so changes land smoothly.

## Branch Model

- `main` – release-ready code. Every commit is tagged and deployable. Keep PRs targeting `main` limited to hotfixes or release prep approved by maintainers.
- `develop` – nightly builds and upcoming release work. Base regular feature work off `develop` so it can soak in automation and shared testing.
- Topic branches – create a dedicated branch per change using the format `feat/<concise-feature-name>` (for example `feat/customer-export`). Use other prefixes when appropriate (`fix/`, `chore/`, `docs/`).

## Development Setup

These steps set up this monorepo, which is what you need to change Open Mercato itself. To build your own app on Open Mercato, use `npx create-mercato-app` instead (see the [README](README.md#get-started)).

### Quick start

With [Node.js](https://nodejs.org/en/download) installed, one command does everything:

```bash
npx @open-mercato/starter
```

It clones the repo if needed, audits your machine (`doctor`, which expects Node 24), handles corporate proxies and TLS interception, generates `.env` and secrets, starts the infra containers, initializes the database and boots the supervised dev runtime. Re-running it resumes where it stopped. Inside a clone use `yarn om`. No Node at all? Use the no-admin bootstraps in [`packages/starter/platform/`](packages/starter/platform/) (`start.cmd` on Windows, `start.sh` on macOS and Linux). A container runtime ([Docker Desktop](https://www.docker.com/products/docker-desktop/) or [Rancher Desktop](https://rancherdesktop.io)) is detected and guided, never installed for you. See [`packages/starter/README.md`](packages/starter/README.md); the first run needs about 20 GB of free disk.

### Manual steps (macOS and Linux)

```bash
brew install node@24   # or: nvm install 24 && nvm use 24
corepack enable        # uses the Yarn version pinned in package.json

git clone https://github.com/open-mercato/open-mercato.git
cd open-mercato && git checkout develop
yarn install
yarn infra:up                                 # PostgreSQL, Redis, Meilisearch (see starters/README.md)
cp apps/mercato/.env.example apps/mercato/.env # the defaults work with yarn infra:up
yarn dev:greenfield                           # builds, generates, initializes and starts the app
```

`yarn dev:greenfield` reinstalls the database: it drops all tables in the configured database before seeding it again. Open `http://localhost:3000/backend`; the credentials are printed in the terminal. Windows users: see [Developing on Windows](#developing-on-windows).

### Seed data

`yarn initialize` runs `mercato init`. Add `--no-examples` to skip the demo CRM content, `--stresstest` for thousands of synthetic contacts, companies, deals and timeline interactions, or `--stresstest --lite` for high-volume contacts without the heavier extras (pass flags after `--`, for example `yarn initialize -- --no-examples`). See the [init reference](https://docs.openmercato.com/cli/init).

### Agent skills

Working with an AI coding agent in this repository? Run `yarn install-skills` after cloning. It installs this repo's committed local-tier skills together with the shared collection from [open-mercato/skills](https://github.com/open-mercato/skills) into the gitignored `.agents/skills/` directory. See [`.ai/skills/README.md`](.ai/skills/README.md) for the tier system.

### Running multiple persistent local instances

To keep two long-lived local instances on the same PostgreSQL server, pass an optional database-name override to `yarn dev`, `yarn dev:greenfield` or `yarn setup`:

```bash
yarn dev:greenfield --database-name=my_db     # explicit name; a .env update is offered (default yes)
yarn dev --database-name                      # derive the name from the current directory
yarn dev --database-name=review_1720 --no-update-env   # one-off run that does not touch .env
```

Without the flag nothing changes. See the [monorepo installation guide](https://docs.openmercato.com/installation/monorepo).

### Reducing dev-mode memory usage

`yarn dev` watches every workspace package by default. On smaller machines, narrow the watch scope:

```bash
yarn dev --watch=auto-optimized                          # packages touched in git
OM_WATCH_SCOPE=env OM_WATCH_PACKAGES=core,ui yarn dev    # an explicit set
yarn dev --watch=popular                                 # the most frequently changed (default cap 6)
```

`OM_WATCH_SCOPE=all` restores the default. See [Choosing which packages the watcher tracks](https://docs.openmercato.com/appendix/troubleshooting).

## Working on Features

- Branch from `develop`, keeping it up to date via `git pull --rebase origin develop`.
- Keep commits scoped and descriptive. Squash locally if it clarifies the story.
- Follow module conventions from [`AGENTS.md`](AGENTS.md) and prefer the `packages/` workspace for new code.
- Document user-facing copy in the locale dictionaries and keep translations in sync.

### Spec Driven Development

Before implementing new features or making significant changes, check for an existing spec in `.ai/specs/`:

1. **Check for a spec**: Look for specs named `{YYYY-MM-DD}-{title}.md` related to your feature
2. **Create or update**: If no spec exists, create one following the naming convention `{YYYY-MM-DD}-{title}.md`; if it does, update it with your changes
3. **Maintain the changelog**: Add a dated entry summarizing your changes
4. **Update the directory**: Add new specs to the table in [`.ai/specs/README.md`](.ai/specs/README.md)

This ensures design decisions are documented and the codebase remains well-understood by both humans and AI agents. See [`.ai/specs/README.md`](.ai/specs/README.md) for the full specification directory and [`.ai/specs/AGENTS.md`](.ai/specs/AGENTS.md) for detailed guidelines.

## Pull Requests

- Open PRs against `develop` unless you are coordinating a release hotfix.
- Describe the user impact, architectural notes, and testing performed (lint, unit, integration, CLI).
- Ensure the branch merges cleanly and CI is green before requesting review.
- Reference related issues or discussions; add screenshots or recordings for UI tweaks.
- Tag maintainers early if you need design or architectural guidance.

### Enterprise Module Contributions

> [!IMPORTANT]
> **We cannot accept external contributions to the enterprise module.**

The `@open-mercato/enterprise` package (`packages/enterprise/`) is commercial,
proprietary software governed by its own [license](packages/enterprise/LICENSE.md) — not
the open-source terms that cover the rest of this repository. Because of the licensing and
intellectual-property / IP-transfer constraints around that package, **we are unable to
review, accept, or merge pull requests that modify anything under `packages/enterprise/`**,
even when they are otherwise high quality.

What this means in practice:

- Do not open PRs that add to, modify, refactor, or reverse-engineer files under
  `packages/enterprise/`. They will be closed without merge.
- The Contributor License Agreement (see [`apps/docs/cla.md`](apps/docs/cla.md)) governs
  contributions to the open-source projects only; it does not grant rights to the
  commercial enterprise codebase, so it cannot be used to upstream enterprise changes.
- If you have found a bug in an enterprise module, please report it through your
  commercial support channel or open an issue describing the problem (without proposing a
  code change to the package).
- If you want to build or extend enterprise functionality, reach out about the
  [Open Mercato Partnership Program](packages/enterprise/README.md) and commercial
  licensing instead.

Contributions to every other package and app in this repository are welcome — only the
`packages/enterprise/` tree is off-limits.

### Package Previews

PRs do not publish npm canary packages automatically. Maintainers can publish pkg.pr.new package previews for a PR by dispatching the `Package Previews` workflow manually with the PR number — run it from the Actions tab, with `gh workflow run package-previews.yml --ref develop -f pr_number=<PR>`, or via the `om-auto-publish-pr` skill. To publish a fresh preview after more commits, re-run the dispatch with the same PR number.

The legacy npm canary snapshot path is still available for comparison by dispatching the `NPM Snapshot Preview` workflow manually with the PR number on a trusted same-repository PR branch. That workflow publishes real npm canary packages and runs standalone app integration against the exact snapshot, so use it only when pkg.pr.new previews are not enough evidence. Both preview workflows are restricted to same-repository PR branches.

## Developing on Windows

The fastest way to a working dev environment on Windows is the starter: double-click `packages\starter\platform\start.cmd` (no admin needed — it installs a portable, checksum-verified Node 24 and hands off to the cross-platform CLI), or run `npx @open-mercato/starter` if you already have Node. The starter audits the machine, handles corporate proxies and TLS interception (CA capture + provisioning into host tooling, image builds, and the container engine), and starts the stack; WSL2 and Docker Desktop / Rancher Desktop are detected and *proposed* with exact instructions — including a "hand this to IT" sheet from `yarn om doctor` — never installed behind your back. Hardware floor: 16 GB RAM recommended (12 GB minimum), ~20 GB free disk. On machines where host Node workloads are not allowed, use `npx @open-mercato/starter up --mode docker` for the fully containerized stack. Printable EN/PL manuals with troubleshooting live in [`docs/manuals/windows/`](docs/manuals/windows/); the docs site covers the [Windows monorepo path](https://docs.openmercato.com/installation/monorepo#windows) and the [WSL2-native guide](https://docs.openmercato.com/installation/wsl2).

## Releasing

Two channels ship packages to npm:

- **Snapshots** — every push to `develop` runs `Develop Snapshot Release`, publishing under the `develop` dist-tag. Fully automatic; nothing to do. Install them with `yarn add @open-mercato/core@develop` or `npx create-mercato-app@develop my-app`; all `@open-mercato/*` packages must use the same tag. Exact snapshot versions stay installable for debugging or rollback.
- **Stable releases** — a maintainer-driven two-stage flow off `main`, described below.

Stable releases are split across two workflows on purpose. `main` is protected, so a workflow cannot push a version bump to it directly; the bump lands through a normal PR, and the publishing workflow only ever pushes a tag.

### Stage 0 — land the changelog

Add the `# <version> (YYYY-MM-DD)` section to [`CHANGELOG.md`](CHANGELOG.md) and merge it to `main`. The release workflow reads its GitHub Release notes from this section and **fails without it**, so this comes first. The `om-auto-update-changelog` skill drafts the entry.

### Stage 1 — `Release Prepare`

Dispatch **Release Prepare** from the Actions tab with a `patch`, `minor` or `major` bump:

```bash
gh workflow run release-prepare.yml --ref main -f bump=patch
```

It bumps every public package, the app workspaces (`apps/*`) and the root manifest, pushes `release/v<version>`, and opens a PR against `main`. It publishes nothing. The PR body confirms whether the changelog entry exists. Review and merge it as usual.

> Opening the PR automatically requires _Settings → Actions → General → Workflow permissions → "Allow GitHub Actions to create and approve pull requests"_. Without it the branch is still pushed and the job summary links straight to the compare page — one click instead of zero.

### Stage 2 — `Release`

With the bump on `main`, dispatch **Release**:

```bash
gh workflow run release.yml --ref main
```

The job requires approval from the `production` environment, then runs in a deliberate order — every reversible step before the irreversible one:

1. **Preflight** — version alignment across packages and app workspaces, the version is not already on npm, and the changelog section exists. Nothing has happened yet if any of these fail.
2. **Build** — `build:packages`, `generate`, `build:packages`.
3. **Tag** — pushes `v<version>`. A tag is cheap to delete; an npm version is not.
4. **Publish** — `publish-packages.sh` with npm provenance, skipping anything already published.
5. **GitHub Release** — notes built from the changelog section plus the published-package table.

### Resuming a failed release

If publishing fails partway, packages are already on npm and cannot be republished — npm is ahead of git, and the repository has to catch up. Both stages take the same `resume` flag for this, which relaxes the guards that would otherwise refuse an already-published version.

If the version bump never landed on `main`, run the whole flow again with `resume: true`:

```bash
gh workflow run release-prepare.yml --ref main -f bump=patch -f resume=true
# merge the recovery PR, then
gh workflow run release.yml --ref main -f resume=true
```

If the bump is already on `main` and only publishing failed, just the second command is needed.

In resume mode, `Release Prepare` skips the "not on npm yet" and "tag does not exist" checks and marks the PR as a recovery; `Release` skips the same npm preflight, skips packages that already published, reuses the existing tag, and refreshes the release notes instead of failing.

> `resume` disables the guard that prevents double-publishing. Use it only when a run died *after* npm publish — on a normal release it removes a check you want.

### Local equivalents

`yarn release:{patch,minor,major}` bump, build and publish from a working copy; `yarn release:existing` publishes the version already in the root `package.json`. None of them tag or push — prefer the workflows. Useful for inspection:

```bash
yarn release:bump patch                 # bump manifests only, no build or publish
yarn release:check-unpublished 0.6.8    # is this version already on npm?
./scripts/changelog-section.sh 0.6.8    # preview the release notes body
```

## Helpful Resources

- 📚 Documentation: [docs.openmercato.com](https://docs.openmercato.com/)
- 🧠 Agents & architecture guide: [`AGENTS.md`](AGENTS.md)
- 💬 Community discussions and issues: [GitHub issues](https://github.com/open-mercato/open-mercato/issues)

Thanks for helping us build a more extensible, AI-ready operations platform!
