> 🗂️ **Reorg 2026-06-26 · Status: NOT STARTED (roadmap overlay).** Build this ON TOP of the implemented Agent Orchestrator. Treat the in-process + OpenCode runtimes, the registry/SDK, the `AgentResult` propose-only contract, disposition/effector, and the data model as already-shipped substrate — align new entities/APIs/events with the live module before implementing. Baseline: `.ai/specs/enterprise/agent-orchestrator/00-IMPLEMENTED-BASELINE.md` · live OpenCode spec: `.ai/specs/2026-06-22-opencode-file-defined-agents.md` · code: `packages/enterprise/src/modules/agent_orchestrator/`.

# Agent Attachments (inputs) & Artifacts (outputs)

> **Status:** Draft · **Owner:** Patryk Lewczuk (Comerito) · **Created:** 2026-06-26
> **Module:** `agent_orchestrator` (enterprise module, `packages/enterprise/src/modules/agent_orchestrator/`) · **subdomain:** `files`
> **Depends:** `attachments` (`packages/core/src/modules/attachments/`), `storage-s3`, OpenCode runtime (`docker/opencode/`, `lib/runtime/openCodeAgentRunner.ts`), file-agent SDK (`lib/sdk/defineFileAgent.ts`), `submit_outcome` MCP tool (`ai-tools.ts`), disposition/effector (`lib/runtime/executeProposal.ts`)
> **Wave-0 overlap (self-contained):** this spec **folds minimal versions of Wave-0 F1 (encrypted `storage-s3` artifact offload) and F5 (`agent_orchestrator/encryption.ts`) into its own Phase 1** rather than waiting on the trace backlog — see `IMPLEMENTATION-TRACE.md` F1/F5. When the broader F1/F5 land, reconcile: this spec's `artifactStore` + `encryption.ts` are the seed, not a parallel copy.
> **Related (roadmap):** dispatch spec (`2026-06-19-agent-dispatch.md`), trace spec (`2026-06-19-agent-trace-eval-capture.md`), context spec (`2026-06-19-agent-context-knowledge-plane.md`)
> **Conventions:** `2026-06-19-agent-orchestrator-conventions.md` is normative — where an entity sketch here conflicts with it, the conventions doc wins.

## TLDR

