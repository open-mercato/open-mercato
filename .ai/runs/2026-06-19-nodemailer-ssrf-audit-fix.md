# Execution plan — fix `yarn npm audit` high-severity nodemailer finding

## Goal

Clear the high-severity `yarn npm audit --all --recursive --severity high` failure
for nodemailer (GHSA-p6gq-j5cr-w38f — message-level `raw` option bypasses
`disableFileAccess`/`disableUrlAccess`, enabling arbitrary file read + full-response
SSRF). Vulnerable versions: `<=9.0.0`. Patched: `9.0.1`.

## Scope

- `packages/channel-imap/package.json` — bump declared `nodemailer` to the patched range.
- Root `package.json` — add a `nodemailer` resolution forcing the patched version across
  the whole dependency tree (mailparser pins nodemailer exactly: 3.9.9→8.0.10, 3.9.10→9.0.0,
  both vulnerable, so a declared-dep bump alone is insufficient).
- `yarn.lock` — regenerate so every nodemailer node resolves to the patched version.
- Root `package.json` — also bump the existing `undici` resolution `7.24.0 → 7.28.0`. Once the
  nodemailer finding was cleared, the same `yarn npm audit ... --severity high` step (which fails on
  the first high finding) surfaced a second high: undici GHSA-vmh5-mc38-953g (TLS cert validation
  bypass, vulnerable `>=7.23.0 <7.28.0`). This is the exact remediation already merged on `main`
  via #3278/#3355; develop had not received it. Required for the audit step to actually exit 0.

### Affected dependents (from the audit output)

- `@open-mercato/channel-imap@workspace:packages/channel-imap` → `nodemailer@^9.0.0` (resolves 9.0.0)
- `mailparser@npm:3.9.9` → `nodemailer@8.0.10` (transitive, exact pin)

## Non-goals

- No application logic changes. `smtp-client.ts` uses a fully type-cast dynamic
  `import('nodemailer')` and does not depend on `@types/nodemailer`, so no source edits are needed.
- No change to `@types/nodemailer` (already at `^8.0.1`, the latest published types; runtime is
  decoupled from it).
- No mailparser major/minor bump (the resolution handles its pinned transitive nodemailer).

## Risks

- nodemailer 9.0.1 is a patch over 9.0.0 (no API break). mailparser 3.9.10 already adopts
  nodemailer 9.0.0, confirming 9.x compatibility with mailparser's usage; forcing 9.0.1 onto the
  3.9.9 copy (which natively wants 8.0.10) is the only cross-major hop, but nodemailer's
  `MailComposer`/`createTransport`/libmime surface that mailparser relies on is stable across 8→9.
- Low blast radius: dependency-only change, no contract surface touched.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Remediate nodemailer

- [ ] 1.1 Bump `nodemailer` to `^9.0.1` in `packages/channel-imap/package.json`
- [ ] 1.2 Add `nodemailer` resolution (`9.0.1`) to root `package.json`
- [ ] 1.3 Bump `undici` resolution `7.24.0 → 7.28.0` (second high surfaced by the same audit step)
- [ ] 1.4 Regenerate `yarn.lock` via `yarn install`

### Phase 2: Verify

- [ ] 2.1 Confirm `yarn npm audit --all --recursive --severity high` exits 0 (no high findings)
- [ ] 2.2 Build + typecheck channel-imap; run channel-imap unit tests
