# Pre-Implementation Analysis: Agent Attachments (inputs) & Artifacts (outputs)

> **Spec:** `.ai/specs/enterprise/agent-orchestrator/next/2026-06-26-agent-attachments-and-artifacts.md`
> **Analyzed:** 2026-06-26 · **Branch:** `feat/agent-orchestrator-mvp` · Analysis only — no code or spec modified.

## Executive Summary

The spec is well-structured, additive across all 13 backward-compatibility surfaces, and reuses real, code-verified seams (`attachments` `StorageDriver`/`OcrService`, the OpenCode runner, `defineFileAgent` frontmatter, `submit_outcome` MCP tool). It is **not yet ready to start coding** for two reasons, both already half-acknowledged in the spec: **(1)** the whole write-scoping model rests on an *unverified* assumption that the shared `opencode serve` container supports a per-session working directory + path-scoped write permission — this is the Phase 0 gate and is a hard blocker; **(2)** it depends on two Wave-0 items that are **not built yet** — `encryption.ts` (F5, for the encrypted `caption` + artifact bytes) and the `storage-s3` artifact store (F1, columns exist but unpopulated). Resolve the Phase-0 verdict and sequence after/with F5+F1, add an undo contract for promotion, and pin the ACL id — then it is ready.

**Recommendation: Needs spec updates first (minor) + a Phase-0 spike before implementation.**

## Backward Compatibility

### Violations Found
| # | Surface | Issue | Severity | Proposed Fix |
|---|---------|-------|----------|-------------|
| — | (none) | All changes are additive: new entity/table, new events, new ACL feature(s), new API routes, new DI services, optional SDK field, optional MCP input field | — | No deprecation bridge required |

Surface-by-surface verdict (all **PASS / additive**):

| # | Surface | Spec change | Verdict |
|---|---------|-------------|---------|
| 1 | Auto-discovery files | New API route files; new `lib/runtime/*` files | ✅ additive |
| 2 | Types & interfaces | `defineFileAgent` input gains optional `files` block; `submit_outcome` input gains optional `artifacts` | ✅ additive (optional fields) |
| 3 | Function signatures | `defineFileAgent`/`renderOpenCodeAgentFile` extended additively; runner `run()` internal | ✅ additive |
| 4 | Import paths | New modules only, no moves | ✅ |
| 5 | Event IDs | `agent_orchestrator.artifact.captured` / `.promoted` (new) | ✅ additive (events ADDITIVE-ONLY) |
| 6 | Widget spot IDs | none | ✅ |
| 7 | API routes | `/runs/:runId/artifacts`, `/artifacts/file/:id` (new) | ✅ additive |
| 8 | DB schema | new `agent_run_artifacts` table; no renames/removals; append-only omits `updated_at` (allowed) | ✅ additive |
| 9 | DI service names | new `agentWorkspaceManager` / `artifactCollector` / `attachmentStager` | ✅ additive |
| 10 | ACL feature IDs | new artifact view/download feature(s) | ✅ additive (sync via `setup.ts` + `auth sync-role-acls`) |
| 11 | Notification IDs | none | ✅ |
| 12 | AI agent/tool IDs | `submit_outcome` **name unchanged**; `inputSchema` gains optional `artifacts` (MUST-NOT-remove respected) | ✅ stable — but see AGENTS.md note on mutation-approval contract |
| 13 | CLI commands | none renamed/removed | ✅ |
| 14 | Generated file contracts | OpenCode `.md` frontmatter generator (`agent-files.ts`) emits `write/edit: allow` **only when `files.enabled`**; default output byte-identical | ✅ additive, gated |

### Missing BC Section
**Not missing** — the spec includes a "Migration & Compatibility" section and a populated Final Compliance Report. One **clarification** is needed there (see completeness): state explicitly that `AgentResult` / `agentResultSchema` is **not modified** — artifacts are carried as separate `AgentRunArtifact` rows linked by `runId`, not by extending the frozen result union. As written, the TLDR phrase "returned alongside its typed result" could be read as a schema change.

## Spec Completeness

### Missing Sections
| Section | Impact | Recommendation |
|---------|--------|---------------|
| (none missing) | — | All required sections present (TLDR, Overview, Problem, Solution, Architecture, Data Models, API Contracts, UI/UX, Risks+register, Phasing, Implementation Plan, Compliance, Changelog) |

