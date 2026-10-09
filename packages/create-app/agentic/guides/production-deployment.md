# Production Deployment Readiness

Use this provider-neutral checklist before recommending that a standalone Open Mercato app go live. During task routing, do not open `.env*`; this guide carries the safe configuration inventory. When performing the later readiness review, inspect only names and comments in the checked-in `.env.example`; do not read, copy, or report live `.env` values. Never expose credentials in commands, logs, plans, or reports.

Classify findings as **required**, **recommended**, or **module-specific**. Do not present every `.env.example` key as mandatory. Ask before accessing or changing credentials, creating billable infrastructure, or starting, changing, or rolling back a live deployment. This guide supports a readiness review; do not perform or claim a live deployment or an unrun check.

## 1. HTTPS/TLS, DNS, and the edge

- **Required:** Serve every public route over HTTPS with a valid, auto-renewing certificate. Redirect HTTP to HTTPS and verify the redirect, certificate chain, supported TLS versions, and renewal path.
- **Required:** Point the production domain deliberately and verify DNS before cutover. Set the app's canonical public URL/origin and any primary-host or custom-domain settings named in `.env.example` to the real HTTPS origin.
- **Required:** Configure the reverse proxy or load balancer to pass the original scheme, host, and client address only from trusted hops. Set `RATE_LIMIT_TRUST_PROXY_DEPTH` to the exact number of trusted proxy hops for the deployed topology; never trust arbitrary forwarded headers.
- **Recommended:** Apply current edge limits and security policy for request size, timeouts, abusive traffic, and known administrative routes. Preserve the security headers declared by `next.config.ts`; verify them at the public edge instead of assuming an intermediary kept them.

## 2. Runtime environment and secrets

- **Required:** Run a production build in production mode. Set `APP_URL` and, when the topology requires it, `INTERNAL_APP_ORIGIN` and `PLATFORM_PRIMARY_HOST` to exact origins rather than permissive patterns.
- **Required:** Generate strong, unique auth, session, JWT, lookup-hash, and tenant-encryption secrets for this environment. Store them in the platform's secret manager, restrict read access, and record owners for rotation and recovery.
- **Required:** Keep `.env`, `.env.production`, secret-manager exports, private keys, and token caches out of source control and deployment artifacts. Replace placeholders and remove demo autologin, test injections, debug/profiling switches, DevTools, and emergency authentication bypasses.
- **Recommended:** Define a rotation procedure that accounts for active sessions, encrypted data, webhook signatures, and rollback. Rehearse recovery for encryption keys before go-live.
- **Module-specific:** Supply only the credentials and feature/license flags needed by enabled modules and providers, such as mail, AI, storage, collaboration, or enterprise capabilities. Disable unused integrations rather than configuring speculative credentials.

## 3. Infrastructure and capacity

- **Required:** Keep PostgreSQL, Redis, and search services on private networks where possible. Require TLS and least-privilege service identities for external services; do not expose their administration ports publicly.
- **Required:** Size CPU, memory, disk, connection pools, acquisition/idle timeouts, and request limits for expected load. Document hard service limits and the scaling signal for each resource.
- **Required:** For multi-process or horizontally scaled deployments, use shared durable services for cache coordination, events, and asynchronous queues. Do not rely on process-local or SQLite state where another instance or worker must observe it.
- **Recommended:** Separate app and worker capacity so background load cannot starve web requests. Disable in-app worker auto-spawn when dedicated workers own the queues.

## 4. Data protection and recovery

- **Required:** Review generated migrations before the release and apply them through the deployment's controlled migration procedure. Never improvise schema changes against production.
- **Required:** Automate encrypted database and object-storage backups with retention and access controls. Run a timed restore test into an isolated environment and record the recovery-point and recovery-time results.
- **Required:** Protect and recover tenant-encryption keys independently from the encrypted database backup. Losing either side makes the backup unusable.
- **Required:** Use durable attachment/object storage when uploads must survive instance replacement. Confirm lifecycle, versioning, deletion, and restore behavior.
- **Recommended:** Document how search and query indexes are rebuilt after restore, how queued work is reconciled, and which release changes make a database rollback unsafe.

## 5. Access controls and application security

