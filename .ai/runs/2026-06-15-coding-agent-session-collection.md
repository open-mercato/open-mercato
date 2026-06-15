# Execution Plan — Coding-Agent Session Collection

**Date:** 2026-06-15
**Slug:** coding-agent-session-collection
**Branch:** feat/coding-agent-session-collection
**Type:** Docs-only (spec authoring)

## Goal

Write a detailed, architecturally-compliant spec for an opt-in program that lets Open Mercato collect (with explicit developer consent) anonymized Claude Code / OpenAI Codex coding sessions, so the team can analyze how developers build with Open Mercato. The spec covers: (1) `create-mercato-app` extension that installs consent-gated session-shipping hooks, (2) a local sanitizer that strips PII and dangerous data before any upload, and (3) an OSS ingestion module that asynchronously accepts sessions and stores them filesystem-first with a DB metadata index, tied into the telemetry specs.

## Scope

- New OSS spec at `.ai/specs/2026-06-15-coding-agent-session-collection.md`.
- Cross-reference `.ai/specs/2026-04-29-telemetry-and-otel.md` and `.ai/specs/enterprise/2026-06-04-usage-telemetry-phone-home.md`.
- No code changes — spec only.

## Non-goals

- No implementation of hooks, sanitizer, or module in this run.
- No changes to `create-mercato-app` source.
- No central commercial dashboard implementation (described as a separate-repo concern, mirroring telemetry-central).

## Decisions (confirmed with user)

- Spec placement: OSS spec; client (hooks, create-app wiring, sanitizer, ingestion module) ships OSS/dormant; analysis dashboard reuses the commercial `telemetry-central` repo pattern.
- Storage: filesystem-first for raw sanitized blobs + lightweight DB metadata index.
- Mandatory local PII/secret redaction before any session leaves the developer's machine.

## Risks (brief)

- Privacy: coding sessions contain source code, file paths, prompts, secrets. Redaction must be defense-in-depth and consent must be explicit + revocable. Spec must over-document this.
- Consent UX in `create-mercato-app` must default OFF and never auto-enable.
- Must not duplicate the telemetry-client phone-home channel; reuse env/precedence patterns.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Author the spec

- [x] 1.1 Write the full spec document (TLDR, problem, solution, architecture, data models, API contracts, sanitization pipeline, consent model, hooks design, create-app extension, ingestion module, telemetry relationship, phasing, risks, compliance, changelog) — local PII + dangerous-data redaction before upload made the load-bearing Part C per follow-up request
- [x] 1.2 Add spec to the spec listing/index if one is maintained; cross-link telemetry specs

### Phase 2: Self-review

- [x] 2.1 Re-read spec against om-spec-writing checklist + BC contract; tighten gaps
