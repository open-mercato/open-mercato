# Release upgrade companion automation

## Goal

Make release changelog preparation finalize matching upgrade-note windows and guarantee that every release with downstream upgrade guidance ships a version-specific migration skill in both the monorepo and the standalone agentic harness.

## Scope

- Add an Open Mercato-specific override for the external `om-auto-update-changelog` skill.
- Reconcile `UPGRADE_NOTES.md` release headings with the version and date selected for `CHANGELOG.md`.
- Require and, when missing, author `om-auto-upgrade-<from>-to-<to>` from the matching upgrade-note section.
- Ship the release-specific skill in `.ai/skills/` and byte-identically in the standalone harness, with migration-tier registration and regression coverage.
- Document the release contract in a focused OSS specification and skill catalogs.

**Source doc:** `.ai/specs/2026-07-27-mercato-upgrade-reconcile-command.md` (related release-upgrade context from PR #4547; this run does not implement that command).

**Non-goals:** No package-version bump, git tag, runtime `mercato upgrade` implementation, database migration, or rewrite of historical upgrade guidance. The standalone harness release evaluation suite is not expanded with a new behavioral case because the deliverable is a statically installed migration skill, covered by parity and manifest tests.

## Implementation Plan

### Phase 1: Define the release contract

- **1.1 Release specification and changelog override.** Add the focused spec and local `om-auto-update-changelog` override that derives the release window from the changelog, finalizes matching unreleased upgrade headings, and requires a companion skill before delegating the PR.
- **1.2 Release invariant tests.** Add regression coverage that ties the top changelog release to its upgrade-note heading, monorepo companion skill, standalone byte-identical copy, and both migration-tier manifests.

### Phase 2: Ship the current release companion

- **2.1 Author the 0.6.6 to 0.6.7 migration skill.** Encode safe mechanical migrations and explicit human-review checks from the current upgrade notes.
- **2.2 Publish the skill across agent surfaces.** Mirror the skill into the standalone harness, register both copies in their migration tiers, update the skill catalogs, and finalize matching upgrade-note release dates.

### Phase 3: Verify and review

- **3.1 Focused and full validation.** Run the skill-tier validator, create-app release invariant tests, configured validation gate, and authoritative PR review/autofix pass.

## Risks

- **False release-window match:** only an unreleased heading whose source version equals the previous changelog release is eligible; ambiguous matches stop instead of rewriting unrelated notes.
- **Unsafe automated migration:** the versioned skill edits only unambiguous import and payload-access patterns, while metadata-dependent scheduler code and swallowed callback errors remain explicit human-review items.
- **Monorepo/standalone drift:** byte-identity and tier-registration tests fail when either copy or manifest is missing.
- **Contract interaction:** the external changelog skill normally edits only `CHANGELOG.md`; the repo-local override explicitly broadens this repository's release artifact set while retaining dry-run, review, and validation safeguards.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Define the release contract

- [x] 1.1 Release specification and changelog override — d08e8afb5
- [x] 1.2 Release invariant tests — 349d1f996

### Phase 2: Ship the current release companion

- [ ] 2.1 Author the 0.6.6 to 0.6.7 migration skill
- [ ] 2.2 Publish the skill across agent surfaces

### Phase 3: Verify and review

- [ ] 3.1 Focused and full validation
