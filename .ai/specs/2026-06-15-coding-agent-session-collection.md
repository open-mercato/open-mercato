# Coding-Agent Session Collection (Dev Session Insights)

**Date:** 2026-06-15
**Status:** Draft
**Edition:** OSS client + module (ships dormant); analysis dashboard is a separate commercial repo (reuses the `telemetry-central` pattern)
**Scope:** (1) `create-mercato-app` extension that installs consent-gated Claude Code / OpenAI Codex session-shipping hooks into a scaffolded project; (2) a local **sanitizer** that strips PII and dangerous data before any upload; (3) an OSS ingestion **module** (`coding_sessions`) that asynchronously accepts sanitized sessions and stores them **filesystem-first with a DB metadata index**; (4) its relationship to the two telemetry specs.

## TLDR

**Key Points:**
- With **explicit, opt-in, revocable** consent, an Open Mercato developer's Claude Code / Codex coding sessions are **sanitized locally** and shipped to a central Open Mercato collection instance, so the team can analyze *how* people build with Open Mercato (which modules, which AGENTS.md guides, where agents get stuck) — the qualitative complement to the aggregate counts in the [phone-home spec](enterprise/2026-06-04-usage-telemetry-phone-home.md).
- Two halves: a **developer-side shipper** (a tiny dependency-light script + agent hooks, installed by `create-mercato-app` only after a clear yes/no consent prompt that defaults to **No**), and a **collection-side OSS module** `coding_sessions` (ingestion API + async queue worker + filesystem blob store + DB metadata index + admin list).
- **Privacy is the load-bearing requirement.** Raw sessions contain source code, prompts, file paths, usernames, and frequently secrets. A mandatory multi-stage **redaction pipeline runs on the developer's machine before any byte leaves it**; the server then **re-scans (defense in depth)** and quarantines anything that still looks sensitive. Nothing is collected unless consent is on disk.

**Scope:**
- Developer side: consent prompt in `create-mercato-app`, a consent/installId record in the scaffolded project, a `shipper` script, Claude Code `Stop`/`SessionEnd` hooks and a Codex `notify` shim, plus a manual `enable`/`disable`/`status` command.
- Sanitizer: secret/credential redaction, PII redaction, path/home normalization, dangerous-file dropping, event-type allowlisting, content-level control (metadata-only → redacted-content), size caps, and a per-upload redaction report.
- Collection side: `POST /api/coding_sessions/ingest` (token-auth, returns `202`, never blocks), a queue worker that persists to disk, a `coding_session_uploads` metadata table, retention/quarantine, and a backoffice list page.
- Relationship to `@open-mercato/telemetry` (emit spans/metrics through the facade) and to `@open-mercato/telemetry-client` (shared enablement-precedence + fail-safe patterns, separate channel).

**Concerns:**
- Coding sessions are far more sensitive than aggregate counts. Consent MUST be explicit, disclosed, and trivially revocable; defaults MUST be off; redaction MUST be conservative (drop-on-doubt).
- A collection endpoint that is slow/down must never affect the developer's agent loop — the shipper runs **out of band** (post-session, detached) under a hard time budget and is fail-open.
- "We can read your prompts and code" is a trust cliff; the spec over-documents exactly what is and isn't sent, ships disabled by default, and keeps the whole shipper auditable (small, dependency-light, in-repo).

> **Market Reference:** Studied VS Code / Next.js anonymous telemetry, GitHub Copilot data-collection disclosures, PostHog/Plausible self-host beacons, Sentry `before_send` scrubbing, `git-secrets` / `gitleaks` / `detect-secrets` redaction heuristics, and the existing Open Mercato phone-home spec.
> **Adopted:** opt-in-default-off consent, local-first redaction with server-side re-scan, append-only blob storage with a thin metadata index, `before_send`-style scrubbing, gitleaks-style secret regexes + entropy detection, and the phone-home enablement-precedence + fail-open patterns.
> **Rejected:** any always-on or default-on collection, shipping raw unredacted transcripts, blocking the agent loop on upload, storing large transcript blobs as Postgres rows, and collecting any session when a consent record is absent.

## Artifact Split

