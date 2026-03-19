# SPEC-ENT-006: QA Deployment on Dokploy via GitHub Actions

## TLDR

**Key Points:**
- Two GitHub Actions workflows manage the full QA slot lifecycle: `qa-deploy.yml` (manual deploy) and `qa-stop-on-merge.yml` (automatic stop on PR close).
- `qa-deploy.yml` builds the preview Docker image, pushes it to GHCR, updates the Dokploy slot via REST API, and optionally labels the PR (`qa:qa1` / `qa:qa2`) and posts a machine-readable marker comment used later for safe slot cleanup.
- `qa-stop-on-merge.yml` triggers automatically when a labelled PR is closed (merged or abandoned), reads the marker comment to identify the expected image, verifies the slot still runs that image (safety check against concurrent redeployment), and stops the Dokploy application.
- Each QA slot (`qa1`, `qa2`) maps to a pre-configured long-lived Dokploy application running as a Docker-provider app.

**Scope:**
- `.github/workflows/qa-deploy.yml` — manual build-and-deploy workflow
- `.github/workflows/qa-stop-on-merge.yml` — automatic slot cleanup on PR merge
- `docker/preview/Dockerfile` — dedicated preview image used for QA builds
- `docker/preview/preview-entrypoint.sh` — baked into the image; invokes `yarn test:integration:ephemeral:start`
- Fix `NODE_ENV` passthrough in `packages/cli/src/lib/testing/integration.ts`
- `docker-compose.preview.yaml` — local single-service compose for running the preview image on a developer machine (port 5000→5001)
- `.github/QA-DEPLOYMENT.md` — QA engineer runbook covering remote slot deploys and local preview usage
- Dokploy application configuration (Docker provider, not GitHub source)
- GitHub repository secrets and variables for GHCR + Dokploy API

**Concerns:**
- docker.sock mount gives the Dokploy container access to the host Docker daemon — acceptable for internal QA; must not be used in production.
- First-ready latency is ~5–10 minutes per deployment (full install → generate → build → DB init → Next.js start).
- Concurrent slot deployments are serialised per slot via GitHub Actions `concurrency` group (`cancel-in-progress: false`). A second run for the same slot queues behind the first.
- The auto-stop workflow fires on any PR **close** (merged or abandoned). Slots deployed without a PR number association (no `qa:*` label) must be stopped manually via the Dokploy UI.

---

## Overview

Open Mercato has no automated QA preview environment. Developers must run the full stack locally or share a single staging server. This spec introduces named QA slot deployments spanning two workflows:

1. **Deploy** (`qa-deploy.yml`): A developer manually triggers the workflow, selects a slot (`qa1`/`qa2`), specifies the branch to build, and optionally associates a PR number. The workflow builds the preview image, pushes it to GHCR, updates the Dokploy application's Docker image via REST API, triggers a redeploy, and — if a PR number was supplied — labels the PR and posts a marker comment encoding the deployed slot and image tag.

2. **Stop on close** (`qa-stop-on-merge.yml`): When a PR that carries a `qa:qa1` or `qa:qa2` label is closed (merged or abandoned), this workflow automatically detects the slot, reads the most recent marker comment to identify the expected image, fetches the current Dokploy application config to verify the image has not since been replaced by another deployment, and stops the slot only if the image matches.

The environment uses an ephemeral PostgreSQL container (docker.sock) and resets on every deployment.

---

## Problem Statement

- No automated QA environment exists. Testing a PR requires local setup or a shared staging server that gets overwritten.
- Reviewers cannot verify a feature without checking out the branch locally.
- Setting up the full stack locally takes 20–30 minutes for new contributors.
- Shared staging environments cause race conditions and unclear ownership.

---

## Proposed Solution

### Deploy workflow (`qa-deploy.yml`)

Triggered manually via `workflow_dispatch` with inputs:

| Input | Required | Description |
|-------|----------|-------------|
| `slot` | Yes | QA slot to deploy to (`qa1` or `qa2`) |
| `branch` | Yes | Branch to checkout and build |
| `pr_number` | No | PR number to label and comment on; omit for slot-only deploys |

Steps:
1. Checkout the specified branch.
2. Build `docker/preview/Dockerfile` via `docker/build-push-action` with GHA cache (`type=gha`).
3. Push image to GHCR as `ghcr.io/<org>/<repo>:<slot>-<sha7>`.
4. Resolve Dokploy `applicationId` from repository variables (`DOKPLOY_APP_ID_QA1` / `DOKPLOY_APP_ID_QA2`).
5. Call `POST /api/application.saveDockerProvider` to update the slot's Docker image reference.
6. Call `POST /api/application.deploy` to trigger a redeploy.
7. *(If `pr_number` provided)* Add label `qa:<slot>` to the PR.
8. *(If `pr_number` provided)* Post a PR comment containing a machine-readable HTML marker: `<!-- dokploy-qa slot=<slot> image=<image_full> -->`, followed by a human-readable deployment summary.