- **Required:** Review RBAC/ACL grants for least privilege across tenant, organization, administrative, integration, worker, and support access. Remove or rotate bootstrap and demo credentials.
- **Recommended:** Require MFA or passkeys for privileged users where available and define a controlled, auditable recovery path.
- **Required:** Restrict browser origins and CORS with `APP_ALLOWED_ORIGINS` and, when those capabilities are enabled, `CHECKOUT_ALLOWED_ORIGINS` and `DOCUMENTS_COLLAB_ALLOWED_ORIGINS`. Use only the intended HTTPS origins; keep collaboration and other real-time origins equally constrained.
- **Required:** Enable rate limits at the edge and application boundaries appropriate to authentication, public APIs, uploads, and expensive operations.
- **Module-specific:** Verify inbound webhook signatures against raw bodies, enforce timestamp/replay bounds and body-size limits, and make delivery processing idempotent. Restrict outbound webhook destinations and redact signed URLs or payload secrets.
- **Recommended:** Review the deployed CSP and other security headers from `next.config.ts` against enabled providers; add only the narrowly required origins.

## 6. Workers, queues, and durable storage

- **Required:** Run dedicated workers for enabled background jobs, with the same release version and compatible configuration as the web app. Prove failed jobs are visible, retries are bounded, and duplicate delivery is safe.
- **Required:** Use durable queue and file/object storage paths that survive restarts and deploys. Confirm access permissions, quotas, cleanup, and retention.
- **Recommended:** Monitor queue depth, oldest-job age, failure/dead-letter counts, worker liveness, and storage capacity. Document how operators pause, drain, retry, and recover work.

## 7. Observability and operations

- **Required:** Emit structured production logs without credentials, raw tokens, sensitive payloads, or live environment values. Attach correlation identifiers across web, worker, queue, and integration paths.
- **Required:** Configure error reporting and telemetry, `/api/healthz` and readiness probes, and alerts for availability, latency, errors, queue backlog, database/Redis connectivity, resource exhaustion, disk/storage pressure, and certificate expiry.
- **Required:** Set retention and access rules for logs, traces, audit data, backups, and provider payloads. Name an on-call owner and escalation path for every actionable alert.
- **Recommended:** Build dashboards and synthetic checks around customer-critical flows rather than treating process uptime as service readiness.

## 8. Staging validation and health checks

- **Required:** From the exact release artifact, run `yarn generate`, the production build, relevant tests, and migration review. Record honest results and blockers; never claim checks that were not run.
- **Required:** In a production-like staging environment backed by real PostgreSQL and the chosen Redis/queue/storage topology, smoke-test sign-in, authorization, and critical create/update/delete flows.
- **Module-specific:** Exercise worker/queue processing, mail delivery, webhook signature/replay behavior, uploads, search/index rebuilds, and enabled provider health checks.
- **Required:** Verify `/api/healthz`, public TLS, HTTP-to-HTTPS redirect, DNS, security headers, origin/CORS behavior, and proxy/client-address handling from outside the private network.
- **Recommended:** Run a small load/concurrency test against the expected peak shape and verify alert delivery to the actual on-call path.

## 9. Rollout, verification, and rollback

- **Required:** Define deployment owner, maintenance/cutover window, change record, staged or canary sequence, health thresholds, and a stop decision before deployment starts.
- **Required:** Document an executable rollback for application artifacts, configuration, workers, and data. Identify migrations or external side effects that require forward repair instead of a binary rollback.
- **Required:** After rollout, repeat health and critical-flow checks, inspect error/latency/queue/resource signals, and confirm scheduled and asynchronous work progresses.
- **Recommended:** Keep the previous compatible artifact and configuration reference available for the agreed recovery window, then review incidents and update this checklist.

## 10. Provider runbooks and repository sources

- Canonical checklist: [Production readiness and security](https://docs.openmercato.com/docs/deployment/production-readiness)
- Railway-specific deployment: [Deploy to Railway](https://docs.openmercato.com/docs/deployment/railway)
- VPS-specific deployment: [VPS installation](https://docs.openmercato.com/docs/installation/vps)
- Configuration inventory: `.env.example` in the standalone app. Use names and comments only; do not read or report live `.env` values.
- Runtime headers and proxy behavior: `next.config.ts` in the standalone app.

Provider runbooks own provider commands, resource shapes, and platform caveats. This guide owns the shared readiness contract; when they disagree, stop and verify current repository documentation instead of inventing a default.