**Key Points:**
- Give dispatched agents a **bidirectional file plane**: the orchestrator can pass *attachment files in* (staged into the agent's per-run sandbox directory) and the agent can *author artifact files out* (captured back, stored encrypted in `storage-s3`, recorded as `AgentRunArtifact` rows tied to the `AgentRun`).
- This closes the missing file contract. Today inputs are text-only (`openCodeAgentRunner.ts:229-232` `buildMessage()` JSON-stringifies the payload into the prompt) and every native write/edit/bash tool is hard-denied (`defineFileAgent.ts:257-261` → `permission: { write: deny, edit: deny, bash: deny }`), so agents can neither read passed files nor emit files — only structured `submit_outcome` JSON.

**Scope:**
- A **tool-enabled OpenCode runtime tier** (opt-in per file-agent definition) that selectively allows `read`/`write`/`edit` **scoped to an ephemeral per-run sandbox directory only** — never to OM domain state. `bash` stays denied (separate opt-in, out of default scope).
- **Attachment-in staging**: a reserved runtime input envelope binds `attachments`-module object ids to a run; the runner stages each as a raw file plus an optional OCR/text sidecar before the model loop.
- **Artifact-out capture**: a post-run collector scans the sandbox output dir, hashes + uploads new files to `storage-s3` (encrypted at rest), and records `AgentRunArtifact` rows.
- **Artifact promotion**: attaching a captured artifact onto a domain entity is an `actionable` proposal gated by disposition/effector — the agent never self-attaches.
- Operations-UI surfacing (list + download) of run artifacts.

**Concerns:**
- Must not weaken the propose-only invariant: writing scratch files in an isolated sandbox is not a domain mutation, but the **sandbox⟂domain boundary** and **cross-run isolation on a shared OpenCode container** are the load-bearing safety decisions. **Phase 0 resolved** these: isolation is by exclusive single-run container lease + wipe (static permissions can't scope per-run) — see [`…-phase0-findings.md`](./2026-06-26-agent-attachments-and-artifacts-phase0-findings.md).
- File support is structurally **OpenCode-only**; the in-process object-mode runtime has no filesystem and stays text/JSON-only.

## Overview

The Agent Orchestrator runs **propose-only** agents across two runtimes behind one registry and one `AgentRuntimeService.run()` (baseline §2). Agents today exchange only structured JSON: a typed `input` goes in, a validated `AgentResult` (`informative | actionable`) comes out via `submit_outcome`. There is no way to hand an agent a *file* (a scanned claim PDF, a customer-supplied spreadsheet, a product image) nor for an agent to *produce* a file (a generated PDF quote, a reconciled CSV, a rendered report).

This spec adds a **file plane** confined to the OpenCode runtime — the only runtime backed by a real container and filesystem (`docker/opencode/`, `opencode serve` on port 4096). Inputs are staged from the existing `attachments` module into a per-run sandbox; outputs are captured from the sandbox back into governed storage as `AgentRunArtifact` records. Both directions preserve the propose-only contract: the sandbox filesystem is ephemeral and isolated from OM data, and any effect on domain state still flows through `submit_outcome → disposition → effector`.

> **Market Reference**: Studied **OpenAI Assistants API** (file attachments + the Code Interpreter sandbox that emits file outputs by container path), **Anthropic Claude Files API + code-execution container artifacts**, and **Google/Linux-Foundation A2A** (tasks carry typed *artifacts* on completion). **Adopted:** files referenced by *id*, not inlined as bytes/base64; an ephemeral per-run sandbox with a designated output directory; artifacts captured from the filesystem (source of truth) rather than trusted from the model's self-report. **Rejected:** a persistent agent-owned file store and agents writing directly to domain storage — both break OM's "LLM proposes, OM disposes" invariant. Promotion of an artifact onto a domain entity is gated by disposition instead.

## Problem Statement

Real agent use cases are file-shaped, and the orchestrator cannot express them:

- **Inputs.** An insurance/claims or document-processing agent must read a PDF or image the customer uploaded. Today the only path is to pre-extract text into the prompt — there is no contract to pass the file (or even its OCR text) to an OpenCode agent, and the OCR capability that exists in `attachments` (`OcrService`) is not wired to agent inputs.
- **Outputs.** A reporting/quoting agent must *produce* a document (PDF/CSV/XLSX). Today every write tool is denied and the runner never inspects the container filesystem, so an agent can only return JSON. The `AgentRun.outputArtifactKey` column (`entities.ts:121-123`) exists but only offloads the *structured* output payload — it is not a file-artifact channel.
- **Governance gap.** Even if write tools were naively re-enabled, the OpenCode container is a **shared, long-running server** with one working directory: concurrent runs would collide and could read each other's files, and an agent could write outside any sandbox. There is no per-run workspace, no capture pipeline, no tenant-scoped artifact store, and no disposition path to safely land a generated file on a domain record.

## Proposed Solution

Introduce a **tool-enabled OpenCode tier**, opted into per file-agent definition, with three new runtime components and one new entity. Domain side effects remain gated; only sandbox-local file I/O is unlocked.

- **`AgentWorkspaceManager`** — leases a pooled OpenCode container for the run, creates the per-run sandbox directory `<workspaceRoot>/<sessionToken>/{in,out}` on the shared volume, and in the runner's `finally` (`openCodeAgentRunner.ts:213-225`) wipes the subdir and returns the container to the pool (alongside session-token disposal). Isolation is by exclusive lease + wipe (Phase 0 verdict), not per-session permissions; per-session `cwd` is an optional enhancement (unverified) — agents are given absolute sandbox paths.
- **`AttachmentStager`** — resolves the reserved input envelope's attachment ids, enforces tenant/org scope, reads bytes via the `attachments` `StorageDriver` (`driver.read()` / `driver.toLocalPath()`, called through `findOneWithDecryption` for the row), and writes each into `in/` as the raw file plus, when requested and available, a `<name>.txt` OCR sidecar (reusing `Attachment.content` if already extracted, else `OcrService`). The staged local paths are appended to the agent's message so the model knows where to read. **Untrusted-input rule:** staged files are attacker-controllable — they are tagged untrusted, and the sidecar path MUST reuse the existing `OcrService` only; it MUST NOT (re)introduce sunsetted external converter chains (`pdf2pic`/`gm`/Ghostscript) to rasterize PDFs (per `.ai/lessons.md` "Do not rasterize untrusted uploads through sunsetted external converters"). Treating staged content as instructions is the prompt-injection vector that the GUARD prompt-injection overlay (`2026-06-19-agent-runtime-guardrails.md`, **not yet built**) will eventually backstop — until then this is a documented residual mitigated by disposition review.
- **`ArtifactCollector`** — after the run reports an outcome, scans `out/`, computes `sha256` + size, uploads each new file to `storage-s3` (encrypted at rest via `TenantDataEncryptionService`, consistent with `outputArtifactKey`), and writes one `AgentRunArtifact` row per file. The filesystem is authoritative; any `artifacts[]` metadata the agent declared via `submit_outcome` is reconciled (captions matched by path) but never trusted to invent files.
- **`AgentRunArtifact`** — new child entity (`agent_run_artifacts`) recording each captured file (name, mime, size, sha256, storage key, optional caption, promotion link). Tenant/org scoped; soft-deletable for DSAR/erasure.
- **`defineFileAgent` `files` block** — declares the opt-in and is rendered into the OpenCode `.md` frontmatter by `renderOpenCodeAgentFile` (`defineFileAgent.ts:209-280`): when enabled, `permission.write`/`permission.edit` flip to `allow` and `read` is allowed; `bash` stays `deny` unless `files.bash` is explicitly set.
- **Artifact promotion** — a captured artifact stays inert (stored + auditable + downloadable) until an `actionable` proposal of action type `attachments.attach_artifact` is approved; the effector then materializes the artifact into a durable `Attachment` linked to the target `entityId`/`recordId`. The agent never self-attaches.

Reads (`/runs/:id/artifacts`) go through `makeCrudRoute` + indexer; the artifact byte stream mirrors the attachments file route. Capture and promotion are **audited Commands** (mutation-guard contract), consistent with the rest of the module.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| File plane is **OpenCode-only** | In-process object-mode runtime has no container/filesystem (`agentRuntime.ts`); a file contract there would be a different, weaker mechanism. Keeping it OpenCode-only avoids a leaky cross-runtime abstraction. |
| Opt-in lives on the **file-agent definition**, not a binding entity | `AgentBinding`/`AgentTask` do not exist in code yet (dispatch spec is roadmap). The live opt-in surface is `defineFileAgent` → frontmatter, mirroring the existing tool allowlist (`defineFileAgent.ts:232-263`). When dispatch lands, an `AgentTask` may *additionally* carry per-task attachment refs without changing this contract. |
| Inputs are **attachment object ids only** (raw + optional OCR sidecar) | Reuses the attachments module's storage routing, RBAC, lifecycle, and OCR. Arbitrary S3 keys / inline blobs would bypass that governance. |
| Capture is **filesystem-authoritative**, agent metadata advisory | An agent self-reporting its outputs could under/over-claim. Scanning `out/` makes capture deterministic and prevents trusting model output for security-relevant state. |
| Write/edit allowed **only in the per-run sandbox**; `bash` off by default | Scratch-file authoring is not a domain mutation, so it does not break propose-only. `bash` is a large blast-radius jump (arbitrary subprocess) and is gated behind a separate explicit `files.bash` opt-in. |
| Promotion onto a domain entity is an **actionable proposal** | Preserves "LLM proposes, OM disposes": a generated file touches a customer/order record only after disposition approval + an audited effector command. |
| New **`AgentRunArtifact`** child table vs. reusing `outputArtifactKey` | A run can emit many files; `outputArtifactKey` already means "offloaded structured output payload" (`entities.ts:121-123`). Overloading it would conflate two concerns and cap at one file. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Re-enable write tools globally on all OpenCode agents | Breaks the propose-only guarantee for every existing agent; no sandbox, no capture, no isolation. Opt-in tier is the safe subset. |
| Inline file bytes (base64) in the prompt/outcome | Blows the context window, bypasses attachments governance, and provides no durable, downloadable artifact record. |
| Agent declares artifacts in `submit_outcome` as the source of truth | Trusts model output for security-relevant state; an injected prompt could fabricate or hide files. Filesystem scan is authoritative. |
| Capture artifacts directly into the `attachments` module on the agent's behalf | Would let an agent write to domain storage pre-disposition. Artifacts live in an inert orchestrator-owned store first; promotion to `Attachment` is gated. |
| Per-run ephemeral OpenCode container (full isolation) | Stronger isolation but a heavy operational change to the shared `opencode serve` model. Recorded as Phase 4 hardening; Phase 0 verifies per-session-dir scoping is sufficient for v1. |

## User Stories / Use Cases

- **A claims-processing agent** wants to **read the customer's uploaded damage PDF** so that **it can propose a damage estimate grounded in the document** (input staging + OCR sidecar).
- **A sales agent** wants to **generate a branded PDF quote file** so that **an operator can review and attach it to the order** (artifact capture → promotion proposal).
- **An operator** wants to **download every file an agent produced for a run** so that **they can audit what the agent generated before approving** (operations UI list + download).
- **A compliance officer** wants **agent-produced files stored encrypted and erasable per tenant** so that **DSAR/erasure obligations are met** (encrypted storage + soft-delete).

## Architecture

```
 dispatch / workflow ── run input (business schema) + reserved __files envelope
        │                          { attachments: [{ attachmentId, as?, ocrText? }] }
        ▼
 OpenCodeAgentRunner.run()  (openCodeAgentRunner.ts:109)
        │  1. create OpenCode session  ── cwd = sandbox  ◀── AgentWorkspaceManager.create(sessionToken)
        │  2. mint session token + AgentRunSession (existing)
        │  3. stage inputs            ◀── AttachmentStager → <sandbox>/in/<file>(+ .txt sidecar)
        │  4. buildMessage(): auth header + input + "staged files: <paths>"
        │  5. driveSession(): model loop; agent reads in/, writes out/
        │        └─ submit_outcome (MCP) → outcome [+ advisory artifacts[]]
        │  6. capture outputs         ──▶ ArtifactCollector.scan(<sandbox>/out)
        │        └─ hash + upload (storage-s3, encrypted) → AgentRunArtifact rows
        │           emit agent_orchestrator.artifact.captured
        │  7. finally: dispose token + revoke key + AgentWorkspaceManager.destroy()
        ▼
 AgentResult ──▶ AgentRun (output, outputArtifactKey)  +  AgentRunArtifact[] (files)
        │
   if actionable & action = attachments.attach_artifact
        ▼
 AgentProposal (disposition: pending) ── DispositionService gate ──▶ effector
        └─ effector reads artifact from storage-s3, writes a durable Attachment
           (entityId/recordId), sets AgentRunArtifact.promotedAttachmentId
           emit agent_orchestrator.artifact.promoted
```

- **Sandbox ⟂ domain.** The sandbox holds only what was staged into `in/` plus what the agent wrote to `out/`. The agent cannot reach OM data through the filesystem; domain effects require disposition.
- **Isolation by exclusivity (Phase 0 verdict).** Permission config is static, so it can't encode a per-run path. Instead a run **leases a pooled OpenCode container exclusively** for its lifetime; its `<sessionToken>/{in,out}` subdir under the shared-volume workspace root is **wiped before the container returns to the pool**. A static path-glob (`write/edit/read: { "<workspaceRoot>/**": allow, "*": deny }`) additionally confines the agent away from OpenCode internals. Stronger isolation = per-run ephemeral container (Phase 4).
- **Shared volume.** OM and the OpenCode container don't share a filesystem by default; `AgentWorkspaceManager`/stager/collector operate on a bind-mounted workspace root writable by both.
- **Capture is idempotent.** Re-running capture for the same run reconciles by `(run_id, sha256, file_name)`; the runner is at-least-once safe.
- **`AgentResult` is unchanged.** The frozen `agentResultSchema` (`informative | actionable`) is **not** extended; artifacts are persisted as separate `AgentRunArtifact` rows linked by `runId` and surfaced via the list API. "Returned alongside the result" means *correlated by run*, not carried inside the result union — this keeps the propose-only result contract a frozen surface (BC).
- **Two distinct stores.** Captured artifact **bytes live in the orchestrator's `storage-s3`** (inert, encrypted, referenced by `AgentRunArtifact.storageKey`) — *not* in the `attachments` module. Only on approved **promotion** does the effector materialize a durable `Attachment` via the attachments module's pluggable `StorageDriver.store` (default driver `local`, partition-routed — a different store from `storage-s3`). Capturing ≠ attaching.

### Commands & Events

- **Command**: `agent_orchestrator.artifact.capture` (audited; writes `AgentRunArtifact` rows) — internal, runner-invoked. **Undo**: soft-delete the captured rows (`deleted_at`) and best-effort GC the `storage-s3` objects; `extractUndoPayload` carries the row ids + storage keys (`packages/shared/src/lib/commands/undo.ts`).
- **Command**: `agent_orchestrator.artifact.promote` (audited; effector creates `Attachment`, sets `promotedAttachmentId`). **Undo**: soft-delete the created `Attachment` and clear `promotedAttachmentId`; undo payload carries both ids. Optimistic-locked on the `AgentRunArtifact` row (re-promotion must not duplicate).
- **Event**: `agent_orchestrator.artifact.captured` — entity `artifact`, category `lifecycle`, `clientBroadcast: true`.
- **Event**: `agent_orchestrator.artifact.promoted` — entity `artifact`, category `lifecycle`, `clientBroadcast: true`.

All commands are declared with `createModuleEvents()` (`as const`) and route writes through the mutation-guard contract. The OpenCode sandbox `write`/`edit` tools are **filesystem tools, not OM AI mutation tools** — they never touch domain state and therefore do not (and must not) bypass the `prepareMutation` / `isMutation` approval flow; every domain effect still goes `submit_outcome → disposition → effector` (BC #12).

## Data Models

Follows the conventions doc: MikroORM v7 `/legacy` decorators, `tenant_id` **and** `organization_id` on every row (filter by `organization_id`), UUID PK `defaultRaw 'gen_random_uuid()'`, JSON→`jsonb` (shape enforced by Zod in `data/validators.ts`), enums→`varchar` + TS union, no cross-module ORM relations (FK ids only).

### `AgentRunArtifact` (`agent_run_artifacts`) — append-only, erasable

One row per file an agent produced in a run. Append-only (immutable after capture) so it omits `updated_at`; it keeps `deleted_at` for DSAR/erasure (cross-ref the retention/erasure gap, GAP-19/GAP-12).

```typescript
import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

export type AgentRunArtifactSource = 'agent_output' // future: 'tool_output'

@Entity({ tableName: 'agent_run_artifacts' })
@Index({ name: 'agent_run_artifacts_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'agent_run_artifacts_run_idx', properties: ['organizationId', 'runId'] })
@Index({ name: 'agent_run_artifacts_run_sha_uq', properties: ['runId', 'sha256', 'fileName'], options: { unique: true } })
export class AgentRunArtifact {
  [OptionalProps]?: 'source' | 'caption' | 'promotedAttachmentId' | 'createdAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'run_id', type: 'uuid' })
  runId!: string // FK id → agent_runs; NOT an ORM relation

  @Property({ name: 'file_name', type: 'varchar', length: 255 })
  fileName!: string // sanitized basename produced by the agent (no path segments)

  @Property({ name: 'mime_type', type: 'varchar', length: 150 })
  mimeType!: string

  @Property({ name: 'file_size', type: 'int' })
  fileSize!: number // bytes

  @Property({ name: 'sha256', type: 'varchar', length: 64 })
  sha256!: string

  @Property({ name: 'storage_key', type: 'varchar', length: 500 })
  storageKey!: string // storage-s3 object key; bytes encrypted at rest

  @Property({ name: 'caption', type: 'text', nullable: true })
  caption?: string | null // agent-supplied description; encrypted (may reference people)

  @Property({ name: 'source', type: 'varchar', length: 20, default: 'agent_output' })
  source: AgentRunArtifactSource = 'agent_output'

  @Property({ name: 'promoted_attachment_id', type: 'uuid', nullable: true })
  promotedAttachmentId?: string | null // set when an attach_artifact proposal is approved

  @Property({ name: 'created_at', type: Date, defaultRaw: 'now()' })
  createdAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
```

**Encryption.** Artifact **bytes** are stored in `storage-s3` encrypted at rest via `TenantDataEncryptionService` (same path as `AgentRun.outputArtifactKey`). The free-text `caption` is encrypted at the DB layer — declare it in `agent_orchestrator/encryption.ts` `defaultEncryptionMaps` and read via `findWithDecryption`. `file_name` is agent-controlled and sanitized to a capped basename (no directory separators); it is treated as non-sensitive metadata.

### Reserved runtime input envelope (`__files`)

Attachment inputs are carried in a reserved key **outside** the agent's business `input` schema, so an agent's typed contract stays clean. The runner extracts it before `buildMessage` and never forwards it as business data.

```typescript
// lib/runtime/fileInput.ts
export const agentFileInputSchema = z.object({
  attachments: z.array(z.object({
    attachmentId: z.string().uuid(),
    as: z.string().max(255).optional(),       // override staged filename
    ocrText: z.boolean().optional(),          // also stage a <name>.txt sidecar
  })).max(20),
}).strict()
export type AgentFileInput = z.infer<typeof agentFileInputSchema>
// Reserved envelope key on the run input: input.__files?: AgentFileInput
```

### `defineFileAgent` `files` block (SDK additive)

```typescript
// lib/sdk/defineFileAgent.ts — additive optional block
files?: {
  enabled: true        // opt into the tool-enabled tier (write/edit/read in sandbox)
  inputs?: boolean     // accept staged attachments (default true when enabled)
  outputs?: boolean    // capture artifacts from out/ (default true when enabled)
  bash?: boolean       // allow bash in sandbox (default false; large blast radius)
}
```

`renderOpenCodeAgentFile` (`defineFileAgent.ts:209-280`) emits, when `files.enabled`, a **static path-glob** scoped to the workspace root (the glob form is confirmed in Phase 0; it cannot carry a per-run token — run isolation is by container lease, not this glob):

```yaml
permission:
  write: { "/home/opencode/work/**": allow, "*": deny }   # was: deny
  edit:  { "/home/opencode/work/**": allow, "*": deny }   # was: deny
  read:  { "/home/opencode/work/**": allow, "*": deny }   # staged inputs
  bash: deny                                               # unless files.bash === true
tools:
  "read": true   # plus the existing submit_outcome / skill tool allowlist
```

The workspace-root literal mirrors `OM_OPENCODE_WORKSPACE_ROOT`; keep the frontmatter value and the env in sync (or template it at generate time).

## API Contracts

### List run artifacts
- `GET /api/agent_orchestrator/runs/:runId/artifacts` — `makeCrudRoute` + indexer; org-scoped; guarded by the same ACL feature that gates `AgentRun` reads (`acl.ts`). Exports `openApi`.
- Response: `{ items: Array<{ id, fileName, mimeType, fileSize, sha256, caption, source, promotedAttachmentId, createdAt }> }` (no bytes).

### Download an artifact
- `GET /api/agent_orchestrator/artifacts/file/:id?download=1` — streams decrypted bytes from `storage-s3`; org-scoped; mirrors `attachments` file route (`buildAttachmentFileUrl` pattern, `imageUrls.ts:54-59`). Sets `Content-Type` from `mimeType`, `Content-Disposition: attachment` when `download=1`.

### `submit_outcome` MCP tool — additive field
Extend the input schema (`ai-tools.ts:89-95`) additively; existing single-`outcome` callers stay valid:
```typescript
const submitOutcomeInput = z.object({
  outcome: z.unknown(),
  artifacts: z.array(z.object({
    path: z.string().max(255),    // relative to out/
    caption: z.string().max(500).optional(),
  })).max(20).optional(),         // advisory captions; capture reconciles vs filesystem
})
```

### Artifact promotion (proposed action)
- New action type `attachments.attach_artifact` in the agent proposal envelope: `{ artifactId, entityId, recordId, fileName? }`. Validated by Zod in `data/validators.ts`; applied by the effector only after disposition approval.

## Internationalization (i18n)
Keys under `agent_orchestrator.*` (client `useT()`, server `resolveTranslations()`):
- `agent_orchestrator.artifacts.title`, `.empty`, `.download`, `.captured`, `.promote`, `.promoted`, `.size`, `.captureFailed`
- Internal-only `throw`/`toast` messages prefixed `[internal]` per the i18n hardcoded-string rule.

## UI/UX
- **Run detail → Artifacts panel** (operations UI): a `DataTable` of captured artifacts (file name, type, size, captured-at, caption, promoted badge) with a per-row **Download** action (icon-only button → `aria-label`) and, for actionable runs, a **Promote** row action that opens the disposition flow. Use shared primitives (`DataTable`, `StatusBadge` for promoted/inert, `EmptyState`, `LoadingMessage`); semantic tokens only; dialog `Cmd/Ctrl+Enter` submit / `Escape` cancel. No hardcoded status colors or arbitrary text sizes.

## Configuration
- `OM_OPENCODE_FILES_ENABLED` (default `false`) — global kill-switch; when off, the `files` block is ignored and frontmatter renders deny (current behavior). Belt-and-suspenders over the per-agent opt-in.
- `OM_OPENCODE_WORKSPACE_ROOT` (default `/home/opencode/work`) — sandbox root; **bind-mounted as a shared volume** writable by both the OM runtime and the OpenCode container (Phase 0 F5). Must match the static path-glob in the generated frontmatter.
- `OM_OPENCODE_POOL_SIZE` (default `1`) — number of pooled OpenCode containers available for exclusive single-run leases (Phase 0 isolation model). `1` serializes tool-enabled runs; raise for concurrency.
- `OM_OPENCODE_LEASE_TIMEOUT_MS` (default = run wall-clock cap, 5 min) — max hold before a leased container is force-reclaimed + wiped.
- `OM_AGENT_ARTIFACT_MAX_BYTES` (default `26214400` = 25 MiB) and `OM_AGENT_ARTIFACT_MAX_COUNT` (default `20`) — per-run caps; over-cap files are skipped and logged (no silent truncation).
- Reuses existing OCR config (`OPENAI_API_KEY`, model) via `attachments` `OcrService` (`ocrService.ts:65-77`).

## Migration & Compatibility
- **DB migration**: create `agent_run_artifacts` (+ indexes) under `agent_orchestrator/data/migrations/`; update the module `.snapshot-open-mercato.json`. No change to existing tables.
- **Backward compatible**: the `files` block is additive and defaults off; existing OpenCode agents render identical deny frontmatter. `submit_outcome.artifacts` is optional; the in-process runtime is untouched. New events are additive (events are ADDITIVE-ONLY per `BACKWARD_COMPATIBILITY.md`). New ACL feature(s) for artifact view/download are additive grants — sync to roles in `setup.ts`.
- **Docker**: `docker/opencode/entrypoint.sh` generates `permission` per-agent from frontmatter; verify the generated `opencode.jsonc` does not globally re-deny `write`/`edit` for tool-enabled agents (Phase 0).

## Implementation Plan

### Phase 0: De-risk OpenCode sandboxing — **DONE** (see [`…-phase0-findings.md`](./2026-06-26-agent-attachments-and-artifacts-phase0-findings.md))

**Verdict:** per-session write-isolation via permissions on the shared container is **not achievable** — OpenCode permission config is **static** (baked frontmatter + entrypoint `opencode.jsonc`), so a glob cannot carry the per-run `sessionToken`. Path-glob `write`/`edit` scoping **is** confirmed (`opencode.jsonc.example:28-52`) but only confines writes to a shared workspace root, not run-from-run. Therefore **isolation comes from container exclusivity, not permissions.** Chosen v1 model:
1. **Shared volume** at `OM_OPENCODE_WORKSPACE_ROOT` (default `/home/opencode/work`), writable by both the OM runtime and the OpenCode container (they don't share a filesystem by default).
2. **Single-run container lease** — a run holds a pooled OpenCode container exclusively for its lifetime; its `<sessionToken>/{in,out}` subdir is **wiped before the container returns to the pool**. Exclusivity + wipe = isolation.
3. **Static path-glob confinement** — `write`/`edit`/`read` = `{ "<workspaceRoot>/**": allow, "*": deny }` so the agent can't escape to OpenCode internals; `bash` stays `deny`.
4. **Absolute sandbox paths** in `buildMessage` (per-session `cwd` is unverified — see verification items).

**Carry into Phase 1 (verify against the running v1.1.21 image):** (a) does `POST /session` honor a `directory`/`cwd` (`pwd` test — would unlock relative paths); (b) `permission.write` glob precedence (allow-subtree overrides deny-`*`); (c) any per-session permission override (would relax the exclusivity requirement). **Escalation:** per-run ephemeral container (Phase 4) if pool-lease + wipe proves insufficient.

### Phase 1: Artifact-out capture
0. **Minimal F5 + F1 substrate (folded in, self-contained):**
   - Create `agent_orchestrator/encryption.ts` exporting `defaultEncryptionMaps` (seed entry: `AgentRunArtifact.caption`; type from `@open-mercato/shared/modules/encryption`). This is the module's first `encryption.ts` — when the broader Wave-0 F5 lands (maps for `AgentRun.input/output`, proposal payloads, etc.) it extends this file, not a parallel one.
   - Create `lib/runtime/artifactStore.ts` — a thin `storage-s3` put/get wrapper (encrypted at rest via `TenantDataEncryptionService`), the seed of Wave-0 F1. Degrades to an explicit `captureFailed` when `storage-s3` is absent (no silent inline fallback for bytes).
1. Add `AgentRunArtifact` entity + migration + snapshot; wire `caption` reads through `findWithDecryption`.
2. Add `AgentWorkspaceManager` (create/destroy per-run sandbox keyed by `sessionToken`); wire create after token mint and destroy in the runner `finally` (`openCodeAgentRunner.ts:138-148`, `:213-225`). **Sandbox model is gated on the Phase-0 isolation verdict** (cwd-per-session vs path-glob permission vs ephemeral container).
3. Add `files` block to `defineFileAgent` + render frontmatter (`write/edit/read` allow when enabled; `bash` gated); honor `OM_OPENCODE_FILES_ENABLED`.
4. Add `ArtifactCollector` (scan `out/`, sha256 + size, cap enforcement, upload encrypted to `storage-s3`, upsert rows via the audited `agent_orchestrator.artifact.capture` command); emit `agent_orchestrator.artifact.captured`.
5. Extend `submit_outcome` input with optional `artifacts[]`; reconcile captions in the collector (filesystem authoritative).
6. Operations UI: Artifacts panel (list + download route + ACL feature).
7. Tests: unit (collector hashing/caps/reconcile, frontmatter render), integration (tool-enabled agent writes a file → `AgentRunArtifact` row + downloadable bytes), isolation test (run A cannot capture run B's files).

### Phase 2: Attachment-in staging
1. Add `agentFileInputSchema` + reserved `__files` extraction in the runner (before `buildMessage`).
2. Add `AttachmentStager` (resolve attachment, strict tenant/org check, `StorageDriver.read`/`toLocalPath`, write to `in/`, OCR sidecar via `Attachment.content` or `OcrService`).
3. Append staged paths to the agent message (`buildMessage`, `openCodeAgentRunner.ts:229-232`); allow `read`.
4. Tests: unit (stager tenant-scope rejection, OCR sidecar), integration (agent reads staged PDF text and proposes grounded output).

### Phase 3: Artifact promotion via disposition
1. Add `attachments.attach_artifact` proposed-action type + Zod validator.
2. Add effector: read artifact bytes from `storage-s3`, create a durable `Attachment` (`entityId`/`recordId`, via attachments `StorageDriver.store`), set `promotedAttachmentId`; emit `agent_orchestrator.artifact.promoted`. Audited `agent_orchestrator.artifact.promote` command + optimistic lock on the artifact row.
3. UI: Promote row action → disposition flow.
4. Tests: integration (actionable run proposing attach → approve → `Attachment` created + linked; reject → no attachment).

### Phase 4 (optional): Hardening
1. `files.bash` opt-in tier + per-binding capability flag once dispatch/`AgentBinding` lands.
2. Per-run ephemeral container option for strong isolation.
3. Retention/erasure: wire `AgentRunArtifact` + storage-s3 objects into the DSAR/erasure and retention sweeps (GAP-12/GAP-19).

### File Manifest
| File | Action | Purpose |
|------|--------|---------|
| `…/agent_orchestrator/data/entities.ts` | Modify | Add `AgentRunArtifact` |
| `…/agent_orchestrator/data/migrations/*` + `.snapshot-open-mercato.json` | Create/Modify | Table + indexes |
| `…/agent_orchestrator/encryption.ts` | Create | First module `encryption.ts`; seed map for `AgentRunArtifact.caption` (minimal F5) |
| `…/agent_orchestrator/lib/runtime/artifactStore.ts` | Create | Encrypted `storage-s3` put/get for artifact bytes (minimal F1) |
| `…/agent_orchestrator/lib/runtime/agentWorkspaceManager.ts` | Create | Per-run sandbox lifecycle |
| `…/agent_orchestrator/lib/runtime/artifactCollector.ts` | Create | Scan/hash/upload/record |
| `…/agent_orchestrator/lib/runtime/attachmentStager.ts` | Create | Stage inputs + OCR sidecar |
| `…/agent_orchestrator/lib/runtime/fileInput.ts` | Create | `__files` envelope schema |
| `…/agent_orchestrator/lib/runtime/openCodeAgentRunner.ts` | Modify | Wire workspace + stage + capture into `run()` |
| `…/agent_orchestrator/lib/sdk/defineFileAgent.ts` | Modify | `files` block + frontmatter render |
| `…/agent_orchestrator/ai-tools.ts` | Modify | `submit_outcome.artifacts` |
| `…/agent_orchestrator/data/validators.ts` | Modify | `attach_artifact` action |
| `…/agent_orchestrator/lib/runtime/executeProposal.ts` (or effectors) | Modify | Promotion effector |
| `…/agent_orchestrator/api/runs/[runId]/artifacts/route.ts` | Create | List endpoint |
| `…/agent_orchestrator/api/artifacts/file/[id]/route.ts` | Create | Download endpoint |
| `…/agent_orchestrator/events.ts`, `acl.ts`, `setup.ts` | Modify | Events + ACL feature + role sync |
| operations UI run-detail | Modify | Artifacts panel |

### Testing Strategy
- **Unit**: collector (hash, caps, reconcile, sanitize file name), stager (tenant rejection, OCR sidecar selection), frontmatter render (deny↔allow by `files`), `__files` extraction, artifactStore encrypt/decrypt round-trip, undo payloads (capture soft-delete, promote reversal).
- **Integration** (self-contained, API fixtures, teardown; per `.ai/qa/AGENTS.md`) — per-path matrix:

| Path | Scenario | Test |
|------|----------|------|
| `GET /api/agent_orchestrator/runs/:runId/artifacts` | tool-enabled run writes a file → row listed, org-scoped | `TC-AGENT-FILES-001` |
| `GET /api/agent_orchestrator/artifacts/file/:id` | download returns decrypted bytes; cross-org request 404s | `TC-AGENT-FILES-002` |
| runner capture | run A cannot capture run B's sandbox files (isolation) | `TC-AGENT-FILES-003` |
| `__files` staging | agent reads staged PDF/OCR sidecar → grounded proposal; wrong-tenant attachment rejected | `TC-AGENT-FILES-004` |
| `attach_artifact` + disposition | approve → `Attachment` created & linked + `promotedAttachmentId` set; reject → no attachment; undo reverses | `TC-AGENT-FILES-005` |
| operations UI artifacts panel | list + download + promote row action render and act | `TC-AGENT-FILES-006` |

## Risks & Impact Review

### Data Integrity Failures
- Crash mid-run: sandbox is ephemeral; `finally` destroys it. Capture runs only after a successful outcome; a partial `out/` is discarded with the sandbox. Re-capture is idempotent via the `(run_id, sha256, file_name)` unique index.
- Concurrent edits: `AgentRunArtifact` is append-only; promotion mutates `promotedAttachmentId` under optimistic lock.

### Cascading Failures & Side Effects
- `storage-s3` unavailable at capture: the run still completes with its JSON outcome; capture failure is logged and emits no `captured` event (degrade, don't fail the proposal). Artifacts can be re-collected from… no — sandbox is gone; so capture failure means artifacts are lost. Mitigation: capture **before** sandbox teardown and surface a `captureFailed` status on the run; do not silently claim success.
- OCR (`OpenAI`) down: sidecar is skipped; raw file is still staged; `OcrService.available` already guards this.

### Tenant & Data Isolation Risks
- Cross-run file leakage on the shared container is the primary risk — mitigated by per-`sessionToken` sandbox dirs and Phase 0 verification; escalation path is per-run ephemeral containers (Phase 4).
- Staging a wrong-tenant attachment: the stager enforces `organizationId`/`tenantId` equality against the run context before reading bytes; mismatch rejects the run.
- Artifact store growth (noisy neighbor): per-run byte/count caps + retention sweep.

### Migration & Deployment Risks
- Additive table + additive frontmatter + default-off flag → zero-downtime, no backfill. Rollback = stop opting agents in; existing rows are inert.

### Operational Risks
- Storage growth from artifacts at scale: bounded by caps + retention (Phase 4); monitor `agent_run_artifacts` row/byte growth per tenant.
- Blast radius: confined to OpenCode tool-enabled agents; in-process agents and all existing OpenCode agents are unaffected.

### Risk Register

#### Cross-run sandbox leakage on shared container
- **Scenario**: Two concurrent tool-enabled runs share the `opencode serve` container; run A reads or overwrites run B's staged inputs or outputs.
- **Severity**: High
- **Affected area**: OpenCode runtime, tenant isolation, artifact integrity.
- **Mitigation** (Phase 0 resolved): static permission config cannot scope per-run, so isolation is by **exclusive single-run container lease + subdir wipe before return to pool** (`OM_OPENCODE_POOL_SIZE`, default `1` = serialized). A static workspace-root path-glob additionally confines writes away from OpenCode internals. Capture reads only the leased run's own subdir.
- **Residual risk**: With `POOL_SIZE > 1`, isolation depends on the lease wipe being reliable (force-reclaim on `OM_OPENCODE_LEASE_TIMEOUT_MS`); a wipe failure could expose a prior run's subdir to the next lessee. Escalation to per-run ephemeral containers (Phase 4) removes this entirely. Tracked verification: confirm allow-subtree glob precedence on v1.1.21.

#### Propose-only erosion via write tools
- **Scenario**: Re-enabling `write`/`edit` lets an agent mutate state it shouldn't.
- **Severity**: Medium
- **Affected area**: Propose-only invariant.
- **Mitigation**: Writes are confined to the ephemeral sandbox (discarded post-run); no OM data is mounted; domain effects still require `submit_outcome → disposition → effector`; `bash` off by default.
- **Residual risk**: A `files.bash` opt-in widens this; gated, documented, off by default.

#### Prompt-injection drives artifact exfiltration / mis-promotion
- **Scenario**: A malicious staged document instructs the agent to write sensitive context into an artifact or propose attaching it to the wrong record.
- **Severity**: Medium
- **Affected area**: Data confidentiality, attachments.
- **Mitigation**: An artifact can only contain what the agent was given (its staged inputs + governed context); promotion to a domain entity is disposition-gated and human-reviewable; captured artifacts are visible in the operations UI before approval.
- **Residual risk**: Within-tenant over-sharing into a downloadable artifact remains possible; bounded by reviewer inspection and tenant scope.

#### Capture loss on storage failure
- **Scenario**: `storage-s3` write fails; sandbox is then destroyed, losing the only copy.
- **Severity**: Medium
- **Affected area**: Artifact durability.
- **Mitigation**: Capture executes before teardown; on failure the run is marked `captureFailed` and the event is withheld (no false success); retry within the same run before `finally`.
- **Residual risk**: Hard storage outage means artifacts are not retained; acceptable (structured outcome still persists).

## Final Compliance Report — 2026-06-26

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/enterprise/src/modules/agent_orchestrator/AGENTS.md` (+ baseline + conventions doc)
- `packages/core/AGENTS.md` (Encryption, API Routes, Events, Custom Fields)
- `packages/core/src/modules/attachments/` (entity/driver/OCR surface)
- `packages/ui/AGENTS.md` (DataTable, dialogs, DS)
- `BACKWARD_COMPATIBILITY.md` (events/ACL/DB additive)

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | `runId`/`promotedAttachmentId` are FK ids; no relations |
| root AGENTS.md | Filter by `organization_id` | Compliant | All artifact reads/writes org-scoped; stager rejects cross-tenant |
| root AGENTS.md | Singular naming (entity/event/command) | Compliant | `artifact` entity; `agent_orchestrator.artifact.captured/promoted` |
| core AGENTS.md | Encryption maps for sensitive columns | Compliant | `caption` in `defaultEncryptionMaps`; bytes encrypted in storage-s3 |
| core AGENTS.md | API routes export `openApi`; use `makeCrudRoute` | Compliant | List via `makeCrudRoute`; download mirrors attachments file route |
| core AGENTS.md | Zod validators in `data/validators.ts` | Compliant | `__files`, `submit_outcome.artifacts`, `attach_artifact` |
| AGENTS.md | Propose-only / LLM proposes, OM disposes | Compliant | Sandbox writes only; promotion gated by disposition + effector |
| BACKWARD_COMPATIBILITY.md | Events/ACL/DB additive-only | Compliant | New table, new events, new ACL grants; no removals |
| ui AGENTS.md / ds-rules | Shared primitives, semantic tokens, dialog keys | Compliant | DataTable/EmptyState/StatusBadge; tokens only |
| AGENTS.md | Optimistic locking on editable mutations | Compliant | Promotion mutation locks the artifact row; capture is append-only |

### Internal Consistency Check
| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | List/download fields map to `AgentRunArtifact` |
| API contracts match UI/UX | Pass | Panel consumes list + download + promote |
| Risks cover all write operations | Pass | Capture, promotion, staging covered |
| Commands defined for all mutations | Pass | `artifact.capture`, `artifact.promote` |
| Events additive + documented | Pass | `captured`, `promoted` |

### Non-Compliant Items
None at design time. Phase 0 isolation verdict is a hard gate: if OpenCode cannot scope sandbox writes, Phases 1–3 must adopt the Phase 4 ephemeral-container model before shipping the tool-enabled tier.

### Verdict
- **Fully compliant** (design) — ready for implementation, gated on the Phase 0 isolation finding.

## Changelog
### 2026-06-26
- Initial specification (decisions: OpenCode-only file plane; `read/write/edit` scoped sandbox, `bash` off by default; attachment-id inputs with raw + OCR sidecar; new `AgentRunArtifact` child table; artifact promotion gated by disposition).
- Pre-implement revisions (post `om-pre-implement-spec`, analysis `ANALYSIS-2026-06-26-agent-attachments-and-artifacts.md`): folded minimal Wave-0 **F1** (`artifactStore.ts`) + **F5** (`encryption.ts`) into Phase 1 so the spec is self-contained; added **undo contracts** for `artifact.capture`/`artifact.promote`; clarified **`AgentResult` is unchanged** (artifacts are separate rows); documented the **two distinct stores** (orchestrator `storage-s3` vs attachments `StorageDriver`); added the **untrusted-input / no-converter-chain** rule + GUARD residual; added a **per-path integration test matrix**.
- **Phase 0 resolved** ([`…-phase0-findings.md`](./2026-06-26-agent-attachments-and-artifacts-phase0-findings.md)): path-glob `write`/`edit` permission is confirmed but **static** (can't carry a per-run token), so cross-run isolation is by **exclusive single-run container lease + subdir wipe** (`OM_OPENCODE_POOL_SIZE`/`OM_OPENCODE_LEASE_TIMEOUT_MS`) over a **shared-volume** workspace, with a static workspace-root glob confining writes from OpenCode internals; per-session `cwd` is an unverified enhancement; per-run ephemeral containers are the Phase-4 escalation. Updated Phase 0, Architecture, `AgentWorkspaceManager`, frontmatter render, Configuration, and the cross-run risk entry accordingly.
