# CRM person phone lookup implementation

Source doc: .ai/specs/2026-11-22-customers-phone-blind-index.md
Issue: #5515

## Goal

Find an indexed CRM contact by phone digits even when the contact falls outside the decrypted candidate scan.

## Scope

Maintain a private person phone digest, query it through the existing authorized check-phone route, and provide a scoped data backfill. Keep the existing email and inbox matching policies.

## Implementation Plan

Characterize current route behavior, introduce the additive storage and write path, change the reader, and verify the rollout with backfill and integration fixtures. Record the resulting contract in the capability spec.

## Risks

Phone data requires keyed hashing and successful verification under the existing decryption policy. The migration must agree with the ORM metadata. Historical coverage depends on backfill and key availability.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Characterization and writes

- [ ] 1.1 Characterize the bounded encrypted lookup
- [ ] 1.2 Add scoped digest storage and write maintenance

### Phase 2: Lookup and rollout

- [ ] 2.1 Query and verify indexed candidates
- [ ] 2.2 Backfill historical phone digests and document rollout
- [ ] 2.3 Verify the API and run the validation gate
- [ ] 2.4 Archive the phone lookup capability