### Stop-on-close workflow (`qa-stop-on-merge.yml`)

Triggered automatically on `pull_request` closed events (both merged and abandoned; gate: `action == 'closed'`).

Steps:
1. List labels on the merged PR; detect `qa:qa1` or `qa:qa2`.
2. Skip silently if no QA label is present.
3. Resolve Dokploy `applicationId` from repository variables.
4. Paginate PR comments in reverse order; find the most recent comment containing `<!-- dokploy-qa slot=<slot> image=<image> -->` and extract the expected image tag.
5. Fail (do not stop) if no marker comment is found — prevents accidental stops for slots that were not deployed via the workflow.
6. Call `GET /api/application.one?applicationId=<id>` and extract `dockerImage` from the response.
7. Compare current image with expected: if they differ (another PR redeployed the slot after this PR was last deployed), skip the stop and log a message.
8. If images match, call `POST /api/application.stop` to stop the slot.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Manual `workflow_dispatch` for deploy (not automatic webhook/label trigger) | Full developer control over when and what gets deployed to QA. Avoids race conditions from concurrent label events on multiple PRs. |
| PR number as optional input, not inferred from branch | The workflow can be used for slot-only deploys (no associated PR). Explicit input avoids ambiguity. |
| Machine-readable marker comment (`<!-- dokploy-qa ... -->`) | Embeds the expected image in the PR itself without external state storage. The stop workflow can reconstruct what was deployed without querying GHCR or a database. |
| Image comparison safety check in stop workflow | A slot may have been redeployed for a different PR since this one last deployed. Comparing the live Dokploy image prevents stopping a slot that another team member is actively using. |
| `action == 'closed'` gate in stop workflow | Fires on any PR close — merged or abandoned. Ensures slots are reclaimed regardless of how the PR was resolved. |
| Pre-build image in CI, push to GHCR, then tell Dokploy | Decouples build from deployment. CI has build cache (`type=gha`); Dokploy does not need GitHub App access. Cleaner separation of concerns. |
| Named slots (`qa1`, `qa2`) instead of per-PR ephemeral URLs | Predictable URLs, predictable resource usage, easier to share with stakeholders. |
| `cancel-in-progress: false` concurrency per slot | Queues concurrent deploys to the same slot rather than cancelling in-flight builds; prevents partial deployments. |
| Standalone `docker/preview/Dockerfile` | Keeps preview tooling (docker-cli, jest config) isolated from the main production `Dockerfile`. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Dokploy native GitHub webhook (per-PR label trigger) | More complex to configure, requires Dokploy GitHub App installation, harder to control. Manual trigger is sufficient for QA. |
| External state store for slot→image mapping | Adds infrastructure dependency. PR comment marker is self-contained and visible to developers directly in GitHub. |
| Stop only on merge (not close) | Abandoned/closed PRs would leave slots running indefinitely, wasting server resources. |
| Persistent PostgreSQL between deploys | State drift makes tests non-deterministic. Ephemeral DB is consistent with existing `test:integration:ephemeral:start` design. |

---

## User Stories / Use Cases

- **Developer** wants to deploy a specific branch to QA manually so that a reviewer can test the feature at a stable URL without checking out the branch locally.
- **Developer** wants the workflow to label and comment on the PR automatically so that the slot URL and image tag are discoverable from the PR page.
- **Reviewer** wants to know which slot a PR was deployed to so that they can open the QA URL directly from GitHub.
- **DevOps** wants the QA slot to stop automatically when the PR is closed (merged or abandoned) so that idle containers do not consume server resources.
- **DevOps** wants the stop workflow to refuse to stop if the slot has been redeployed for another PR, preventing accidental interruption of a live QA session.
- **DevOps** wants deployments to a slot to be serialised so that a second trigger does not corrupt a running deployment.

---

## Architecture

### Deploy flow

