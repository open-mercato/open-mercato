# Contributing to Open Mercato

We’re excited to collaborate with folks building on top of Open Mercato. This guide explains how we organize releases, structure branches, and prepare pull requests so changes land smoothly.

## Branch Model

- `main` – the trunk and always the next minor release. Every PR targets `main`; each push publishes a nightly snapshot.
- `release/vX.Y.x` – one branch per released minor, taking fixes only through backports. See [Releasing](#releasing).
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
cd open-mercato
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

- Branch from `main`, keeping it up to date via `git pull --rebase origin main`.
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

- Open PRs against `main`. If users of a released line need the fix, add the `backport release/vX.Y.x` label (see [Releasing](#releasing)).
- Give every PR a category label (`feature`, `bug`, `security`, …) — it decides the PR's section in generated release notes.
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

PRs do not publish npm canary packages automatically. Maintainers can publish pkg.pr.new package previews for a PR by dispatching the `Package Previews` workflow manually with the PR number — run it from the Actions tab, with `gh workflow run package-previews.yml --ref main -f pr_number=<PR>`, or via the `om-auto-publish-pr` skill. To publish a fresh preview after more commits, re-run the dispatch with the same PR number.

The legacy npm canary snapshot path is still available for comparison by dispatching the `NPM Snapshot Preview` workflow manually with the PR number on a trusted same-repository PR branch. That workflow publishes real npm canary packages and runs standalone app integration against the exact snapshot, so use it only when pkg.pr.new previews are not enough evidence. Both preview workflows are restricted to same-repository PR branches.

## Developing on Windows

The fastest way to a working dev environment on Windows is the starter: double-click `packages\starter\platform\start.cmd` (no admin needed — it installs a portable, checksum-verified Node 24 and hands off to the cross-platform CLI), or run `npx @open-mercato/starter` if you already have Node. The starter audits the machine, handles corporate proxies and TLS interception (CA capture + provisioning into host tooling, image builds, and the container engine), and starts the stack; WSL2 and Docker Desktop / Rancher Desktop are detected and *proposed* with exact instructions — including a "hand this to IT" sheet from `yarn om doctor` — never installed behind your back. Hardware floor: 16 GB RAM recommended (12 GB minimum), ~20 GB free disk. On machines where host Node workloads are not allowed, use `npx @open-mercato/starter up --mode docker` for the fully containerized stack. Printable EN/PL manuals with troubleshooting live in [`docs/manuals/windows/`](docs/manuals/windows/); the docs site covers the [Windows monorepo path](https://docs.openmercato.com/installation/monorepo#windows) and the [WSL2-native guide](https://docs.openmercato.com/installation/wsl2).

## Releasing

Open Mercato ships from **release lines**:

```
main             0.9.0 ──cut──▶ 0.10.0 (features) ──cut──▶ 0.11.0 …
                         │                          │
release/v0.9.x           └─ 0.9.0 ─ 0.9.1 ─ 0.9.2 (fixes only)
release/v0.10.x                                     └─ 0.10.0 ─ 0.10.1 …
```

- **`main` is always the next minor.** Features and fixes land there.
- **Each released minor lives on `release/vX.Y.x`** and takes fixes only, so a fix ships as a patch without whatever features `main` has gathered since.
- **Versions are never chosen by hand.** A cut moves `main` to the next minor; a release from a line ships its `x.y.0` once, then patches. Never edit a manifest version, or a released `CHANGELOG.md` entry, by hand.
- **Fixes flow `main` → line** through the `backport release/vX.Y.x` label. The rare hotfix made on a line first flows back through `backport main`.

Two channels ship packages to npm:

- **Snapshots** — every push to `main` runs `Develop Snapshot Release`, publishing under the `develop` dist-tag (the name survives from the retired `develop` branch). Install them with `yarn add @open-mercato/core@develop` or `npx create-mercato-app@develop my-app`; all `@open-mercato/*` packages must use the same tag. Exact snapshot versions stay installable for debugging or rollback.
- **Stable releases** — three maintainer-run workflows, below. Only maintainers dispatch them; agents never do.

| Workflow | Run from | What it does |
|---|---|---|
| **Release cut** (`release-cut.yml`) | `main` | With `main` at `X.Y.Z`: creates `release/vX.Y.x` at `main`'s tip, ensures the `backport release/vX.Y.x` and `backport main` labels, hands `main`'s leading `# Unreleased` changelog section to the line, and opens `chore(release): open X.(Y+1).0 on main`. Publishes nothing. |
| **Release** (`release.yml`) | a `release/vX.Y.x` branch | Bumps first, then builds that exact commit: picks the version, stamps every public package, `apps/*` and the root manifest plus `CHANGELOG.md`, commits that to the line, builds, publishes to npm, tags `vX.Y.Z`, creates the GitHub Release and opens `docs(changelog): add the X.Y.Z entry` on `main`. Requires the `production` environment approval. |
| **Backport** (`backport.yml`) | — (on PR merge/label) | Cherry-picks a merged PR labelled `backport <branch>` into a PR on that branch. A conflict opens a draft with the conflict committed and instructions on the original PR. |

Running a workflow: Actions → pick it → *Run workflow* → *Use workflow from* = the branch → tick `dry_run` to rehearse → *Run workflow*. Or `gh workflow run release.yml --ref release/v0.9.x -f dry_run=true`.

### How Release picks the version and dist-tag

| State of the line | Result |
|---|---|
| Manifest `0.10.0`, no tag `v0.10.0` (fresh line) | ships `0.10.0` as committed |
| Manifest `0.9.0`, tag `v0.9.0` with its GitHub Release | bumps to `0.9.1` first, then ships |
| A run failed after its bump commit but before tagging (manifest `0.9.2`, no tag) | ships `0.9.2` from the line tip |
| A run failed after tagging (tag `v0.9.2`, no GitHub Release yet) | **resumes** `0.9.2` from the tagged commit, even if backports landed since — they ship in `0.9.3` |

Release commits the bump, tags it, and only then builds and publishes that tagged commit. The **GitHub Release is created last** and is what marks a version done; the changelog PR to `main` is opened just before it. To abandon a tagged-but-unreleased version instead of resuming it, delete its tag.

Between releases a line's manifests show the **last released** version. Only the newest line moves npm `latest` — judged by the highest `latest` across every published package, so a half-finished publish of a newer line still counts; a patch to an older line publishes under `latest-X.Y` (`yarn add @open-mercato/core@latest-0.9`) and its GitHub Release is not marked latest. If npm cannot be read the release stops rather than guess. Only one Release runs at a time, across all lines.

Every step is re-runnable: `publish-packages.sh` skips versions already on npm, and an existing tag, branch, PR or GitHub Release is reused. A release that dies half-way is finished by running it again. Release cut refuses a re-run once `main` has moved past the commit its line was cut from — merge the existing `chore/open-vX.Y.0` PR, or delete the line to cut again.

### Changelog

Release resolves the entry in this order:

1. an existing `# X.Y.Z` heading on the line — kept as written;
2. a leading `# Unreleased` on the line — renamed to `# X.Y.Z (date)` (Release cut moved it there from `main`, so curated notes for a minor survive and never ship twice);
3. otherwise **GitHub's generated release notes** since the previous tag on that line, grouped by category label via [`.github/release.yml`](.github/release.yml).

Curate a minor's notes as a leading `# Unreleased` section on `main` before the cut (`om-auto-update-changelog` drafts it). Patches usually ship with the generated notes, so **every PR needs a category label** (`feature`, `bug`, `security`, `enterprise`, `refactor`, `dependencies`, `documentation`) — it decides the PR's section. Bookkeeping PRs carry `skip-changelog`.

### Runbooks

**Patch (a fix for the current line)**
1. PR the fix against `main`, labelled `backport release/v0.9.x`. Merge it.
2. Backport opens the PR into `release/v0.9.x`. Wait for CI, review that the fix fits the line's code, merge. Repeat for every fix that should ship.
3. Run **Release** from `release/v0.9.x`. `0.9.1` is on npm.
4. Merge the `docs(changelog): add the 0.9.1 entry` PR on `main`.

**Next minor**
1. Run **Release cut** from `main` with `dry_run`, check the summary, then run it for real.
2. Merge `chore(release): open 0.11.0 on main`.
3. Stabilize the new line with backports.
4. Run **Release** from `release/v0.10.x` — `0.10.0` ships and moves `latest`.
5. Merge the changelog PR on `main`.

**Hotfix that cannot wait for `main`**: PR directly against `release/vX.Y.x`, label it `backport main`, merge, release. Backport forward-ports it so later minors keep it.

**Backport conflicts, or the fix belongs elsewhere on the line**: the backport PR is an ordinary branch. Reset it to the line and write the fix where the code lives there (force-push, same PR), or close the draft and open a hand-written PR against the line. If the bug does not exist on the line, do not label the PR at all.

### Rules for contributors and agents

- **Every PR targets `main`.** Never push to `release/v*`; open a PR against one only for the can't-wait hotfix.
- **A fix users of a released line need** gets `backport release/vX.Y.x` (newest line: `git branch -r --list 'origin/release/v*'`). Default for high-priority bugs, security fixes and regressions that exist on that line; never for features or refactors.
- **Label the issue at triage and the PR when opening it** — only the PR's label triggers Backport. Agents copy it from issue to PR; label normalization never strips `backport …`.
- **Review backport PRs as real PRs**: CI green *and* the change still makes sense in the line's code — a clean cherry-pick into a different context is the dangerous case. `qa-approved` is not copied to a backport.

### One-time setup (maintainers)

1. **Release GitHub App** (required) — **Open Mercato Assistant**, owned by the `open-mercato` org and installed on this repository only, with repository permissions **Contents, Pull requests, Issues and Workflows: read & write** (webhook off). The release workflows mint a one-hour token from it on every run (`actions/create-github-app-token`), so nothing expires and no personal account is involved. Store its **Client ID** as the repository variable `RELEASE_APP_CLIENT_ID` and a generated **private key** as the secret `RELEASE_APP_PRIVATE_KEY`. `GITHUB_TOKEN` is not enough — PRs it opens trigger no CI, and it cannot bypass the ruleset below. PRs the app opens are authored by the app, so any maintainer can approve them.
2. **Ruleset `release lines`** (Settings → Rules → New branch ruleset), target `release/v*`: bypass list = the **Open Mercato Assistant** app (and admins), mode *Always*; Restrict creations ✅, Restrict deletions ✅, Block force pushes ✅, Restrict updates ❌; Require a pull request ✅ (1 approval); Require status checks ✅ with the CI jobs, "Do not require status checks on creation" ✅; Require signed commits ❌.
3. **`production` environment** with required reviewers (already gates Release).

## Helpful Resources

- 📚 Documentation: [docs.openmercato.com](https://docs.openmercato.com/)
- 🧠 Agents & architecture guide: [`AGENTS.md`](AGENTS.md)
- 💬 Community discussions and issues: [GitHub issues](https://github.com/open-mercato/open-mercato/issues)

Thanks for helping us build a more extensible, AI-ready operations platform!