| Artifact | Repo / Location | License | Notes |
|----------|-----------------|---------|-------|
| `create-mercato-app` consent prompt + hook installer | this monorepo (`packages/create-app`) | OSS | New optional post-scaffold step + `agentic/dev-sessions/` assets. Default OFF. |
| Developer-side shipper + sanitizer | scaffolded project (`scripts/dev-sessions/`), sourced from `create-app` templates; library logic in new OSS package `@open-mercato/dev-session-kit` | OSS | Dependency-light Node ESM; reused by hooks and by the `mercato dev-sessions` CLI. No Open Mercato runtime needed to run. |
| `coding_sessions` ingestion module | this monorepo (`packages/core/src/modules/coding_sessions`) **or** dedicated OSS package | OSS | Ingestion API, queue worker, filesystem writer, metadata entity, admin list. Dormant unless enabled + token configured. Runs on the **collection** instance. |
| Analysis / insights dashboard | **separate commercial repo** (extends `open-mercato/telemetry-central`) | Proprietary | Rich exploration of collected sessions. NOT in this monorepo. This spec defines the ingestion contract it consumes. |

The developer side has **no dependency on a running Open Mercato app** — it is plain files in the generated project. The collection side is an ordinary Open Mercato module that the team enables on a dedicated collection instance (its own tenant/org), exactly as `telemetry-central` is itself an Open Mercato instance running the `telemetry` module.

## Problem Statement

- The team has no visibility into *how* developers actually use Open Mercato with coding agents: which AGENTS.md guides get read, which Task Router rows are hit, where agents loop or fail, which modules are scaffolded, how skills perform in the wild. The [phone-home spec](enterprise/2026-06-04-usage-telemetry-phone-home.md) answers *how many* installs and *how big*; it cannot answer *how people build*.
- Coding sessions (Claude Code transcripts, Codex rollouts) contain exactly this signal — but also contain source code, secrets, file paths, and PII. There is no safe, consented channel to collect them today.
- A naive "upload my transcripts" feature would (a) leak secrets and customer code, (b) collect without informed consent, or (c) couple to the agent's hot loop. All three are unacceptable.

## Proposed Solution

A two-sided, opt-in pipeline:

1. **Consent at scaffold time.** `create-mercato-app` asks a clear yes/no question (default **No**) during the existing agentic-setup wizard. On "yes" it writes a consent record (with a fresh anonymous `installId`) and installs agent hooks + a shipper into the new project. On "no" (or non-interactive), nothing is installed; a one-line note explains how to opt in later.
2. **Session capture via agent hooks.** Claude Code fires a `Stop`/`SessionEnd` hook; Codex fires its `notify` program at `turn-ended`/session end. The hook is a thin shim that hands the session's transcript path to the shipper **detached** (does not block the agent).
3. **Local sanitization (mandatory).** The shipper reads the transcript, runs the multi-stage redaction pipeline, drops dangerous content, normalizes paths, and produces a sanitized blob plus a redaction report. If consent is absent/revoked, it exits 0 immediately.
4. **Fail-open upload.** The sanitized blob is POSTed to the configured endpoint under a hard time budget. Any error/timeout is swallowed and logged locally at debug; the blob is optionally spooled for one retry on the next session. The agent is never affected.
5. **Async ingestion.** The `coding_sessions` module accepts the upload, returns `202` immediately, enqueues a job, **re-scans for secrets (defense in depth)**, writes the (gzipped) blob to the filesystem, and inserts a metadata row. Quarantine on residual secrets.
6. **Analysis.** The metadata index + blob store are read by the commercial insights dashboard (separate repo).

### Enablement Resolution (developer side — precedence, first match wins)

Mirrors the phone-home precedence so behavior is predictable across the two channels:

1. `OM_DEVSESSIONS_DISABLED=true` → **disabled** (hard kill switch, always wins).
2. No consent record at `.mercato/dev-sessions/consent.json` → **disabled**.
3. Consent record present with `enabled: true` and a `consentVersion` matching the shipper → **enabled**.
4. otherwise → **disabled**.

