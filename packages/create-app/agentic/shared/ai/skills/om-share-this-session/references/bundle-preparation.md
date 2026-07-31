# Bundle preparation

Use this procedure in steps 1–2 to prove scope and create a local-only sanitized bundle.

## Resolve the native session export

- Prefer an explicit `--session` path or a path exposed by the active harness. Do not crawl `~/.claude`, `~/.codex`, browser profiles, or unrelated history.
- Accept only a parseable native JSON export. A hand-written transcript, summary, screenshot, or copy/paste of selected turns is not complete enough.
- Confirm the export belongs to this active session using the harness session/thread id when available. Then compare the first recognizable user turn and the latest completed assistant turn with the active conversation. Record only pass/fail and counts; never quote raw turn content into the report.
- The preparer requires at least one recognizable user turn and one assistant turn. Structural success does not prove current-session completeness; the explicit first/latest comparison remains mandatory.

## Build the generated-files manifest

Create a temporary newline-delimited manifest of repository-relative file paths. Include only regular files that this session created or modified, based on write/edit tool calls in this conversation. Cross-check against the diff/status, but do not treat every dirty path as session-owned: pre-existing user changes stay excluded.

- Paths must remain under the explicit project root.
- Exclude deleted files, dependency/vendor trees, build output, caches, credential/config stores, `.env*`, keys, certificates, symlinks, sockets, devices, and files that cannot be decoded as UTF-8 text.
- Do not include the source session JSON in this manifest; it is handled separately.
- Show the sanitized relative path list during review. A filename containing a person, customer, email, phone, or private project identifier must be renamed or excluded before continuing.

## Run the local preparer

Resolve `<skill-dir>` to the active skill folder and use a new temporary parent directory. The output path must not already exist.

```bash
node <skill-dir>/scripts/prepare-share-bundle.mjs \
  --name <share-name> \
  --session <native-session.json> \
  --project-root <project-root> \
  --files <files-manifest.txt> \
  --out <temporary-parent>/bundle
```

When semantic review finds a literal name or project/customer identifier that pattern matching cannot classify, put one exact literal per line in a local temporary file and rerun from the original inputs with `--redact-list <path>`. Never print that list or publish it. Literals shorter than four characters are rejected to prevent destructive over-redaction.

Successful output:

- `session.json` — structurally complete sanitized JSON, preserving turn order.
- `generated-files.zip` — ZIP of the sanitized generated-file tree.
- `manifest.json` — share name, turn/file counts, sanitized relative paths, modes, sizes, and SHA-256 hashes.
- `privacy-report.json` — redaction-category counts and mandatory manual-review status.
- `review/generated-files/` — local-only unpacked sanitized files for semantic review; the provider operation never uploads this directory.

The script is local-only and dependency-free beyond Node and Git. On any parse, scope, type, size, path, archive, or residual-scan failure it exits non-zero and leaves no completed output directory. Do not bypass or patch around a failure during a share run.

