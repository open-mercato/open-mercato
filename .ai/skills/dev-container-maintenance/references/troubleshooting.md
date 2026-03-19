# Dev Container Troubleshooting

Diagnose and fix dev container failures. Work through the relevant section based on the reported symptom.

## Diagnostic Strategy

1. Identify the failure phase (build, start, post-create, runtime)
2. Read the relevant log output
3. Match to a known issue below
4. Apply the fix

## Phase 1: Container Build Failures

The container fails to build (Dockerfile errors).

### Dockerfile syntax or package error
**Symptom**: Build fails during `docker build` with `apk` errors or missing packages.
**Diagnose**: Read `.devcontainer/Dockerfile`. Check if an `apk add` package name is wrong or the base image changed.
**Fix**: Correct the package name. Alpine package names differ from Debian (e.g., `postgresql-client` not `postgresql-client-17`).

### Node.js image not found
**Symptom**: `manifest unknown` or `not found` error for the base image.
**Diagnose**: Check if `FROM node:<ver>-alpine` uses a version that exists on Docker Hub.
**Fix**: Update to a valid Node.js Alpine tag. Check `.nvmrc` for the correct major version.

### Homebrew (Linuxbrew) install failure
**Symptom**: Build fails during the `NONINTERACTIVE=1 /bin/bash -c "$(curl ...install.sh)"` step with network errors, permission errors, or missing dependencies.
**Diagnose**: Common causes: (1) no internet during Docker build, (2) Homebrew install script changed and requires new system deps, (3) base image missing expected glibc libraries.
**Fix**: Retry first (network transient). If persistent, check that `procps` and `file` packages are installed before the Homebrew step. If Homebrew itself is broken upstream, temporarily comment out the Homebrew `RUN` and the shellenv lines in the Dockerfile — the container will still work without `brew`.

### Claude Code CLI install failure
**Symptom**: `curl -fsSL https://claude.ai/install.sh | bash` fails during build.
**Diagnose**: Network issue during build, or the install script changed and requires new dependencies. If the error is `Syntax error: "(" unexpected`, the script was piped to `sh` (dash) instead of `bash`.
**Fix**: Retry for network issues. Ensure the pipe target is `bash` not `sh`. The CLI install is non-critical — can be removed temporarily.

### Corepack/Yarn version mismatch
**Symptom**: `corepack prepare yarn@X.Y.Z` fails or warns about version mismatch.
**Diagnose**: Compare `package.json` `"packageManager"` value with Dockerfile `corepack prepare` command.
**Fix**: Update Dockerfile to match the exact version in `package.json`.

## Phase 2: Service Health Check Failures

Container starts but services fail health checks. `postCreateCommand` never runs because workspace depends on healthy services.

### PostgreSQL not starting
**Symptom**: `postgres` service unhealthy. Logs: `FATAL: data directory has wrong ownership`.
**Diagnose**: Stale `postgres_data` volume with wrong permissions.
**Fix**: Wipe the postgres volume: `docker volume rm <project>_devcontainer_postgres_data` then reopen.

### PostgreSQL password rejected
**Symptom**: `FATAL: password authentication failed for user "postgres"`.
**Diagnose**: `postgres_data` volume was created with different credentials than current `docker-compose.yml`.
**Fix**: Wipe postgres volume (see above). Credentials are set on first init and stored in the volume.

### Redis not starting
**Symptom**: `redis` service unhealthy.
**Diagnose**: Check redis logs. Usually a port conflict or corrupt `redis_data` volume.
**Fix**: Wipe redis volume: `docker volume rm <project>_devcontainer_redis_data`

### Meilisearch not starting
**Symptom**: `meilisearch` service unhealthy. Logs: version mismatch errors.
**Diagnose**: `meilisearch_data` volume was created with a different Meilisearch version.
**Fix**: Wipe meilisearch volume: `docker volume rm <project>_devcontainer_meilisearch_data`

### Finding volume names
Run on host: `docker volume ls -q | grep devcontainer`
Volume names are prefixed with the project directory name (e.g., `open-mercato_devcontainer_`).

## Phase 3: postCreateCommand Failures

`post-create.sh` runs on first container creation. Failures stop at the failing step.

### Step [0/7]: Fix volume permissions — EACCES
**Symptom**: `chown: operation not permitted` or later `EACCES` on yarn install.
**Diagnose**: Docker volume was created by a different user/container. The `sudo chown` in post-create.sh should fix this, but may fail if sudo is not configured.
**Fix**: Verify `.devcontainer/Dockerfile` grants `node` user passwordless sudo. If the volume is corrupt, rebuild container.

### Step [1/7]: Generate .env fails
**Symptom**: `setup-env.sh` fails. Missing `.env.example` or sed errors.
**Diagnose**: Read `setup-env.sh`. Check if `.env.example` format changed (e.g., variable renamed, comment format changed).
**Fix**: Update `sed` patterns in `setup-env.sh` to match current `.env.example` format. The script has verification checks at the end — if they fail, the sed patterns don't match the file.

### Step [2/7]: yarn install fails
**Symptom**: Dependency resolution errors, network timeouts, or native addon compilation failures.
**Diagnose**:
- Network: Check Docker Desktop network settings
- Native addon: Check if `.devcontainer/Dockerfile` has required build tools (`python3`, `make`, `g++`)
- Lockfile: Check if `yarn.lock` is corrupt or has conflicts
**Fix**: For native addons, add missing `apk` packages to Dockerfile. For network issues, retry.