`.env.example` ships with `OM_DEVSESSIONS_DISABLED` unset and **no** consent record — collection is off until the developer opts in.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Opt-in, default **No**, consent recorded on disk | Informed-consent-by-design; absence of the consent file is a hard "no". |
| Redact **locally** before upload, **re-scan on server** | Defense in depth: the sensitive data never leaves the machine in the clear, and the server still refuses to persist anything that slips through. |
| Drop-on-doubt redaction | False positives (over-redaction) are acceptable; false negatives (leaked secret) are not. |
| Shipper runs **detached / post-session**, hard time budget, fail-open | The agent loop is never blocked or slowed by collection or a bad endpoint. |
| Content-level control (`metadata` → `redacted-content`), default `redacted-content` | Lets cautious developers contribute structural signal without any prompt/code text. |
| Filesystem-first blobs + thin DB metadata index | Big JSON stays out of Postgres; the index stays queryable and cheap. (User-confirmed.) |
| Token-authenticated ingestion, `202` accept, async worker | Public-facing endpoint that can't be abused for free and never blocks the request thread. |
| Dependency-light, in-repo, auditable shipper | Trust requires the developer (or a reviewer) be able to read exactly what is collected and sent. |
| Anonymous `installId`, no account linkage | No user identity is required or stored; installs are deduped without identifying people. |
| Reuse telemetry facade + phone-home patterns; **separate channel** | Consistency without overloading the aggregate-counts beacon with bulk transcript traffic. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|--------------|
| Default-on with opt-out | Unacceptable for code/prompt data; violates informed consent. |
| Ship raw transcripts, redact only server-side | Sensitive data would transit and land in the clear before scrubbing; a server bug would leak it. |
| In-process collection inside the agent loop | Couples to the agent's hot path; a slow endpoint would degrade the dev experience. |
| Store transcripts as Postgres `jsonb` rows | Multi-MB blobs bloat the DB and backups; filesystem-first is simpler and cheaper (user-confirmed). |
| Reuse the phone-home daily beacon channel | Bulk transcript uploads have nothing in common with a 100 ms aggregate beacon; conflating them risks both. |
| Collect via a background daemon watching `~/.claude` | Surprising, hard to consent to, and runs outside the project's trust boundary. |

## Architecture

### End-to-end flow

```
Developer machine (scaffolded project)                    Collection instance (OM + coding_sessions)
┌───────────────────────────────────────────┐            ┌──────────────────────────────────────────┐
│ Claude Code / Codex session ends           │            │                                            │
│   └─ agent hook (Stop / notify) [detached] │            │                                            │
│        └─ shipper                           │            │                                            │
│             1. consent gate (exit if off)   │            │                                            │
│             2. read transcript .jsonl       │            │                                            │
│             3. sanitize (redact/drop/norm)  │            │                                            │
│             4. build CodingSessionUpload    │  HTTPS     │  POST /api/coding_sessions/ingest          │
│             5. POST (hard budget, fail-open)│ ─────────► │   - validate zod + ingest token            │
│             6. spool-for-retry on failure   │            │   - 202 Accepted (no blocking)             │
└───────────────────────────────────────────┘            │   - enqueue 'coding-session-ingest'        │
                                                          │        └─ worker:                          │
                                                          │           a. server-side secret re-scan    │
                                                          │           b. gzip blob → filesystem        │
                                                          │           c. insert coding_session_uploads │
                                                          │           d. quarantine on residual secret  │
                                                          │           e. emit telemetry span/metric     │
                                                          └──────────────────────────────────────────┘
                                                                         │ read-only
                                                                         ▼
                                                          Commercial insights dashboard (separate repo)
```

### Part A — `create-mercato-app` extension

Extends the existing agentic-setup flow (`packages/create-app/src/setup/wizard.ts:runAgenticSetup`, dispatched from `packages/create-app/src/index.ts:maybeRunAgenticSetup`). The generators already write `.claude/settings.json` and a `.claude/hooks/*.ts` script, so installing collection hooks follows an established precedent.

**New post-scaffold step** (runs only when at least one agent tool was selected, and only interactively unless a flag is given):

```
🔭  Help improve Open Mercato (optional)

   May we collect your Claude Code / Codex coding sessions to learn how
   developers build with Open Mercato?

   • Sessions are SANITIZED ON YOUR MACHINE before anything is sent:
     secrets, credentials, emails, IPs and absolute paths are redacted,
     dangerous files (.env, .ssh, keys) are dropped.
   • Collection is OFF unless you say yes here. You can revoke any time
     with `yarn mercato dev-sessions disable`.
   • What is sent, and the exact redaction rules, are documented in
     scripts/dev-sessions/README.md (all code is in your project).

   Enable coding-session collection? [y/N]:
```

