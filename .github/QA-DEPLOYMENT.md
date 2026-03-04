# QA Deployment Guide

This guide explains how to deploy a branch to a QA environment and what to expect during the process.

---

## Overview

There are two named QA slots: **qa1** and **qa2**. Each slot is a long-lived environment with a fixed URL. A slot runs one deployment at a time — deploying to a slot replaces whatever was there before.

| Slot | URL |
|------|-----|
| qa1 | https://qa1.openmercato.com/backend |
| qa2 | https://qa2.openmercato.com/backend |

Each deployment spins up a **fresh database** seeded with demo data. There is no persistent state between deployments.

---

## How to Deploy a Branch to QA

1. Go to the repository on GitHub → **Actions** tab.
2. Select **Deploy to Dokploy QA** from the workflow list on the left.
3. Click **Run workflow** (top right of the workflow runs table).
4. Fill in the inputs:

   | Field | Required | What to enter |
   |-------|----------|---------------|
   | **QA slot** | Yes | `qa1` or `qa2` |
   | **Branch** | Yes | The branch name you want to test (e.g. `feat/my-feature`) |
   | **PR number** | No | The PR number associated with this branch (e.g. `123`). If provided, the workflow will label the PR and post a comment with the deployment details. |

5. Click **Run workflow**.

The workflow will appear in the runs list. Click it to follow the build progress.

> **Only one deployment per slot can run at a time.** If another deployment to the same slot is already in progress, yours will queue and start automatically when the first one finishes.

---

## How Long Does It Take?

The workflow itself (build + push to registry) takes **~5–15 minutes** depending on build cache.

After the workflow completes, the environment still needs time to start up on the server:

- Install dependencies, generate files, build packages — ~5 min
- Initialise the database and run migrations — ~2 min
- Build the Next.js app and start the server — ~3 min

**Total from workflow trigger to ready: approximately 10–20 minutes.**

The environment is ready when the URL returns the login page. Refresh until it loads — it will not send a notification when ready.

---

## Finding the QA URL After Deployment

If you provided a **PR number**, the workflow posts a comment on the PR with the slot and deployed image:

```
🚀 Deployed to qa1
- Image: ghcr.io/org/repo:qa1-a1b2c3d
- Branch: feat/my-feature
```

The slot URL is always the fixed address from the table above — it does not change between deployments.

---

## What Is Reset on Every Deployment

- **Database**: fully wiped and re-seeded with demo data on every deployment.
- **Uploaded files**: not persisted between deployments.
- **Application code**: updated to the deployed branch.

Do not use a QA slot to store test data you need to keep — it will be gone on the next deployment.

---

## Slot Cleanup — What Happens When a PR Is Closed

When a PR that was deployed to a slot is **closed** (merged or abandoned), a workflow runs automatically to stop the slot:

1. It detects the `qa:qa1` or `qa:qa2` label on the closed PR.
2. It checks whether the slot is still running the image that was deployed for this PR.
3. If yes — it stops the slot.
4. If the slot has since been redeployed for a different PR — it skips the stop to avoid interrupting an active session.

**The slot is not stopped automatically if:**
- The PR was not associated with a deployment (no PR number was entered when triggering the workflow, so no `qa:qa1`/`qa:qa2` label was added).

In that case, contact a developer or DevOps to stop the slot manually.

---

## Running the Preview Image Locally

You can build and run the same image used on QA slots on your own machine using Docker Compose.

### Prerequisites

- Docker Desktop running (required — the container spawns a PostgreSQL container via the Docker socket)
- Access to the repository

### 1. Create a `.env.preview` file

Create `.env.preview` in the repo root with at minimum:

```
NEXTAUTH_SECRET=any-random-string-at-least-32-chars
```

Any other app-specific secrets your tenant configuration requires can be added here too (see `apps/mercato/.env.example`).

### 2. Build and start

```bash
docker compose -f docker-compose.preview.yaml --env-file .env.preview up --build
```

The first run builds the image from scratch — expect **10–30 minutes** before the app is ready. Subsequent runs that skip `--build` reuse the cached image and are faster, but the database always resets.

### 3. Open the app

Once you see `ready` in the logs, open:

```
http://localhost:5000/backend
```

### 4. Stop and clean up

```bash
docker compose -f docker-compose.preview.yaml down
```

> The container manages its own PostgreSQL instance internally — there are no external volumes to clean up.

### Notes

- The `.env.preview` file is gitignored by default and should **never be committed**.
- On Linux, the `host.docker.internal` hostname resolves automatically via `extra_hosts`. On macOS and Windows, Docker Desktop handles it natively.
- If the container exits immediately, run with `docker compose logs preview-app` to see the startup error.

---

## Checking Slot Status

You can always check what is currently running on a slot by visiting its URL:
- If the login page loads — the slot is up.
- If you get a connection error or blank page — the slot is stopped or still starting up.

For detailed deployment logs, ask a developer with Dokploy access.

---

## Troubleshooting

| Symptom | Likely cause | What to do |
|---------|-------------|------------|
| Workflow fails in the build step | Build error in the branch | Ask the developer to fix the build and re-trigger |
| Workflow succeeds but URL does not load after 20 min | Startup error inside the container | Ask a developer to check Dokploy logs |
| "Slot queued" — workflow does not start immediately | Another deployment to the same slot is in progress | Wait for the current run to finish; yours starts automatically |
| URL loads stale content after deployment | Browser cache | Hard-refresh (`Cmd+Shift+R` / `Ctrl+Shift+R`) or open in a private window |
| PR has no `qa:qa1` label after deployment | PR number was not entered when triggering | The slot is deployed but not linked to the PR; auto-stop on merge will not fire |
