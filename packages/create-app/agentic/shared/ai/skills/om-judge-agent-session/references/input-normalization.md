# Input Normalization

Normalize one of these input shapes into the evidence model below.

## Harness result

Require a schema-valid writable result, its bounded generated-file snapshot, case ID/prompt hash, runner/model versions, final artifact fingerprint, controller oracle result, and declared command/test attestations. Prefer the controller-produced judge-validation artifact when present. Reject evidence whose case, target, or fingerprint does not bind to the source result.

## User-shared session

Accept either a native/sanitized `session.json` plus an artifact directory, or the `om-share-this-session` bundle introduced by PR #4756:

- `session.json`
- `generated-files.zip` or an already extracted generated-files directory
- `manifest.json`
- `privacy-report.json`

Validate manifest hashes and privacy status when supplied. Inspect archive entries before extraction; reject absolute paths, `..`, NUL bytes, symlinks, special files, duplicate normalized names, oversized entries, or paths outside a fresh temporary directory. Never extract over the source bundle. Missing hashes or artifacts produce `unavailable` evidence, not a pass.

## Evidence model

Record:

- input kind, schema/bundle version, session or case ID, and source hashes;
- framework/app version and project-rule version;
- bounded changed/generated text files and declared route paths;
- fixed attestations for generate, typecheck, lint, build, tests, controller oracles, and route uniqueness;
- code-review and design-system review evidence;
- privacy/redaction status and every missing, stale, or unverifiable field.

Do not copy raw prompt or transcript bodies into the normalized record. Keep only identifiers, hashes, bounded excerpts needed for a finding, and redacted summaries.