```
Developer triggers workflow_dispatch
    │  inputs: slot=qa1, branch=feat/foo, pr_number=123 (optional)
    ▼
[GitHub Actions: .github/workflows/qa-deploy.yml]
    │
    ├── Checkout branch
    │
    ├── docker/build-push-action
    │       file: docker/preview/Dockerfile
    │       context: .
    │       push: true
    │       platforms: linux/amd64
    │       tag: ghcr.io/<org>/<repo>:qa1-<sha7>
    │       cache-from/to: type=gha
    │
    ├── Resolve DOKPLOY_APP_ID_QA1 → applicationId
    │
    ├── POST /api/application.saveDockerProvider
    │       { applicationId, dockerImage: "ghcr.io/...:<tag>" }
    │
    ├── POST /api/application.deploy
    │       { applicationId }
    │           │
    │           ▼
    │   [Dokploy Server]
    │       └── docker pull ghcr.io/...:<tag>
    │       └── docker run
    │               ├── /var/run/docker.sock:/var/run/docker.sock (bind)
    │               ├── ENV from Dokploy UI
    │               └── docker/preview/preview-entrypoint.sh
    │                       └── yarn test:integration:ephemeral:start
    │                               ├── yarn install
    │                               ├── yarn build:packages
    │                               ├── yarn generate
    │                               ├── yarn build:packages (2nd pass)
    │                               ├── docker run postgres:16 (via docker.sock)
    │                               ├── yarn initialize --reinstall
    │                               ├── yarn build:app
    │                               └── yarn start  (PORT=3000)
    │
    ├── (if pr_number) Add label "qa:qa1" to PR #123
    │
    └── (if pr_number) Post PR comment:
            <!-- dokploy-qa slot=qa1 image=ghcr.io/...:<tag> -->
            🚀 Deployed to **qa1**
            - Image: `ghcr.io/...:<tag>`
            - Branch: `feat/foo`
```

### Stop-on-close flow

```
PR #123 closed (carries label "qa:qa1") — merged or abandoned
    │
    ▼
[GitHub Actions: .github/workflows/qa-stop-on-merge.yml]
    │
    ├── List PR labels → detect "qa:qa1" → slot=qa1
    │
    ├── Resolve DOKPLOY_APP_ID_QA1 → applicationId
    │
    ├── Paginate PR comments (reverse) →
    │       find last "<!-- dokploy-qa slot=qa1 image=<img> -->"
    │       → expected_image = "ghcr.io/...:<tag>"
    │       (fail if not found)
    │
    ├── GET /api/application.one?applicationId=<id>
    │       → current_image = response.dockerImage
    │
    ├── Compare current_image == expected_image?
    │       NO  → log "Slot redeployed, skipping stop" → exit 0
    │       YES ↓
    │
    └── POST /api/application.stop
            { applicationId }
```

### Slot → Application ID Mapping

| Slot | GitHub Variable | Label |
|------|----------------|-------|
| `qa1` | `vars.DOKPLOY_APP_ID_QA1` | `qa:qa1` |
| `qa2` | `vars.DOKPLOY_APP_ID_QA2` | `qa:qa2` |

---

## Data Models

No new database entities. Deployment state is encoded in PR comments (marker format) and managed by Dokploy.

---

## API Contracts

### Dokploy REST API calls (outbound from GitHub Actions)

**`POST /api/application.saveDockerProvider`** — update slot image
```json
{ "applicationId": "<string>", "dockerImage": "ghcr.io/<org>/<repo>:<tag>" }
```

**`POST /api/application.deploy`** — trigger redeploy
```json
{ "applicationId": "<string>" }
```

**`GET /api/application.one?applicationId=<string>`** — read current config (stop workflow)
```json
{ "dockerImage": "ghcr.io/<org>/<repo>:<tag>", ... }
```

**`POST /api/application.stop`** — stop the running container
```json
{ "applicationId": "<string>" }
```

All calls require `x-api-key: <DOKPLOY_API_KEY>` and (for POST) `Content-Type: application/json`.

### PR comment marker format

Written by `qa-deploy.yml`; parsed by `qa-stop-on-merge.yml`. **Do not change the format lightly.**

```
<!-- dokploy-qa slot=<slot> image=<image_full> -->
```

The stop workflow scans comments in reverse chronological order and uses the **most recent** matching marker, so multiple deployments to the same slot on the same PR are handled correctly.

---

## Configuration

### GitHub Repository Secrets

| Secret | Description |
|--------|-------------|
| `DOKPLOY_URL` | Base URL of the Dokploy server (e.g. `https://dokploy.example.com`) |
| `DOKPLOY_API_KEY` | Dokploy API key with deploy + stop permissions |

### GitHub Repository Variables

| Variable | Description |
|----------|-------------|
| `DOKPLOY_APP_ID_QA1` | Dokploy `applicationId` for the `qa1` slot |
| `DOKPLOY_APP_ID_QA2` | Dokploy `applicationId` for the `qa2` slot |