### Step [3/7]: Install skills fails
**Symptom**: `scripts/install-skills.sh` not found or symlink errors.
**Diagnose**: The install-skills script may have been moved or renamed.
**Fix**: Update the path in `post-create.sh`. This step is non-critical — can be skipped.

### Step [4/7] or [6/7]: yarn build:packages fails
**Symptom**: TypeScript compilation errors or missing dependencies.
**Diagnose**: Build errors in packages. May be caused by:
- Missing dist/ from another package (dependency ordering issue)
- TypeScript version mismatch
- New package added without proper build config
**Fix**: Check the turbo build graph. Ensure all packages have proper `build` scripts in their `package.json`.

### Step [5/7]: yarn generate fails
**Symptom**: Module generator errors.
**Diagnose**: Usually caused by step [4] not completing correctly (missing built packages).
**Fix**: Ensure step [4] succeeds first. If generate itself fails, check `packages/cli/` for generator changes.

### Step [7/7]: Database init/migrate fails
**Symptom**: `yarn mercato init` fails with table errors, or `yarn db:migrate` fails with "relation already exists".
**Diagnose**:
- "relation already exists": DB has tables from a different branch. `post-create.sh` detected tables and ran `db:migrate` instead of `mercato init`.
- "column does not exist" or similar: Migration files are out of sync with DB state.
**Fix**: Wipe the postgres volume to start fresh:
```bash
# From host terminal:
docker volume rm $(docker volume ls -q | grep devcontainer | grep postgres)
```
Then reopen the container in VS Code.

## Phase 4: Runtime Issues

Container is running but development workflow has problems.

### Hot reload not working
**Symptom**: File changes not detected by Next.js/turbo.
**Diagnose**: Check environment variables `WATCHPACK_POLLING` and `CHOKIDAR_USEPOLLING` in `.devcontainer/docker-compose.yml`.
**Fix**: Both must be set to `true` in the workspace service environment. This is required for macOS Docker bind mounts.

### OOM during page compilation
**Symptom**: Container crashes during Next.js/Turbopack compilation. `dmesg` shows OOM killer.
**Diagnose**: Docker Desktop memory allocation is below 12 GB.
**Fix**: Docker Desktop → Settings → Resources → Memory → 12 GB minimum.

### .env changes lost after rebuild
**Symptom**: Custom environment variables disappear after "Rebuild Container".
**Diagnose**: User edited `.env` directly instead of `.env.local`.
**Fix**: Move custom overrides to `apps/mercato/.env.local` (Next.js native priority, never overwritten).

### Cannot connect to database/Redis/Meilisearch from host tools
**Symptom**: Host-based tools (pgAdmin, DBeaver, redis-cli, Meilisearch dashboard) get "connection refused" or "server closed the connection unexpectedly".
**Diagnose**: Check `devcontainer.json` `forwardPorts`. Non-workspace services must use named service syntax (`"postgres:5432"`, not `5432`). Numeric entries forward the port on the workspace container, not on the service that actually listens.
**Fix**: Ensure `forwardPorts` uses named syntax for all non-workspace services:
```json
"forwardPorts": [3000, "postgres:5432", "redis:6379", "meilisearch:7700"]
```
Rebuild the container after changing `devcontainer.json`.

Connection strings from host after forwarding:
- PostgreSQL: `postgresql://postgres:postgres@localhost:5432/open-mercato`
- Redis: `redis://localhost:6379`
- Meilisearch: `http://localhost:7700`

### New package missing dist/ in container
**Symptom**: Import errors for a newly added package. Its `dist/` is empty inside the container.
**Diagnose**: The auto-generated `docker-compose.volumes.yml` may be stale.
**Fix**: Rebuild container (triggers `initializeCommand` which re-runs `generate-compose-volumes.sh`). If the problem persists, check that the script correctly scans `packages/*/`.

### Permission errors on node_modules or dist/
**Symptom**: `EACCES` or `EPERM` when writing to `node_modules/` or `packages/*/dist/`.
**Diagnose**: Named volumes created by Docker are owned by root. `post-create.sh` runs `sudo chown -R node:node` on these, but this only happens on first create.
**Fix**: Run manually inside the container:
```bash
sudo chown -R node:node /workspace/node_modules
sudo chown -R node:node /workspace/packages/*/dist
```
Or rebuild the container to trigger `post-create.sh` again.

## Nuclear Options

When individual fixes don't work, these reset everything:

### Wipe all dev container volumes (preserves source code)
```bash
# From host terminal:
docker volume ls -q | grep devcontainer | xargs docker volume rm
```
Then reopen in VS Code. All data (DB, node_modules, dist, caches) will be rebuilt from scratch.

### Full Docker cleanup
```bash
docker system prune -a --volumes
```
Warning: This removes ALL Docker data, not just the dev container.

### Rebuild vs volume wipe
- **"Rebuild Container"** (VS Code command): Rebuilds the Docker image but **does NOT wipe named volumes**. Use for Dockerfile changes.
- **Volume wipe** (manual `docker volume rm`): Removes data. Use for stale/corrupt data.
- You often need both: wipe volumes first, then rebuild.
