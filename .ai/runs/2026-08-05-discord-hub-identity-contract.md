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

### Phase 2: Apply the review of #4998 (@pkarw — changes-requested)

- [x] 2.1 Major — recompute the Variant B cost/benefit against the code
      (`external_messages.sender_identifier` + the `message_channel_links` 1:1 join;
      `buildPersonLookupFilter` matches only `primary_email` / `primary_phone`), add the third option
      the A/B pair hid, and correct the recommendation
- [x] 2.2 Minor — state which compose paths stay blocked under Variant A (`POST /api/messages`,
      OpenAPI surface) and that the reply path is unaffected
- [x] 2.3 Minor — link #4976 / #4977 / #4978 in § Related, the shared prerequisite and the risks row
- [x] 2.4 Nits — name all three `externalEmail` validator sites; flag the CR/LF header-injection
      guard on `send-as-user`'s `subject` that any widening must preserve
- [x] 2.5 Test coverage — record that TC-CHANNEL-DISCORD-003 lives on the #4391 branch (#4665), and
      make "a non-email provider completes an inbound compose" a required acceptance criterion

## Verification

Markdown-only change under `.ai/specs/`; no source file touched, so the code validation gate
(`yarn build:packages` … `yarn build:app`) has nothing to exercise. Verification performed instead:
every file and line number cited in the spec was re-read on `upstream/develop` at `c11a64ce0` and
matches the quoted code.

Phase 2 (review follow-up) re-verified every new citation the same way, on the PR head worktree at
`2bcc68e0`: `entities.ts:243-244` (`sender_identifier`) and `:268-287` (`message_channel_links_message_uq`,
`provider_key`, `channel_type`), `ingest-inbound-message.ts:292-317` / `:450-465` (the link row always
carries `external_message_id`), `contact-resolver.ts:21` and `:145-149`, `validators.ts:107` / `:186` /
`:220` / `:248-266`, `messages/api/route.ts:448`, `messages/api/openapi.ts:267`,
`commands/messages.ts:741-744`, `send-as-user/route.ts:20`/`:23-26`, `test-send/route.ts:33-34`. Each
claim added in this phase is checkable at those lines.

## Follow-up (not in this PR)

The hub owner decides Variant A vs Variant B on #4975; the implementation and the
`TC-CHANNEL-DISCORD-003` rewrite ship on their own PR.
