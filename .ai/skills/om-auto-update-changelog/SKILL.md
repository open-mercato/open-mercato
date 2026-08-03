> **Repo-local override.** This file extends the external `om-auto-update-changelog` skill for Open Mercato release preparation. The external workflow remains authoritative except where this override explicitly broadens the release artifact set.

# Open Mercato release-upgrade companion contract

Open Mercato releases must keep `CHANGELOG.md`, `UPGRADE_NOTES.md`, and version-specific downstream migration skills aligned. Apply this contract after the external skill resolves `{version}`, `{date}`, and the previous changelog release, but before it edits files or delegates to `om-auto-create-pr`.

## 1. Resolve the matching upgrade window

Read `UPGRADE_NOTES.md` and parse headings shaped as:

```text
## <from> → <to> (<date-or-unreleased>)
```

The candidate for the release is the section whose `<from>` equals the changelog release immediately below `{version}`. Comparison is semantic-version equality, not substring matching.

- No candidate means this release has no downstream upgrade notes. Continue with the external changelog-only workflow.
- Exactly one candidate means the section belongs to this release. Set `<to>` to `{version}` and replace `(unreleased)` with `({date})`. An already aligned heading is an idempotent no-op.
- More than one candidate, or a second section already targeting `{version}`, is ambiguous. Stop before edits and report the conflicting headings.

Never rewrite older dated windows or a future window whose `<from>` is not the previous changelog release. On an amend run for an existing top changelog release, use the next heading as the previous release and apply the same rule.

## 2. Require the version-specific companion skill

When a matching upgrade-note section exists, derive:

```text
om-auto-upgrade-<from>-to-<version>
```

Before delegating the release PR, require all four artifacts:

1. `.ai/skills/<skill>/SKILL.md` in the monorepo.
2. `packages/create-app/agentic/shared/ai/skills/<skill>/SKILL.md` as a byte-identical standalone harness copy.
3. `<skill>` in `.ai/skills/tiers.json` under `migration`.
4. `<skill>` in `packages/create-app/agentic/shared/ai/skills/tiers.json` under `migration`.

If any artifact is missing, create or repair the complete set in the same release PR. Build the skill only from the matching `UPGRADE_NOTES.md` section and classify every downstream action as one of:

- **Automatic:** a bounded, unambiguous, idempotent source edit.
- **Detect and report:** a reliable search exists but user intent is needed to change code safely.
- **No code action:** the note changes runtime behavior or operations only; explain it in the final report.

The skill must validate that it is running in a downstream app, support `--path` and `--dry-run`, avoid framework-owned `packages/` and generated/vendor directories, show its edit plan before mutation, run the app's configured typecheck/tests after edits, and list unresolved manual work. A release section with no safe automatic edit still gets a companion skill: discoverability and a deterministic review checklist are part of the contract.

Update `.ai/skills/README.md` and `.ai/skills/om-help/references/skills-catalog.md` for the new migration skill. Do not add version-specific skills to the default tier.

## 3. Broaden the delegated PR safely

For a release with matching upgrade notes, the external skill's `CHANGELOG.md`-only restriction is replaced by this exact allow-list:

- `CHANGELOG.md`
- `UPGRADE_NOTES.md`
- `.ai/skills/om-auto-upgrade-<from>-to-<version>/**`
- `packages/create-app/agentic/shared/ai/skills/om-auto-upgrade-<from>-to-<version>/**`
- `.ai/skills/tiers.json`
- `packages/create-app/agentic/shared/ai/skills/tiers.json`
- `.ai/skills/README.md`
- `.ai/skills/om-help/references/skills-catalog.md`
- tests/specs that enforce this release contract

Pass the expanded file list and the upgrade-window facts in the concrete `om-auto-create-pr` brief. The resulting PR is still non-UI and uses `skip-qa`, but it is a release-automation feature rather than a changelog-only documentation change.

With `--dry-run`, print the proposed heading reconciliation, companion-skill path/status, action classification, and both tier registrations without editing any file or invoking `om-auto-create-pr`.

## 4. Verification

Before delegating, run the smallest focused checks available:

```text
bash scripts/validate-skills-tiers.sh
yarn workspace create-mercato-app test
```

The delegated `om-auto-create-pr` run still owns the configured full validation and review gate. Do not claim the release artifacts are aligned until monorepo/standalone byte identity and both migration-tier registrations pass.