### GitHub Actions Permissions

**`qa-deploy.yml`**
```yaml
permissions:
  contents: read
  packages: write        # push image to GHCR
  pull-requests: write   # post PR comment
  issues: write          # add PR label
  actions: read
```

**`qa-stop-on-merge.yml`**
```yaml
permissions:
  contents: read
  pull-requests: read
  issues: read
```

### Required Dokploy Application Settings (per slot)

| Setting | Value |
|---------|-------|
| Source type | Docker (not GitHub) |
| Docker image | `ghcr.io/<org>/<repo>:<placeholder>` (overwritten by workflow on first deploy) |
| Exposed port | `3000` |
| Volume — Source | `/var/run/docker.sock` |
| Volume — Destination | `/var/run/docker.sock` |
| Volume — Type | Bind |
| Restart policy | `no` |

### Required Dokploy Environment Variables (set in Dokploy UI per slot)

| Variable | Value | Description |
|----------|-------|-------------|
| `NODE_ENV` | `production` | Runtime mode |
| `DEV_EPHEMERAL_PREFERRED_PORT` | `3000` | Port the app listens on |
| `DEV_EPHEMERAL_POSTGRES_PUBLISHED_HOST` | `0.0.0.0` | Postgres bind address inside container |
| `DEV_EPHEMERAL_POSTGRES_CONNECT_HOST` | `host.docker.internal` | Postgres host for app connection |
| `NEXTAUTH_SECRET` | `<secret>` | Required by NextAuth |
| Additional app secrets | — | As required by `apps/mercato/.env.example` |

---

## Implementation Plan

### Phase 1: Standalone Preview Dockerfile ✅

**Goal**: Create a dedicated `docker/preview/Dockerfile` for QA builds, fully isolated from the main `Dockerfile`.

#### Steps

1. **Create `docker/preview/Dockerfile`** — two-stage build (`builder` + `runner`):
   - `builder` stage: installs deps and runs `yarn build:packages`
   - `runner` stage: installs `docker-cli` (needed to spawn the ephemeral PostgreSQL container via docker.sock), copies the entrypoint script, runs `yarn install` + `yarn build:packages`

2. **Create `docker/preview/preview-entrypoint.sh`** — baked into the `runner` stage; calls `yarn test:integration:ephemeral:start`.

3. **Verify local build** — `docker build -f docker/preview/Dockerfile -t open-mercato:preview .` — must complete without errors.

#### File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `docker/preview/Dockerfile` | Create | Standalone preview image (builder + runner stages) |
| `docker/preview/preview-entrypoint.sh` | Create | Entrypoint that invokes `yarn test:integration:ephemeral:start` |

---

### Phase 2: Fix NODE_ENV Passthrough ✅

**Goal**: Confirm that `yarn test:integration:ephemeral:start` inherits `NODE_ENV=production` from the container environment.

#### Steps

1. **Fix `NODE_ENV` passthrough in `packages/cli/src/lib/testing/integration.ts`** — change the two hardcoded `NODE_ENV: 'test'` assignments to `NODE_ENV: process.env.NODE_ENV ?? 'test'`. This allows the ephemeral environment to inherit `NODE_ENV=production` set in the Dokploy container, while still defaulting to `'test'` in CI/local runs.

#### File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `packages/cli/src/lib/testing/integration.ts` | Modify | `NODE_ENV: process.env.NODE_ENV ?? 'test'` (two occurrences) |

---

### Phase 3: GitHub Actions Workflows ✅

**Goal**: Create both GitHub Actions workflows for the full deploy + cleanup lifecycle.

#### Steps

1. **Create `.github/workflows/qa-deploy.yml`** with:
   - Trigger: `workflow_dispatch` with inputs `slot`, `branch`, `pr_number` (optional)
   - Concurrency: `dokploy-<slot>`, `cancel-in-progress: false`
   - Steps: checkout → QEMU → Buildx → GHCR login → compute `slot-sha7` tag → build+push → resolve app ID → `saveDockerProvider` → `deploy` → (if pr_number) add label → (if pr_number) post marker comment

2. **Create `.github/workflows/qa-stop-on-merge.yml`** with:
   - Trigger: `pull_request` `closed`, gate: `action == 'closed'` (fires on merge and abandon)
   - Steps: detect `qa:qa1`/`qa:qa2` label → resolve app ID → find marker comment → fetch current Dokploy image → compare → stop if match

3. **Add required secrets** to the GitHub repository: `DOKPLOY_URL`, `DOKPLOY_API_KEY`.

