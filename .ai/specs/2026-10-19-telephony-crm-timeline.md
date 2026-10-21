# Telephony to CRM timeline

**Status:** Implemented (event + subscriber; live provider ingestion is external)
**Created:** 2026-10-19
**Modules:** `phone_calls` (producer) + `customers` (consumer)

## TLDR

A completed call now lands on the CRM timeline. `phone_calls` emits `phone_calls.call.completed` when an ingest transitions a call into `completed` (first sight or a real status change), and the customers subscriber creates one `call` interaction per matching person, with the recording URL, duration and participant names.

## Decisions

1. **Lifecycle event, not a CRUD event.** `phone_calls.call.ingested` fires on every provider sync; a subscriber on it would duplicate timeline rows. `call.completed` fires only on the transition (`created` with completed status, or previous status ≠ completed), so re-syncs are quiet.
2. **Participants travel in the payload.** The subscriber never reads the `phone_calls` tables; it consumes the declared payload (id, scope, direction, timing, duration, recording URL, participants). This keeps the modules decoupled — the consumer does not import the producer's entities.
3. **Phone and email matching.** Participants are matched to people by exact email through `findPeopleByAddresses` and by normalized digits against decrypted `primary_phone` values (bounded scan, the same pattern as the email fallback). Either match links the call.
4. **Deterministic dedupe key.** Each interaction's `external_message_id` is a UUID derived from `(callId, personId)`, so the existing per-person unique index rejects a duplicate delivery from the event bus. The subscriber also checks before inserting.
5. **Interaction type `call`.** Title is `Inbound call` / `Outbound call` / `Phone call`; the body carries the recording URL when present; `duration_minutes` rounds up from seconds; `source` is `phone_calls`; the participant names are stored in the interaction's participant list.

## Surfaces

- `phone_calls/events.ts` — `phone_calls.call.completed`.
- `phone_calls/commands/calls.ts` — transition detection and payload assembly.
- `customers/subscribers/phoneCallInteraction.ts` — persistent subscriber.
- `customers/lib/phoneCallInteractions.ts` — pure mapping and dedupe helpers.

## Tests

- `phone_calls/commands/__tests__/calls.test.ts` — first ingest emits completed, re-ingest of an already completed call does not, and a missed → completed transition does.
- `customers/lib/__tests__/phoneCallInteractions.test.ts` — phone normalization, deterministic key, draft fields.

## Out of scope

- Fetching transcripts/summaries from the provider; only the recording URL already stored on the call is surfaced.
- Creating CRM people from unknown callers (matching only links existing people).
- Backfilling historical calls into timelines.
