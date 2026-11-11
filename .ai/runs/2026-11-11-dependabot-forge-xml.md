# Patch the coupled Forge/XML dependency graph

## Goal

Remediate only Dependabot alerts 544–548 in open-mercato/open-mercato by resolving node-forge 1.4.3 and fast-xml-parser 5.12.0, preserving compatibility and scaffold security pins.

Engine: om-auto-create-pr (steps: 5, --loop: no)
Source doc: .ai/specs/briefs/2026-08-09-dependabot-cooldown-ci-gate.md
Base: f4decc8a57579cdd84a758bcddb3c1739fdc6ebe
Claim-Run: d76312f1-59b6-48a1-9b56-f0bd4f9baaeb

## Scope

Root package.json/yarn.lock, existing create-app security pin, focused dependency security smoke/regression tests, and this run's evidence. Existing node-forge override is required because @parse/node-apn pins 1.3.1; prefer a compatible parent upgrade if available. fast-xml-parser's consumer accepts ^5.3.4, so update its resolved graph without adding an override.

## Implementation Plan

### Phase 1: Publish and inspect

1.1 Commit this plan, recheck deduplication, push a dedicated branch, open a bare draft, acquire the atomic PR lock, and verify the timestamped claim/in-progress guard.
1.2 Install the unchanged pinned graph; capture actual paths, registry patch metadata and independent advisory proof before changing dependencies.

### Phase 2: Patch and verify

2.1 Update only the necessary existing pin and compatible XML graph, mirror the scaffold pin, and add useful regression/smoke checks. Commit changes incrementally.
2.2 Run focused checks and all eight ordered validation.commands with timeouts using the prescribed runner; distinguish environmental/baseline failures. Request ci-full if explicit relevant integration is not run.

### Phase 3: Handoff

3.1 Publish exact security fingerprints, before/after proof, validation exits and residual limits; normalize guarded labels and release owned claim. Keep draft for the parent's reserved independent review (no child dispatch, ready promotion or merge).

## Risks

A compatible parser minor introduces necessary transitive patches. Missing installed dependencies or app environment may block validation; report exact exits and keep the draft. Yarn 4.17.1 and the five-day age gate remain unchanged. No API/schema/public contract changes. No issues, alert dismissal, workflow/settings/release changes, broad overrides or unrelated remediations.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Publish and inspect

- [ ] 1.1 Publish draft and acquire verified claim
- [ ] 1.2 Capture installed baseline and advisory proof

### Phase 2: Patch and verify

- [ ] 2.1 Patch compatible graph and add focused coverage
- [ ] 2.2 Execute focused and ordered validation

### Phase 3: Handoff

- [ ] 3.1 Publish evidence and release claim for parent review
