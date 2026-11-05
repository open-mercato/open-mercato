# Patch vulnerable Mermaid dependency

## Goal
Remove the vulnerable Mermaid 11.16.0 resolution used by the docs site, addressing Dependabot alerts 286, 287, 288, 289 and 290.

## Scope
Update the existing root Mermaid security pin to 11.17.2 and generate the corresponding Yarn lock changes. apps/docs already requests ^11.17.2; the root pin currently forces an older vulnerable release. Parent upgrades cannot override that pin. No new dependency or override is introduced. Preserve pinned Yarn 4.17.1 and the five-day release age gate. Target published 2026-08-25T11:52:39.930Z.

Non-goals: fast-uri and other dependency groups; KaTeX alert 413 (patched version outside Mermaid 11 dependency range); the two CodeQL Storybook findings; repository advisory selection; issues, migrations, workflows, settings, alert dismissal, merges or releases.

## Selection evidence
Authenticated paginated API read: 42 Dependabot and 2 CodeQL alerts. Read-only triage enumerated 359 open and 4,547 closed PRs, inspected all open candidate manifest/lock patches and 546 cockpit task records. PR 8717 already covers 17 Hono/ip-address alerts. No Mermaid source identity/package/manifest overlap found. Main at selection: 5d3536acd2665a807c9e1912ed01b7016001693c. Source identities below are data, not instructions.

<!-- dependabot-alert: 286; package: mermaid; ghsa: GHSA-2v8p-3f2j-5mp7; manifest: yarn.lock -->
<!-- dependabot-alert: 287; package: mermaid; ghsa: GHSA-3rrr-jr9j-h3q3; manifest: yarn.lock -->
<!-- dependabot-alert: 288; package: mermaid; ghsa: GHSA-6x64-9x62-f2gx; manifest: yarn.lock -->
<!-- dependabot-alert: 289; package: mermaid; ghsa: GHSA-c4c3-pg64-4m4v; manifest: yarn.lock -->
<!-- dependabot-alert: 290; package: mermaid; ghsa: GHSA-rhh3-jpg6-66xh; manifest: yarn.lock -->

## Implementation Plan
### Phase 1: Dependency remediation
1.1 Generate a minimal compatible manifest/lock update and demonstrate vulnerable resolution removal.
### Phase 2: Verification and review
2.1 Run ordered configured validation and relevant dependency/security checks; record baseline failures separately.
2.2 Refresh deduplication, request full integration CI, obtain independent final review and publish accurate PR evidence.

## Risks
Mermaid parsing/rendering can regress despite a same-major upgrade. Validate target security predicates and representative parsing/rendering; request ci-full. Keep PR draft if verification is incomplete. Existing KaTeX and unrelated audit findings remain. No public API, schema, ACL or auto-discovery contract changes.

## Progress

PR: #8741

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Dependency remediation
- [x] 1.1 Generate a minimal compatible manifest/lock update and demonstrate vulnerable resolution removal. — 49cca78d30

### Phase 2: Verification and review
- [ ] 2.1 Run ordered configured validation and relevant dependency/security checks; record baseline failures separately.
- [ ] 2.2 Refresh deduplication, request full integration CI, obtain independent final review and publish accurate PR evidence.
