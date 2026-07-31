# Public Session Share Skill

## Goal

Add a default-installed `om-share-this-session` skill that prepares a structurally complete, locally sanitized agent-session bundle, requires fresh informed consent for public disclosure, publishes the reviewed artifacts to a dedicated temporary branch, and files a linked upstream issue so real harness failures can improve future prompts and workflows.

## Scope

- Add the skill to the monorepo-local skill catalog and to the standalone create-app asset set.
- Preserve every session turn while sanitizing secret, personal-data, and absolute-path values before publication; never upload the original session export.
- Package only an explicit manifest of files created or changed during the session as a ZIP, rejecting dangerous paths, symlinks, binaries, oversized payloads, and unresolved privacy findings.
- Require an agent semantic privacy review plus a fresh, exact user acknowledgement after the sanitized artifact list, redaction counts, public target, and permanence warning are shown.
- Add tracker-provider operations for atomically publishing and removing a public session-share branch, then create a deduplicated issue linking the session JSON, generated-files ZIP, and manifest.
- Add regression tests for sanitization, fail-closed validation, monorepo/create-app parity, tier installation, and both create-app copy pipelines.

## Existing design adopted

- Reuse the privacy principles in `.ai/specs/2026-06-15-coding-agent-session-collection.md`: explicit opt-in, local-first sanitization, path normalization, dangerous-file dropping, conservative secret/PII detection, exact previews, and honest disclosure that automated scanning cannot prove free-text anonymity.
- This skill is a one-shot, user-confirmed public support workflow. It does not implement the draft spec's background hooks, telemetry endpoint, ingestion module, consent persistence, or automatic collection.

## Non-goals

- Do not upload this development session or any fixture data while implementing the skill.
- Do not add automatic/background session collection, a persistent consent record, a production dependency, or a server-side ingestion service.
- Do not claim that regex scanning alone guarantees the absence of personal data.
- Do not publish to a gist: the accepted temporary-branch option preserves the generated files as an actual ZIP and permits an atomic branch reference.
- Do not alter application runtime behavior, UI, database schemas, or module contracts.

## Implementation Plan

### Phase 1: Privacy-safe bundle preparation

1. Author the layered skill workflow with a hard pre-publication consent boundary, native-session completeness checks, explicit generated-file selection, and clear issue/report templates.
2. Add a dependency-free preparation script that parses the full JSON export, sanitizes retained content, rejects unsafe/unscannable inputs, emits a manifest, and creates a standards-compliant generated-files ZIP.
3. Add focused tests for clean preparation, redaction, dangerous paths, binary/symlink rejection, invalid/incomplete sessions, and archive integrity.

### Phase 2: Public publication contract and installation

1. Add atomic public-branch publish/delete operations to both GitHub tracker descriptors, with visibility, collision, size, branch-name, and rollback guards.
2. Register the skill in the monorepo default tier and catalog, mirror it byte-for-byte into create-app's default local tier, and update the standalone workflow navigator.
3. Wire every skill asset through both standalone copy pipelines and add parity/copy/install regression assertions.

### Phase 3: Validation and publication

1. Run the skill-specific test suite, tier validation, create-app tests, instruction budgets, and the configured full validation gate in local mode.
2. Review the diff for privacy, security, compatibility, publication rollback, and scope risks; fix findings and publish the final PR with verification evidence.

## Risks

- Session text can contain names or contextual personal data that pattern matching cannot identify. The workflow therefore requires a separate semantic review and explicit user attestation, and aborts on uncertainty.
- A public Git branch can be fetched, cached, forked, or retained after deletion. The consent screen must state that branch deletion is cleanup, not guaranteed erasure.
- A partial upload could expose artifacts without a tracking issue. The provider operation creates blobs and a commit before creating the public ref, and the skill deletes the ref if issue creation fails.
- Session formats differ across harnesses. The workflow accepts only a native JSON export with recognizable user and assistant turns and requires the executing agent to verify first/latest-turn coverage; it never fabricates a transcript when full export is unavailable.
- Mirrored skill copies and two copy pipelines can drift. Tests require byte parity and assert every bundled asset is copied by both paths.

## Progress

PR: #4756

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Privacy-safe bundle preparation

- [x] 1.1 Add the layered consent, completeness, privacy-review, publication, and reporting workflow — 221270eb1
- [x] 1.2 Add the local sanitizer/bundle-preparation script — 46a966275
- [x] 1.3 Add privacy and archive regression tests — ff9a76e13

### Phase 2: Public publication contract and installation

- [x] 2.1 Add guarded atomic public-session branch operations to both tracker descriptors — 2b6c45cbb
- [x] 2.2 Register and mirror the skill in monorepo and standalone default tiers/catalogs — 6d4941bfe
- [x] 2.3 Wire both standalone copy pipelines and add parity/install assertions — 6d4941bfe

### Phase 3: Validation and publication

- [ ] 3.1 Run targeted and configured validation gates
- [ ] 3.2 Complete automated review, PR evidence, and ready-for-review handoff
