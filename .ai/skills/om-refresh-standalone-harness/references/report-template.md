# Sanitized Refresh Report

Write one local report to:

```text
.ai/analysis/standalone-harness-refresh-<from-short-hash>-<to-short-hash>.md
```

Use 12-character resolved commit hashes. Do not use supplied ref names in the filename. The report is the only publication performed by this skill; external publication, commits, pushes, comments, labels, and PR changes require a separate explicitly authorized workflow.

```markdown
# Standalone Harness Refresh

- Outcome: complete | blocked | dry-run | no changes
- Local range: `<from-short>..<to-short>`
- Catalog before/after: `<count>` / `<count>`
- External systems mutated: none

## Evidence and classification

| Candidate | Classes | Risk | Repository-relative evidence | Contract/ID summary |
|---|---|---|---|---|

## Deduplication

| Candidate | Disposition | Existing/new case | Rationale |
|---|---|---|---|

## Failure-first and owners

| Case | Sanitized failure before owner edit | One primary owner | Result after edit |
|---|---|---|---|

## Synchronized surfaces

| Catalog/schema/matrix/spec/doc/test surface | Before | After |
|---|---|---|

## Validation

| Command/lane | Runner/model/version | Result | Sanitized artifact or reason unavailable |
|---|---|---|---|

Include separate rows for the focused case, deterministic `yarn harness:validate --all`, and full `yarn harness:release --runner <codex|claude> --prepare-targets <absolute-empty-dir> --acknowledge-writes` suite. Record the selected primary runner and either the explicitly requested different portability runner or `not requested`; never imply omitted secondary evidence passed. For the full suite record its schema-valid sanitized report hash and overall status, never its absolute path or raw model output.

## Blockers or evidence-only decisions

- `<concise item or none>`

## Optional observation evidence

- `<When requested, summarize observed scope, per-lane counts, unavailable responses/files/metrics, and sanitized evidence hashes. Omit local dashboard URLs and absolute paths. Observation is not release certification.>`

## Sanitization attestation

No raw diff, commit/PR body, private prompt/transcript, credential, token, environment value, absolute path, remote URL, or author identity is included.
```

Paraphrase failures and evidence. Include only repository-relative paths, case IDs, stable public IDs, counts, hashes, commands typed by the maintainer, and tool/model versions. Never paste runner output wholesale.

For optional dashboard inspection, follow the [tool contract](../../../../scripts/experiment-dashboard/README.md) and `om-run-harness-evals`. Omit the observation section when no observer was requested; preserve every mandatory focused, deterministic, and release-suite row.