4. **Add required variables** to the GitHub repository: `DOKPLOY_APP_ID_QA1`, `DOKPLOY_APP_ID_QA2`.

#### File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `.github/workflows/qa-deploy.yml` | Create | Manual QA build-and-deploy workflow |
| `.github/workflows/qa-stop-on-merge.yml` | Create | Automatic slot stop on PR close |
| `docker-compose.preview.yaml` | Create | Local single-service compose for developer/QA local preview runs |
| `.github/QA-DEPLOYMENT.md` | Create | QA engineer runbook for remote slot deploys and local preview usage |

---

### Phase 4: Dokploy Application Configuration

**Goal**: Create and configure the QA slot applications in Dokploy. This phase is a manual ops runbook.

#### Steps

1. **Create a new Application** in Dokploy for each slot (`qa1`, `qa2`):
   - Name: `open-mercato-qa1`
   - Source type: Docker
   - Docker image: any valid placeholder; the workflow overwrites it on first run
   - Exposed port: `3000`

2. **Add volume mount** (docker.sock):
   - Application → Advanced → Volumes
   - Source: `/var/run/docker.sock` / Destination: `/var/run/docker.sock` / Type: `Bind`

3. **Set environment variables** from the Configuration table above via Application → Environment.

4. **Copy the `applicationId`** from Dokploy (Application → Settings → General) and set it as `DOKPLOY_APP_ID_QA1` / `DOKPLOY_APP_ID_QA2` in GitHub repository variables.

5. **Configure domain** for each slot (e.g. `qa1.openmercato.com`) in Dokploy → Domains. Requires a DNS A record pointing to the Dokploy server IP.

#### File Manifest

No files created. This phase is entirely Dokploy and DNS configuration.

---

### Phase 5: End-to-End Validation

**Goal**: Confirm the full pipeline works from workflow trigger through auto-stop on merge.

#### Steps

1. Trigger `qa-deploy.yml` from the GitHub Actions UI with `slot=qa1`, a target branch, and a PR number.
2. Confirm the image is built and pushed to GHCR (Actions log).
3. Confirm Dokploy receives the deploy trigger (Dokploy → Deployments).
4. Wait ~10 minutes; confirm `https://qa1.openmercato.com/backend` is accessible.
5. Confirm the PR has the `qa:qa1` label and a marker comment with the correct image tag.
6. Trigger a second deployment to `qa1` with a different branch/PR. Confirm the first completes before the second starts (concurrency queue).
7. Close the first PR (without merging). Confirm `qa-stop-on-merge.yml` runs, detects the image mismatch (slot was redeployed for PR #2), and skips the stop.
8. Merge the second PR. Confirm `qa-stop-on-merge.yml` runs, images match, and the slot is stopped.

---

## Risks & Impact Review

### Data Integrity Failures

The QA environment is fully ephemeral and self-contained. No production data is involved. Risk is isolated to the QA slot.

### Cascading Failures & Side Effects

- **GHCR push failure**: `build-push-action` step fails; downstream Dokploy steps are skipped. Re-trigger the workflow.
- **Dokploy API unavailable**: `saveDockerProvider`, `deploy`, or `stop` curl call fails (`-fsS` flags cause non-zero exit). Workflow fails with a clear error. Re-trigger after resolving Dokploy connectivity.
- **docker.sock mount failure**: If the host Docker daemon is unavailable, `yarn test:integration:ephemeral:start` fails at the PostgreSQL startup step. The container exits with a non-zero code. Dokploy marks the deployment as failed. Re-trigger the workflow.
- **No marker comment found**: If a PR with a `qa:qa*` label is closed but no marker comment exists (e.g. PR was labelled manually without a workflow deploy), `qa-stop-on-merge.yml` fails with `core.setFailed`. The slot must be stopped manually via Dokploy UI.

### Migration & Deployment Risks

- `docker/preview/Dockerfile` is standalone and entirely separate from the main `Dockerfile`. Existing `builder`, `dev`, and `runner` stages in the main Dockerfile are unchanged.
- The `NODE_ENV: process.env.NODE_ENV ?? 'test'` change in `integration.ts` is backward-compatible: CI and local runs that do not set `NODE_ENV` continue to default to `'test'`.
- No database migrations in Open Mercato's production database are involved.
- `qa-deploy.yml` has minimal permissions (`contents: read`, `packages: write`, `pull-requests: write`, `issues: write`, `actions: read`) — it cannot modify repository settings, branch protection, or secrets.
- `qa-stop-on-merge.yml` is read-only on GitHub (`contents: read`, `pull-requests: read`, `issues: read`) — it only calls the external Dokploy API.