### Incomplete Sections
| Section | Gap | Recommendation |
|---------|-----|---------------|
| Architecture / Commands & Events | `artifact.capture` / `artifact.promote` commands named but **no undo contract** (`extractUndoPayload`) described | Add undo behavior: `promote` undo = soft-delete the created `Attachment` + clear `promotedAttachmentId`; `capture` is append-only (undo = soft-delete the rows + best-effort storage GC). Reference `packages/shared/src/lib/commands/undo.ts`. |
| Data Models | TLDR implies artifacts ride on the typed result | Add one line: `AgentResult`/`agentResultSchema` unchanged; artifacts are separate rows (BC clarity). |
| Testing Strategy | Has scenarios, but not a per-path API+UI matrix as the spec rules require for new features | Add an explicit table: each new API route + the operations-UI artifacts panel ↦ named integration test (`__integration__/TC-AGENT-FILES-00N.spec.ts`). |
| Configuration | `storage-s3` artifact write path is assumed available | State the dependency on Wave-0 F1 (artifact store) + F5 (`encryption.ts`) explicitly, and the degrade-path if `storage-s3` is absent (already partly covered in risks). |

## AGENTS.md Compliance

### Violations / Must-confirm
| Rule | Location | Fix |
|------|----------|-----|
| Encryption: PII columns need `<module>/encryption.ts` + `findWithDecryption` | `caption` column | Spec already declares this — but the module has **no `encryption.ts` today** (Wave-0 F5 unbuilt). Implementation MUST create/extend `agent_orchestrator/encryption.ts` (this is F5's scope) and read artifact rows via `findWithDecryption`. Treat F5 as a hard prerequisite, not a parallel nicety. |
| Decryption-aware reads (lessons.md) | `AttachmentStager` reading `Attachment` | Read via `findOneWithDecryption` even though `attachments` is unencrypted today, per the integration-read lesson (avoids silent regression if `content`/`fileName` become encrypted later). |
| Untrusted-upload safety (lessons.md: no sunsetted converter chains) | OCR sidecar staging | Reuse the existing `OcrService` path only; MUST NOT reintroduce `pdf2pic`/`gm`/Ghostscript to rasterize staged PDFs. Tag staged files as untrusted (already in risk register); note GUARD prompt-injection overlay is unbuilt (residual). |
| Commands undoable | capture/promote commands | Add `extractUndoPayload` (see Incomplete Sections). |
| `makeCrudRoute` for list; per-method `metadata`; `apiCall` in UI; `useGuardedMutation` for non-CrudForm writes | API + UI sections | Spec compliant; ensure the **Promote** action (a write) routes through `useGuardedMutation` and the download route exports per-method `metadata` (not top-level `requireAuth`). |
| Events via `createModuleEvents()` `as const` | `events.ts` additions | Spec implies; state it. New events should set `clientBroadcast: true` (spec does) to refresh the operations UI live. |
| ACL feature id is concrete (FROZEN once shipped) | "the same feature that gates `AgentRun` reads" | Pin the exact id against `acl.ts` before coding (e.g. confirm whether it's a `trace.view`/`runs.view`-style id) and declare the new artifact feature in `setup.ts` `defaultRoleFeatures`. |
| Mutation-approval contract (BC #12) | re-enabling `write`/`edit` | Confirm in the spec that the OpenCode **sandbox FS tools are not OM AI mutation tools** and therefore do not bypass `prepareMutation`/`isMutation` — domain effects still go through `submit_outcome → disposition → effector`. (Design intent is correct; make the non-bypass explicit so review doesn't flag it.) |

### Design System
UI section already mandates shared primitives (`DataTable`, `StatusBadge`, `EmptyState`, `LoadingMessage`), semantic tokens, `aria-label` on icon-only buttons, and `Cmd/Ctrl+Enter`/`Escape`. Add the lessons.md rule: use `IconButton` (never raw `<button>`) for the download/promote row actions.

## Risk Assessment

### High Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|
| **OpenCode shared-container isolation unverified** | If the container can't scope per-session cwd + writes, write-enabled agents can read/overwrite other runs' files (cross-tenant leak) | Phase-0 spike is a hard gate; escalate to per-run ephemeral container (spec Phase 4) if insufficient. Do not ship Phases 1–3 on an unverified verdict. |
| **Depends on unbuilt Wave-0 F1 (storage-s3 artifact store) + F5 (`encryption.ts`)** | Capture/encryption have no substrate today (`outputArtifactKey` columns exist but unpopulated; no `encryption.ts`) | Sequence after/with F1+F5, or fold a minimal `lib/trace/artifactStore.ts` + `encryption.ts` into Phase 1 scope. Make the dependency explicit in the spec's Depends list. |

### Medium Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|
| OpenCode session-cwd API may not exist | Forces path-pattern permission scoping or per-run containers | Resolve in Phase 0; record the contract in a `…-phase0-findings.md` sibling (mirror the existing OpenCode phase-0 findings doc). |
| Prompt-injection via staged documents | A poisoned doc steers the agent to write/exfiltrate into an artifact or mis-target promotion | Promotion is disposition-gated + human-reviewable; staged content tagged untrusted; GUARD injection overlay (unbuilt, spec #5) is the eventual backstop — note as residual. |
| Promotion undo not specified | Approved attach can't be cleanly reversed | Add undo payload (above). |
| Capture-loss on storage failure after sandbox teardown | Generated files lost | Spec already orders capture-before-teardown + `captureFailed` status; verify ordering in the runner `finally`. |

### Low Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|
| ACL feature id unpinned | Wrong/duplicated feature id (FROZEN once stored) | Pin before coding. |
| Artifact storage growth | Disk/cost at scale | Per-run byte/count caps (spec) + retention sweep (Phase 4 / GAP-19). |
| OCR/OpenAI latency or absence | Sidecar missing | `OcrService.available` guards; raw file still staged. |

## Gap Analysis

### Critical Gaps (Block Implementation)
- **Phase-0 isolation verdict**: verify OpenCode session working-directory + write-scoping on the shared container. Without it the write-enabled tier cannot be safely shipped.
- **Substrate dependency**: confirm/sequence Wave-0 **F1** (`storage-s3` artifact store) and **F5** (`encryption.ts`); the spec's capture + `caption` encryption assume both exist.

### Important Gaps (Should Address)
- **Undo contract** for `artifact.promote` (and capture soft-delete).
- **Exact ACL feature id(s)** + `setup.ts` `defaultRoleFeatures` wiring + post-deploy `auth sync-role-acls` note.
- **Two-store clarity**: artifact bytes → orchestrator `storage-s3` (inert); on promotion the effector writes a durable `Attachment` via the attachments `StorageDriver.store`. Make the two distinct stores explicit (the attachments module uses a pluggable driver, default `local`, *not* the same `storage-s3`).
- **AgentResult-unchanged** clarification (BC).
- **GUARD dependency note**: prompt-injection/untrusted-content guardrails (spec #5) are unbuilt; record as a known residual until that overlay lands.

### Nice-to-Have Gaps
- Per-path API+UI integration test matrix.
- Explicit sandbox-cleanup-on-crash assertion test.
- Cap-exceeded logging surfaced in the operations UI (spec logs it; consider a per-run "N artifacts skipped" badge).

## Remediation Plan

### Before Implementation (Must Do)
1. **Run the Phase-0 spike** and record a findings sibling; gate Phases 1–3 on a "sufficient isolation" verdict.
2. **Decide sequencing vs. F1/F5**: either land Wave-0 F1+F5 first, or absorb a minimal artifact store + `encryption.ts` into Phase 1. Update the spec's `Depends:`/Configuration accordingly.
3. **Pin the ACL feature id(s)** against `acl.ts`.

### During Implementation (Add to Spec)
1. Add the **undo contract** for capture/promote.
2. Add the **AgentResult-unchanged** clarification and the **two-store** (orchestrator s3 vs attachments driver) explanation.
3. Add the **per-path integration test matrix**.
4. State the **untrusted-content / no-converter-chain** rule and the GUARD-dependency residual.

### Post-Implementation (Follow Up)
1. Wire `agent_run_artifacts` + storage objects into DSAR/erasure + retention sweeps (GAP-12 / GAP-19).
2. Add the `files.bash` opt-in tier + per-binding flag once dispatch/`AgentBinding` lands (spec Phase 4).
3. Revisit per-run ephemeral containers if Phase-0 isolation proves weak.

## Recommendation

**Needs spec updates first (minor) + a Phase-0 spike.** The design is sound, additive, and well-aligned with the shipped module; there are **no backward-compatibility violations**. The blockers are operational/sequencing, not architectural: prove OpenCode sandbox isolation (Phase 0) and resolve the F1/F5 substrate dependency, then add the four "during implementation" clarifications. After those, this is ready to implement via `om-implement-spec`.
