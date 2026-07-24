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

## Blockers or evidence-only decisions

- `<concise item or none>`

## Sanitization attestation

No raw diff, commit/PR body, private prompt/transcript, credential, token, environment value, absolute path, remote URL, or author identity is included.
```

Paraphrase failures and evidence. Include only repository-relative paths, case IDs, stable public IDs, counts, hashes, commands typed by the maintainer, and tool/model versions. Never paste runner output wholesale.
