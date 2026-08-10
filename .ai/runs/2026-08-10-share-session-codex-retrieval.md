# Native Codex session retrieval for session sharing

## Goal

Allow `om-share-this-session` to obtain a complete native Codex session export when the active harness exposes a thread/session ID but no export path, avoiding an unnecessary manual-export dead end.

## Scope

- Add a fail-closed local exporter that reads an explicitly supplied Codex thread through the native app-server `thread/read` protocol and writes a new JSON file.
- Make bundle analysis recognize Codex thread turns whose user and assistant messages are nested under turn items.
- Document the Codex retrieval branch, add regression coverage, keep the create-app skill mirror byte-identical, and record the reusable standalone-agentic lesson.

## Non-goals

- No filesystem crawling for session history, session resume/fork behavior, telemetry, automatic upload, or weakening of the existing sanitization and fresh-consent gates.
- No provider-specific retrieval for coding agents other than Codex; unsupported harnesses continue to require a user-provided native export.
- No changes to public artifact destinations or publication operations.

## Implementation Plan

### Phase 1: Native retrieval and parsing

- Add a bounded Codex app-server exporter that validates the requested thread ID, output path, protocol response, and returned thread identity before writing.
- Extend session analysis and tests for native Codex thread JSON while preserving existing export formats and fail-closed behavior.

### Phase 2: Distribution and guidance

- Document the retrieval decision branch, mirror the complete skill into create-app assets, and update the matching standalone-agentic lesson.

## Risks

- The Codex app-server protocol is experimental, so the exporter must time out, reject malformed/error responses, and leave no partial output.
- Thread JSON can contain sensitive local metadata; retrieval remains local-only and the existing full sanitization and semantic-review gates remain mandatory.
- The monorepo and create-app copies must remain byte-identical or standalone users would receive stale behavior.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Native retrieval and parsing

- [x] 1.1 Add a fail-closed native Codex thread exporter — 291027bc7
- [x] 1.2 Support and test Codex thread-shaped session JSON — 291027bc7

### Phase 2: Distribution and guidance

- [ ] 2.1 Document, mirror, and record the retrieval workflow
