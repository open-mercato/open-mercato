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

### Npm snapshot preview security setup

Before enabling npm snapshot previews, a repository administrator and npm package owner must configure and verify these controls together:

1. Create the **`npm-preview`** GitHub Environment in Settings → Environments. Require a maintainer reviewer, enable **Prevent self-review**, and disable **Allow administrators to bypass configured protection rules**. Under deployment branches and tags, select only the trusted `main` branch and allow no tags. Dispatch the workflow from `main`; the workflow checks out the separately resolved, pinned PR SHA after approval. Keep the `production` environment and its stable release approvals separate.
2. Create a distinct, short-lived npm **granular access token** with read/write publishing access to the explicit public package names under `packages/*/package.json` (`private != true`), including the unscoped `create-mercato-app`. Exclude unrelated packages, whole-organization administration, and blanket access to all packages or scopes. Use only the noninteractive publishing/2FA permission required by the registry's current policy. Review the allowlist when a public package is added and rotate the token before expiration. See [npm's granular token permissions](https://docs.npmjs.com/about-access-tokens/).
3. Store that distinct value as **`NPM_PREVIEW_TOKEN` only in `npm-preview` environment secrets**. Do not define it as a repository or organization secret, copy the stable `NPM_TOKEN`, or add a fallback to it. The workflow stops on a missing preview token before dependency installation. The stable release and trusted branch snapshot workflows retain their existing credentials.
4. Record non-secret verification evidence on the security issue or fix PR: environment reviewers, self-review/bypass settings, allowed dispatch ref, environment-only secret placement, and the token's actual package allowlist, permission flags, owner, expiration, and rotation owner. Inspect grants in npm's token settings; a secret name or workflow reference does not prove registry scope. Never include the token value. Repository tests cannot establish these external settings.

Before any PR code is checked out, the workflow checks the run's deployment approval history and requires an approver other than the PR author, dispatcher, or rerun initiator. An absent approval, an approval for another environment, or an unavailable review API stops the job. Use a **new workflow dispatch** for retries or a newer commit; **Re-run jobs** is refused so an approval from an earlier attempt cannot authorize a different snapshot. The reviewer must inspect the pinned SHA from `Resolve PR`, including install hooks and release scripts, before approving. GitHub's [environment configuration guide](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments) explains the required protection settings.

Npm package write grants do **not** isolate versions or dist-tags: even a separate preview token for these package names can affect their stable versions and tags. Independent approval remains necessary. Before first use, maintainers must verify that unapproved and self-approved runs stop before checkout, then approve an intended same-repository SHA and confirm canary publication, provenance, and standalone integration. Only maintainers perform this live publishing acceptance check; local validation never publishes packages.

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
- **Stable releases** — the maintainer-run workflows below. Only maintainers run them; agents never do.

### The workflows

| Workflow | Started by | What it does |
|---|---|---|
| **Release cut** (`release-cut.yml`) | a maintainer, from `main` | With `main` at `X.Y.Z`: creates `release/vX.Y.x` at `main`'s tip, ensures the `backport release/vX.Y.x` and `backport main` labels, hands `main`'s leading `# Unreleased` changelog section to the line, and opens `chore(release): open X.(Y+1).0 on main`. Publishes nothing. |
| **Release** (`release.yml`) | a maintainer, from a `release/vX.Y.x` branch | Picks the next version, stamps every public package, `apps/*`, the root manifest and `CHANGELOG.md`, commits that bump to the line and tags it `vX.Y.Z`. Publishes nothing — the tag starts Release publish. With `dry_run` it only rehearses the build and previews the release notes. |
| **Release publish** (`release-publish.yml`) | the `vX.Y.Z` tag (automatically) | Runs **at the tagged commit**, so npm provenance attests exactly the code it ships. Waits for the `production` approval, checks the tag, resolves the dist-tag, builds, publishes to npm, opens `docs(changelog): add the X.Y.Z entry` on `main`, then creates the GitHub Release. |
| **Backport** (`backport.yml`) | merging or labelling a PR | Cherry-picks a merged PR labelled `backport <branch>` into a PR on that branch. A conflict opens a draft with the conflict committed and instructions on the original PR. |

All four act as the **Open Mercato Assistant** GitHub App, so the PRs, commits and tags they create trigger CI and each other. Running a workflow by hand: Actions → pick it → *Run workflow* → *Use workflow from* = the branch → tick `dry_run` to rehearse → *Run workflow* (or `gh workflow run release.yml --ref release/v0.9.x -f dry_run=true`).

### Step by step: ship a patch

1. **Fix on `main`.** Open the fix PR against `main` with a category label (`bug`, `security`, …) and `backport release/v0.9.x`. Merge it.
2. **Merge the backport.** Backport opens the same change as a PR into `release/v0.9.x`, authored by Open Mercato Assistant. Wait for CI, check the fix still makes sense in the line's code, approve and merge. Repeat steps 1–2 for every fix that should ship.
3. **Rehearse.** Actions → **Release** → *Use workflow from* `release/v0.9.x` → tick `dry_run` → *Run workflow*. The summary shows the version (`0.9.1`), the dist-tag, and the changelog source; the log previews the GitHub Release text.
4. **Release.** Run **Release** again without `dry_run`. It commits `chore(release): 0.9.1` to the line and tags `v0.9.1`.
5. **Approve the publish.** The tag starts **Release publish** (Actions → Release publish → the `v0.9.1` run). Approve the `production` deployment; it builds, publishes `0.9.1` to npm, opens the changelog PR and creates the GitHub Release.
6. **Merge the changelog PR** `docs(changelog): add the 0.9.1 entry` on `main`.
7. **Check.** `npm view @open-mercato/core dist-tags` shows the new version under `latest` (or `latest-0.9` if a newer line exists), and the GitHub Release `v0.9.1` lists the published packages.

### Step by step: ship the next minor

1. **Prepare the upgrade companions (required) and the notes.** On `main`, before the cut (`om-auto-update-changelog` drafts all of it):
   - an `UPGRADE_NOTES.md` window `## 0.9.0 → 0.10.0 (Unreleased)` — it starts at the previous minor, never a patch; Release replaces the marker with the release date;
   - the companion skill `om-auto-upgrade-0.9.0-to-0.10.0` in `.ai/skills/` and, byte-identical, in `packages/create-app/agentic/shared/ai/skills/`, registered under `migration` in both `tiers.json` files;
   - optionally a leading `# Unreleased` section in `CHANGELOG.md`; the cut hands it to the new line. Without it, the minor ships with generated notes.

   Release refuses to tag a minor without the window and both skill files. Anything added after the cut reaches the line through a backport.
2. **Rehearse the cut.** Actions → **Release cut** → from `main` → tick `dry_run`. The summary names the new line (`release/v0.10.x`) and the version `main` moves to (`0.11.0`).
3. **Cut.** Run **Release cut** without `dry_run`. It creates `release/v0.10.x` and opens `chore(release): open 0.11.0 on main`.
4. **Merge the bump PR** `chore(release): open 0.11.0 on main`. Features keep landing on `main`; the line takes only backports from here.
5. **Stabilise** the line with backports, as in the patch steps 1–2.
6. **Release** from `release/v0.10.x` (dry run first), approve **Release publish**, merge the changelog PR — patch steps 3–7. `0.10.0` ships and moves `latest`.

### When something goes wrong

- **Release publish failed** (build, npm, the changelog PR or the GitHub Release): open that run and **Re-run jobs**. It rebuilds the same tagged commit, skips packages already on npm, points the dist-tag at them, and reuses existing PRs. Nothing is done twice.
- **Release reports "already tagged but has no GitHub Release"**: an earlier publish never finished. Re-run that Release publish run, or Actions → Release publish → *Use workflow from* the tag `vX.Y.Z` → *Run workflow*. Backports merged since ship in the next patch.
- **Never delete a release tag to start over.** A tagged version may already be partly on npm, and npm versions are immutable. Release refuses to re-ship an untagged version that already has packages on npm; restore the tag at its original commit and resume.
- **Release cut refuses to re-run** because `main` moved after the line was cut: merge the existing `chore/open-vX.Y.0` PR, or delete the new line to cut again from the current `main`.
- **A backport conflicts, or the fix belongs elsewhere on the line**: the backport PR is an ordinary branch. Reset it to the line and write the fix where the code lives there (force-push, same PR), or close the draft and open a hand-written PR against the line. If the bug does not exist on the line, do not label the PR at all.
- **A hotfix cannot wait for `main`**: PR it directly against `release/vX.Y.x`, label it `backport main`, merge and release. Backport forward-ports it so later minors keep it.

### How Release picks the version and dist-tag

| State of the line | Result |
|---|---|
| Manifest `0.10.0`, no tag `v0.10.0` (fresh line) | ships `0.10.0` as committed |
| Manifest `0.9.0`, tag `v0.9.0` with its GitHub Release | bumps to `0.9.1` first, then ships |
| A run failed after its bump commit but before tagging (manifest `0.9.2`, no tag) | ships `0.9.2` from the line tip |
| Tag `v0.9.2` exists but has no GitHub Release | nothing new — finish `v0.9.2` by re-running its Release publish run |

A version is **done once its GitHub Release exists**; that Release is created last, after every package is published and the changelog PR is open. Between releases a line's manifests show the **last released** version.

Only the newest line moves npm `latest`, judged by the highest `latest` across every published package (so a half-finished publish of a newer line still counts). A patch to an older line publishes under `latest-X.Y` (`yarn add @open-mercato/core@latest-0.9`) and its GitHub Release is not marked latest. Release publish resolves this right before publishing, one publish at a time across all lines, and stops if npm cannot be read.

### Changelog

Release resolves the entry in this order:

1. an existing `# X.Y.Z` heading on the line — kept as written;
2. a leading `# Unreleased` on the line — renamed to `# X.Y.Z (date)` (Release cut moved it there from `main`, so curated notes for a minor survive and never ship twice);
3. otherwise **GitHub's generated release notes** since the previous tag on that line, grouped by category label via [`.github/release.yml`](.github/release.yml).

Patches usually ship with the generated notes, so **every PR needs a category label** (`feature`, `bug`, `security`, `enterprise`, `refactor`, `dependencies`, `documentation`) — it decides the PR's section. Bookkeeping PRs carry `skip-changelog`. Patch releases carry no `UPGRADE_NOTES.md` window or upgrade companion skill. A minor must have both (see *ship the next minor*, step 1); Release dates the window with the release date and carries that date back to `main` with the changelog entry.

### Rules for contributors and agents

- **Every PR targets `main`.** Never push to `release/v*`; open a PR against one only for the can't-wait hotfix.
- **A fix users of a released line need** gets `backport release/vX.Y.x` (newest line: `git branch -r --list 'origin/release/v*'`). Default for high-priority bugs, security fixes and regressions that exist on that line; never for features or refactors.
- **Label the issue at triage and the PR when opening it** — only the PR's label triggers Backport. Agents copy it from issue to PR; label normalization never strips `backport …`.
- **Review backport PRs as real PRs**: CI green *and* the change still makes sense in the line's code — a clean cherry-pick into a different context is the dangerous case. `qa-approved` is not copied to a backport.
- **Never create or delete `v*` tags by hand** — Release creates them, and a tag starts a publish.

### One-time setup (maintainers)

1. **Release GitHub App** (required) — **Open Mercato Assistant**, owned by the `open-mercato` org and installed on this repository only, with repository permissions **Contents, Pull requests, Issues and Workflows: read & write** (webhook off). The release workflows mint a one-hour token from it on every run (`actions/create-github-app-token`), so nothing expires and no personal account is involved. Store its **Client ID** as the repository variable `RELEASE_APP_CLIENT_ID` and a generated **private key** as the secret `RELEASE_APP_PRIVATE_KEY`. `GITHUB_TOKEN` is not enough — PRs and tags it creates trigger no workflows, and it cannot bypass the ruleset below. PRs the app opens are authored by the app, so any maintainer can approve them.
2. **Ruleset `release lines`** (Settings → Rules → New branch ruleset), target `release/v*`: bypass list = the **Open Mercato Assistant** app (and admins), mode *Always*; Restrict creations ✅, Restrict deletions ✅, Block force pushes ✅, Restrict updates ❌; Require a pull request ✅ (1 approval); Require status checks ✅ with the CI jobs, "Do not require status checks on creation" ✅; Require signed commits ❌.
3. **`production` environment** (Settings → Environments → production): required reviewers (the approval click before every publish), and *Deployment branches and tags* → **Selected branches and tags** with the tag rule `v*` — Release publish runs on tags. The `release/v*` branch rule is no longer needed.
4. **Tag ruleset** (recommended; Settings → Rules → New tag ruleset), target `v*`: Restrict creations, updates and deletions ✅, bypass list = the **Open Mercato Assistant** app, mode *Always*. Only Release can then create the tags that start a publish.

## Helpful Resources

- 📚 Documentation: [docs.openmercato.com](https://docs.openmercato.com/)
- 🧠 Agents & architecture guide: [`AGENTS.md`](AGENTS.md)
- 💬 Community discussions and issues: [GitHub issues](https://github.com/open-mercato/open-mercato/issues)

Thanks for helping us build a more extensible, AI-ready operations platform!