CLI flags (mirroring `--skip-agentic-setup`):
- `--dev-sessions` / `--no-dev-sessions` — force the choice non-interactively.
- Non-interactive default (no TTY, or `--skip-agentic-setup`): **disabled**, with a note to run `yarn mercato dev-sessions enable` later.

On **yes**, the new generator `generateDevSessions(config)`:
1. Writes the consent record `.mercato/dev-sessions/consent.json` (`enabled: true`, fresh `installId` UUID v4, `consentVersion`, `contentLevel: "redacted-content"`, `acceptedAt`).
2. Copies the shipper + sanitizer + README into `scripts/dev-sessions/` (from `agentic/dev-sessions/`, copied to `dist/agentic/` by `build.mjs`, resolved like the other generators).
3. Patches/creates `.claude/settings.json` to add a `Stop` (and `SessionEnd`) hook invoking the shim.
4. Writes `.codex/dev-sessions-notify.mjs` and prints the one-line `notify = [...]` snippet for the developer to add to `~/.codex/config.toml` (Codex `notify` is a global, single-program setting, so it cannot be safely auto-edited per-project — see Risks).
5. Adds `OM_DEVSESSIONS_ENDPOINT` (and commented `OM_DEVSESSIONS_DISABLED`) to `.env.example`.
6. Adds `.mercato/dev-sessions/spool/` to `.gitignore` and ensures `consent.json` placement is intentional (see Risks — the consent record carries the `installId`, not secrets).

On **no**: nothing installed; print how to enable later.

