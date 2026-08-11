# Spec Resolution

Resolve the user's reference before readiness analysis or planning. The first unambiguous match wins.

1. **Path** — use an existing repository-relative Markdown file directly.
2. **Name/title** — search the configured specs directory (`paths.specs`, default `.ai/specs`) case-insensitively by filename with or without its date prefix/extension, then by the document's first `# Title`. Use the newest dated file only when the title match is unambiguous.
3. **Issue** — for a numeric reference and an available configured tracker, use its read-only issue operation and scan the body/comments for repository-relative spec paths. Do not mutate the issue.
4. **Spec PR** — when the numeric issue lookup does not resolve a spec, use the tracker's read-only PR operation. Accept a spec path only when that file is already present locally. Do not fetch, check out, update, or implement on a spec PR branch; ask the user to materialize/merge it locally or use `om-auto-implement-spec` for PR delivery.

Record the repository-relative path as `SPEC_PATH`. Validate that the file has an `## Implementation Plan` or `## Phasing` section. A found spec without one returns to `om-spec-writing` as not implementation-ready.

If several candidates remain, stop and let the user select one. If no candidate exists, report:

```text
Status: blocked
Spec not found for "{spec}".
Searched: path, configured specs-directory name/title match, and read-only issue/spec-PR references when a tracker was available.
Closest candidates:
- {path} — {title}
- …
Next: pass an exact path, or create/revise the spec with om-spec-writing "{spec}".
```

This local resolver performs no tracker writes and makes no branch, commit, or PR claim.
