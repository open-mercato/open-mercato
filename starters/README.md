# Starters

Everything starts with **one command** — the [`@open-mercato/starter`](../packages/starter/README.md) package:

```bash
npx @open-mercato/starter     # anywhere — clones the repo first if needed
yarn om                       # inside a clone
```

No Node yet? Use the pre-Node bootstraps shipped with the package (portable Node 24, no admin): `packages/starter/platform/start.cmd` (Windows double-click), `start.ps1`, or `start.sh` — see the package README.

The starter is idempotent (`up` converges: prerequisites → corporate TLS trust → env/secrets → install → infra → database → dev runtime) and platform-aware. It never installs WSL2 or a container runtime — it detects, guides, and prints an IT handout (`yarn om doctor`) for managed devices.

## Modes

| Mode | What runs where | Best for |
|------|-----------------|----------|
| **hybrid** (default) | App + MCP server natively via the supervised `yarn dev` runtime; OpenCode + postgres/redis/meilisearch in containers ([`docker/compose.infra.yml`](docker/compose.infra.yml)) | Day-to-day development: fast iteration, native debugging |
| **docker** (`up --mode docker`) | Everything in containers ([`docker/compose.fullapp.dev.yml`](docker/compose.fullapp.dev.yml)) | Machines where host Node workloads are not allowed |
| [`../.devcontainer/`](../.devcontainer/) | VS Code devcontainer | Editor-managed containerized workspace |

## What lives here

- [`docker/`](docker/) — the compose files (infra, fullapp, traefik overlays, preview). Always invoked with `--project-directory .` (repo root) so `.env` interpolation and relative bind mounts resolve there; the starter and the `yarn docker:*` / `yarn infra:*` scripts do this for you. See [`docker/README.md`](docker/README.md).
- [`company/`](company/) — per-organization tailoring of the starter (CA bundles, mirrors, extra checks/steps) without forking it. See [`company/README.md`](company/README.md).

The starter code itself lives in [`packages/starter/`](../packages/starter/) and is published to npm, so `npx @open-mercato/starter` works before you have anything else.