A new `mercato dev-sessions <enable|disable|status|send>` CLI subcommand (in the scaffolded app's `mercato` CLI) lets developers manage consent and trigger a manual send after the fact.

### Part B — The shipper (how the session is obtained and sent)

A single dependency-light ESM script `scripts/dev-sessions/ship.mjs`, plus shared logic from `@open-mercato/dev-session-kit`. Invoked by the agent hook with the session/transcript path, or manually via `mercato dev-sessions send`.

**Obtaining the session:**
- **Claude Code:** the `Stop`/`SessionEnd` hook receives JSON on **stdin** including `session_id`, `transcript_path`, and `cwd`. The shim reads stdin, extracts `transcript_path` (the per-project `~/.claude/projects/<slug>/<uuid>.jsonl`), and passes it to the shipper. (If a future Claude Code version omits `transcript_path`, fall back to resolving the newest `*.jsonl` under the path-slug dir for `cwd`.)
- **Codex:** the `notify` program is invoked with a JSON argument describing the event (`turn-ended` / session end) including the session id; the shim resolves the rollout file under `~/.codex/sessions/YYYY/MM/DD/rollout-*-<id>.jsonl`.

**Execution model:**
- The shim returns to the agent immediately and runs the shipper **detached** (`spawn(..., { detached: true, stdio: 'ignore' }).unref()`), so the agent loop is never blocked.
- The shipper enforces a hard wall-clock budget (`OM_DEVSESSIONS_TIMEOUT_MS`, default `5000`) on the upload via `AbortController`.
- **Fail-open:** any error/timeout/non-2xx is caught, logged to `.mercato/dev-sessions/ship.log` at debug, and (optionally) the sanitized blob is written to `.mercato/dev-sessions/spool/` for **one** retry attempt on the next session. The shipper always exits 0.
- **Consent gate first:** if `OM_DEVSESSIONS_DISABLED=true` or the consent record is missing/`enabled:false`/version-mismatched, the shipper exits 0 before reading any transcript.

### Part C — The sanitizer (PII + dangerous-data redaction) — load-bearing

Runs **entirely locally** in `@open-mercato/dev-session-kit` before the upload is built. The pipeline is conservative (drop-on-doubt) and versioned (`redactionVersion`). Stages:

1. **Event-type allowlist.** Parse the transcript line-by-line. Keep structural events (`user`, `assistant`, `queue-operation`, `permission-mode`, tool-use metadata, `session_meta`, `turn_context`). **Drop** `file-history-snapshot` / `response_item` payloads that embed full file contents and `attachment` binaries by default.
2. **Content-level gate.** `contentLevel: "metadata"` strips all free-text prompt/response bodies and keeps only structure (event types, tool names, timings, model ids, git branch hash, token counts). `contentLevel: "redacted-content"` (default) keeps text **after** stages 3–6. (A `full` level is intentionally not offered in v1.)
3. **Secret/credential redaction.** Regex + Shannon-entropy detection over all retained text and tool inputs: API keys, AWS access/secret keys, GCP/Azure keys, private keys (`-----BEGIN ... PRIVATE KEY-----`), JWTs, bearer tokens, `Authorization` headers, DB connection strings, `password=`/`secret=`/`token=` assignments, high-entropy strings ≥ threshold length. Matches → `«redacted:secret»`. Heuristics modeled on gitleaks/detect-secrets rule families.
4. **Dangerous-file dropping.** Any tool input/output whose path matches `.env*`, `**/.ssh/**`, `id_rsa`, `*.pem`, `*.key`, `**/.aws/**`, `**/.gcloud/**`, credential stores, or whose content is recognized as an env dump → drop the event body entirely (keep a `{ dropped: "dangerous-file" }` marker).
5. **PII redaction.** Email addresses, phone numbers, IPv4/IPv6 addresses, OS username, git author name/email → tokens (`«redacted:email»`, etc.).
6. **Path/home normalization.** Replace `$HOME` / `/Users/<name>` / `/home/<name>` with `~`; rewrite absolute project paths to repo-relative; strip the path-slug so the project's absolute location isn't leaked.
7. **Size cap + truncation.** Per-event and per-upload byte caps (`OM_DEVSESSIONS_MAX_BYTES`, default 5 MB after gzip); oversized text is truncated with a marker.
8. **Redaction report.** Produce counts per category (`secrets`, `pii`, `danger`, `truncations`) attached as `sanitizer` metadata so the server can gauge quality and quarantine if `secrets` is suspiciously high.

The README in `scripts/dev-sessions/` documents every rule and shows a `mercato dev-sessions send --dry-run` mode that prints exactly what would be uploaded (sanitized) without sending — so the developer can audit before trusting it.

### Part D — The ingestion module (`coding_sessions`, OSS)

A standard Open Mercato module (follows the `customers` reference; see `packages/core/AGENTS.md`). Runs on the collection instance under its own tenant/org.

- **API route:** `POST /api/coding_sessions/ingest` (`makeCrudRoute` is not a fit — this is a custom command-style handler). Validates the `CodingSessionUpload` zod schema, checks the ingest token, derives `observed_ip` from the request socket, returns **`202 Accepted`** with `{ ok: true }`, and enqueues a `coding-session-ingest` job. Exports `openApi`. Rate-limited per token. Body size capped.
- **Auth:** a shared **ingest token** (`OM_CODING_SESSIONS_INGEST_TOKEN`) presented as `Authorization: Bearer …`. Tokens are coarse (per distribution channel), not per user — they only authorize *writing*, never reading. Unknown/missing token → `401`, no enqueue.
- **Queue worker:** `workers/coding-session-ingest.ts` (`metadata.queue = 'coding-session-ingest'`, idempotent by `uploadId`). Steps: (a) server-side secret **re-scan** of the payload (reuse `@open-mercato/dev-session-kit` rules); (b) if residual secrets found → write to a `quarantine/` dir, flag `status: 'quarantined'`, do **not** expose to the dashboard; (c) else gzip the sanitized blob and write to the filesystem; (d) insert the `coding_session_uploads` metadata row; (e) emit a telemetry span + counter via `@open-mercato/telemetry`.
- **Filesystem store:** root `OM_CODING_SESSIONS_STORAGE_DIR` (default `var/coding-sessions`), layout `…/<yyyy>/<mm>/<dd>/<installId>/<uploadId>.json.gz`. Append-only; never overwritten. Quarantined blobs under `…/quarantine/`.
- **Retention:** `OM_CODING_SESSIONS_RETENTION_DAYS` (default 180); a scheduled worker prunes blobs + rows past retention. Quarantined blobs pruned aggressively (default 7 days) after alerting.
- **Admin UI:** a backoffice list page (DataTable) over `coding_session_uploads` showing install, tool, size, event count, redaction findings, status, received-at — **metadata only**; blob bodies are not rendered in the OSS module (the commercial dashboard handles exploration). Feature-gated via `acl.ts` (`coding_sessions.view`).

### Part E — Relationship to the telemetry specs

| Aspect | Phone-home (`telemetry-client`, enterprise spec) | This spec (`coding_sessions`) | OTEL facade (`@open-mercato/telemetry`) |
|--------|--------------------------------------------------|-------------------------------|------------------------------------------|
| Question answered | *How many / how big* (aggregate counts) | *How developers build* (qualitative sessions) | *Operational health* (spans/metrics/logs) |
| Data shape | Daily aggregate counters | Sanitized session transcripts | Spans, metrics, logs |
| Direction | Install → central | Dev machine → collection instance | App → OTLP backend |
| Consent | Env precedence, off by default | On-disk consent record, off by default | N/A (operational) |
| Reused here | **Enablement-precedence + fail-open patterns** | — | **Ingestion worker emits spans/metrics via the facade** |

The two collection channels are deliberately **separate** (different cadence, payload size, and trust model) but share the precedence and fail-open conventions so behavior is predictable. The ingestion module instruments itself through the OTEL facade rather than rolling its own metrics.

## Data Models

### Wire contract — `CodingSessionUpload` (POST body)

```ts
type CodingSessionUpload = {
  uploadId: string                 // client-generated UUID v4 (idempotency key)
  installId: string                // anonymous, stable per project consent record
  tool: 'claude_code' | 'codex'
  toolVersion: string | null
  contentLevel: 'metadata' | 'redacted-content'
  consentVersion: string           // must satisfy the server's minimum
  redactionVersion: string         // sanitizer ruleset version
  clientSentAt: string             // ISO timestamp
  project: {
    nameHash: string | null        // hashed project name (no absolute path, no real name)
    omVersion: string | null       // Open Mercato version in the project, if resolvable
    gitBranchHash: string | null   // hashed branch name
  }
  session: {
    externalIdHash: string         // hashed agent session id (dedupe without raw id)
    startedAt: string | null
    endedAt: string | null
    eventCount: number
    model: string | null
  }
  sanitizer: {
    secrets: number                // redaction counts by category
    pii: number
    danger: number
    truncations: number
  }
  events: SanitizedEvent[]         // omitted/empty when contentLevel = 'metadata'
}
```

A zod schema for `CodingSessionUpload` lives in `@open-mercato/dev-session-kit` (shared by shipper and ingestion route). Types are derived via `z.infer`.

### DB metadata index — `coding_session_uploads`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `upload_id` | uuid, unique | idempotency key from client |
| `install_id` | text, indexed | anonymous install id |
| `tool` | text | `claude_code` \| `codex` |
| `tool_version` | text null | |
| `content_level` | text | `metadata` \| `redacted-content` |
| `redaction_version` | text | |
| `consent_version` | text | |
| `project_name_hash` | text null | |
| `om_version` | text null | |
| `git_branch_hash` | text null | |
| `session_external_id_hash` | text | |
| `event_count` | int | |
| `blob_path` | text | relative path under storage root |
| `blob_bytes` | int | gzipped size |
| `sanitizer_secrets` | int | from redaction report |
| `sanitizer_pii` | int | |
| `sanitizer_danger` | int | |
| `status` | text | `stored` \| `quarantined` |
| `observed_ip` | text null | server-derived from socket |
| `client_sent_at` | timestamptz null | |
| `received_at` | timestamptz | |
| `organization_id` | uuid | collection instance org |
| `tenant_id` | uuid | collection instance tenant |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | optimistic-lock column (default ON) |
| `deleted_at` | timestamptz null | soft delete |

No raw session text is stored in Postgres — only metadata + the redaction report. The sanitized transcript lives only as a gzipped file under the storage root.

### Local consent record — `.mercato/dev-sessions/consent.json` (developer side)

```json
{
  "enabled": true,
  "installId": "f1e2…",
  "consentVersion": "1",
  "contentLevel": "redacted-content",
  "endpoint": "https://insights.openmercato.com",
  "acceptedAt": "2026-06-15T10:00:00.000Z"
}
```

## API Contracts

### `POST /api/coding_sessions/ingest`

- **Auth:** `Authorization: Bearer <OM_CODING_SESSIONS_INGEST_TOKEN>`. Missing/unknown → `401`.
- **Body:** `CodingSessionUpload` (zod-validated). Malformed → `400`. Over size cap → `413`.
- **Behavior:** derive `observed_ip` from socket; enqueue `coding-session-ingest` keyed by `uploadId` (idempotent); do **not** persist inline.
- **Response:** `202 Accepted` `{ ok: true, uploadId }`. Never blocks on disk/DB.
- **Rate limit:** per-token token-bucket; over limit → `429`.
- **OpenAPI:** route exports `openApi`.

No read endpoints are exposed by the OSS module beyond the feature-gated admin list (metadata only). Bulk export for the commercial dashboard is a separate, authenticated concern in that repo.

## Consent & Privacy Model

- **Off by default, everywhere.** No consent record ⇒ no collection. `.env.example` ships disabled.
- **Informed.** The scaffold prompt and `scripts/dev-sessions/README.md` state exactly what is collected, how it's redacted, and where it goes, before the developer answers.
- **Revocable.** `yarn mercato dev-sessions disable` flips `enabled:false` (and `OM_DEVSESSIONS_DISABLED=true` is a hard kill switch). The shipper checks consent before reading anything.
- **Auditable.** The shipper + sanitizer are dependency-light, in the developer's project, and support `--dry-run` to print the exact sanitized payload.
- **Anonymous.** Only an `installId` UUID; no account, email, or user identity is collected or required. Identifiers in the payload (`project.nameHash`, `gitBranchHash`, `session.externalIdHash`) are hashed.
- **Minimized.** Default `contentLevel: redacted-content`; `metadata` level sends structure only. Dangerous files and secrets are dropped/redacted locally.
- **Defense in depth.** The server re-scans for secrets and quarantines (never exposes) anything that still matches.
- **TLS only.** Uploads go over HTTPS; the shipper refuses non-HTTPS endpoints.

## Phasing / Implementation Plan

### Phase 1 — `@open-mercato/dev-session-kit` (sanitizer + wire types)
- Zod `CodingSessionUpload` schema + `z.infer` types.
- Transcript parsers for Claude Code `.jsonl` and Codex rollout `.jsonl`.
- Redaction pipeline (stages 1–8) with `redactionVersion`.
- `--dry-run` renderer + unit tests with fixture transcripts containing planted secrets/PII (assert all are redacted).

### Phase 2 — Developer-side shipper + hooks (`create-app` assets)
- `scripts/dev-sessions/ship.mjs`, Claude Code `Stop`/`SessionEnd` shim, Codex `notify` shim, README.
- Consent record read/write, detached execution, hard budget, fail-open, spool-and-retry.
- Unit tests for consent gating + fail-open behavior.

### Phase 3 — `create-mercato-app` integration
- `generateDevSessions(config)` generator + `agentic/dev-sessions/` assets wired through `build.mjs`.
- Consent prompt in the wizard; `--dev-sessions` / `--no-dev-sessions` flags; non-interactive default off.
- `.claude/settings.json` hook patch; `.env.example` additions; `.gitignore` spool entry.
- `mercato dev-sessions <enable|disable|status|send>` CLI subcommand.
- Tests: scaffolding with/without consent installs/omits the right files.

### Phase 4 — `coding_sessions` ingestion module
- Module scaffold (entity, migration + snapshot, `acl.ts`, `di.ts`, route, worker).
- `POST /api/coding_sessions/ingest` (token auth, zod, `202`, rate limit, `openApi`).
- `coding-session-ingest` worker: server re-scan → filesystem write → metadata insert → quarantine path → telemetry span.
- Retention worker. Backoffice metadata list page (DataTable, feature-gated, optimistic-lock-compliant).

### Phase 5 — Telemetry wiring + docs
- Emit ingestion spans/metrics through `@open-mercato/telemetry`.
- Docs page under `apps/docs` describing the program, consent, and redaction guarantees; cross-link both telemetry specs.

## Integration Test Coverage

Per repo rules, every new API/UI path needs coverage; tests are self-contained (create + clean up fixtures).

- **API — ingest:** valid token + valid `CodingSessionUpload` → `202` and a job enqueued; missing/invalid token → `401`; malformed body → `400`; oversize → `413`; over rate limit → `429`. (`packages/core/src/modules/coding_sessions/__integration__/ingest.spec.ts`)
- **Worker:** payload with a planted secret → row `status = quarantined`, blob under `quarantine/`, not visible in admin list; clean payload → `status = stored`, blob gzipped on disk, metadata row present.
- **Sanitizer (unit, kit):** fixtures with API keys, private keys, JWTs, emails, IPs, `.env`/`.ssh` reads, absolute home paths → all redacted/dropped; `metadata` level emits no free text; redaction report counts correct.
- **Shipper (unit):** consent absent / `enabled:false` / `OM_DEVSESSIONS_DISABLED=true` → exits 0, reads nothing, uploads nothing; endpoint failure → fail-open exit 0 + spooled blob.
- **create-app (unit):** "yes" installs consent record + shipper + Claude hook + `.env.example`/`.gitignore` entries; "no" / non-interactive installs none of them.
- **Admin UI:** list renders metadata only; feature gate hides it without `coding_sessions.view`.

## Risks & Impact Review

| # | Risk | Severity | Area | Mitigation | Residual |
|---|------|----------|------|------------|----------|
| 1 | Secret leaks through redaction (false negative) | **Critical** | Sanitizer | Drop-on-doubt local redaction + server-side re-scan + quarantine; versioned rules; fixture tests with planted secrets; `--dry-run` audit | Low — a novel secret format could slip both passes; mitigated by quarantine heuristics + retention |
| 2 | Collection without informed consent | **Critical** | Consent | Default off; on-disk consent record required; explicit prompt + README; hard kill switch; revoke command | Low |
| 3 | Endpoint slow/down degrades the agent | High | Shipper | Detached post-session execution, hard time budget, fail-open, spool-once | Very low |
| 4 | Codex `notify` is global, single-program — auto-editing `~/.codex/config.toml` could clobber an existing `notify` | Medium | create-app | Do **not** auto-edit; print the snippet and a wrapper that chains an existing `notify`; document manual step | Low — requires a manual step for Codex |
| 5 | Consent record / installId committed to git | Low | Privacy | `installId` is anonymous (not a secret); document that `consent.json` is safe to commit but `spool/` is gitignored | Low |
| 6 | Ingest token abuse (spam/DoS) | Medium | Ingestion | Bearer token, per-token rate limit, body size cap, `202`-then-async, no read access via write token | Low |
| 7 | PII in code/prompts beyond emails/IPs (e.g. customer names in seed data) | Medium | Sanitizer | `metadata` content level for the cautious; drop file-content snapshots by default; document limits honestly | Medium — perfect free-text PII detection is infeasible; disclosed |
| 8 | Storage growth | Low | Ingestion | gzip blobs, size caps, retention worker, filesystem-first keeps Postgres lean | Low |
| 9 | Cross-tenant exposure on the collection instance | Medium | Module | Single dedicated collection tenant/org; all rows scoped; metadata-only admin; no per-customer data | Low |
| 10 | Future agent-tool schema changes (hook stdin / transcript format) | Low | Shipper | Defensive parsing + fallback resolution of newest transcript; `redactionVersion`/parser version stamped | Low |

## Final Compliance Report

- **Architecture:** No cross-module ORM relationships; module follows the `customers` reference; developer side has no OM runtime coupling. ✅
- **Data & Security:** zod validators with `z.infer`; tenant/org scoping on the collection instance; secrets never logged; TLS-only; defense-in-depth redaction. ✅
- **UI & HTTP:** admin list uses DataTable + `apiCall`; optimistic locking (`updated_at` + `updatedAt` in responses) on the editable entity; no hard-coded strings/status colors; `[internal]`-prefixed internal errors. ✅
- **Backward compatibility:** Net-new package, module, route, env vars, and `create-app` step — additive only. No frozen/stable contract surface changed. New env vars and consent file are additive. ✅
- **Conventions:** module id `coding_sessions` (plural snake_case); route at `/api/coding_sessions/ingest`; event/worker naming per conventions; queue `coding-session-ingest`. ✅
- **Telemetry alignment:** reuses phone-home enablement-precedence + fail-open patterns; instruments via `@open-mercato/telemetry`; separate channel from the aggregate beacon. ✅

## Changelog

- **2026-06-15** — Initial draft. Defines the opt-in coding-agent session collection program: `create-mercato-app` consent prompt + hook installer, local `@open-mercato/dev-session-kit` sanitizer (mandatory PII/secret/dangerous-data redaction before upload), fail-open detached shipper, and the OSS `coding_sessions` ingestion module (token-auth `202` endpoint, async worker with server-side re-scan + quarantine, filesystem-first blob storage + `coding_session_uploads` metadata index, retention, metadata-only admin list). Cross-references the telemetry/OTEL facade and the usage-telemetry phone-home spec; analysis dashboard deferred to a separate commercial repo. Storage and OSS-placement decisions confirmed with the requester.
