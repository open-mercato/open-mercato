# Discord spec — correct the backward-compatibility claim

**Date**: 2026-08-05
**Scope**: spec-only, design-only. No code, no tests, no migrations.
**Spec**: `.ai/specs/2026-06-19-discord-communication-channel-integration.md`
**Refs**: #4391 (Discord provider PR), #4975 (QA blocker found against a real Discord bot)

## Goal

The spec claimed the core message path needs no hub contract change. QA of #4391 proved otherwise.
Replace the claim with the verified touch-points, classify the two fix variants against
`BACKWARD_COMPATIBILITY.md`, and record why the contradiction survived review.

## Progress

- [x] Read the spec's Backward compatibility section and the QA evidence in #4975
- [x] Verify each touch-point against `upstream/develop` (file + line, not the #4391 branch)
- [x] Replace the false claim with touch-points 1–3; keep the interactions handshake as touch-point 4
- [x] Add § Open decision — hub sender-identity contract (Variant A / Variant B, BC classification,
      rejected synthetic-email option, shared prerequisite, recommendation, test consequence)
- [x] Add the "how the contradiction survived review" lesson with rules for non-email providers
- [x] Update Status, TLDR concerns, the Risks table and the Final compliance report for consistency
- [x] Changelog entry
- [x] Open the spec-only PR against `develop`

## Verification

Markdown-only change under `.ai/specs/`; no source file touched, so the code validation gate
(`yarn build:packages` … `yarn build:app`) has nothing to exercise. Verification performed instead:
every file and line number cited in the spec was re-read on `upstream/develop` at `c11a64ce0` and
matches the quoted code.

## Follow-up (not in this PR)

The hub owner decides Variant A vs Variant B on #4975; the implementation and the
`TC-CHANNEL-DISCORD-003` rewrite ship on their own PR.
