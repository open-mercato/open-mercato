# Patch Hono adapter and selector parser

Goal: remove four open Dependabot vulnerable resolutions with compatible patched versions.

Scope: root existing @hono/node-server resolution 1.19.14 to 2.1.3 (SDK accepts ^1.19.9 || ^2.0.5), and refresh postcss-selector-parser ^7.0.0 to 7.1.6, preserving unaffected 6.x. These two remediation groups share yarn.lock and ship together to avoid overlapping lock edits. No production dependency added, public contract or workflow change.

Source identities: dependabot:open-mercato/open-mercato:509,298,492,301; GHSA-rmxm-3fg6-px4f; GHSA-frvp-7c67-39w9; GHSA-rj75-hqrm-r3gf; GHSA-w9m9-85wc-3x92.

Source doc: .ai/specs/briefs/2026-08-09-dependabot-cooldown-ci-gate.md

Non-goals: other alerts, issues/advisory creation, dismissal, merges, releases, settings, CI changes, age-gate bypasses. Existing claimed PRs 8857/8809/8778/8747 are excluded. Registry patches published Sep29/Sep3, older than five days. Independent read-only triage checked all 335 open PR bodies and active cockpit runs.

## Implementation Plan

### Phase 1: Compatible dependency refresh
1.1 Update existing adapter pin and refresh compatible selector resolution using pinned Yarn.
1.2 Demonstrate vulnerable paths absent and patched consumers work.

### Phase 2: Verification and delivery
2.1 Run configured ordered validation gate and applicable resolution checks; request ci-full.
2.2 Obtain independent final review and publish evidence; keep draft on incomplete verification.

## Risks

Adapter changes major version but existing SDK permits it; smoke coverage and full CI required. Dependency installation/build may encounter unrelated baseline or environment failures; report separately. No alert is fixed until merged main is verified on a future run.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Compatible dependency refresh

- [ ] 1.1 Update existing adapter pin and refresh compatible selector resolution using pinned Yarn.
- [ ] 1.2 Demonstrate vulnerable paths absent and patched consumers work.

### Phase 2: Verification and delivery

- [ ] 2.1 Run configured ordered validation gate and applicable resolution checks; request ci-full.
- [ ] 2.2 Obtain independent final review and publish evidence; keep draft on incomplete verification.
