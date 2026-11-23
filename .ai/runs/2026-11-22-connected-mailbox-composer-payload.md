# Connected mailbox composer payload

Source doc: .ai/specs/2026-11-22-connected-mailbox-composer-payload.md
Spec PR: #10366
Issue: #6261

## Goal

Send a new public message through a connected mailbox with the selected files and keep linked records on the in-app copy.

## Scope

Carry the composer upload owner through the existing sender delegation. Validate provider limits, bind attachments to the sent message, and save the outbound link and linked records atomically. Keep the direct send-as-user and platform-sender contracts.

## Risks

The attachment move must check both scope and the expected compose owner again when writing. The delivery worker must only see committed message ownership and link metadata. The integration test uses an isolated seeded mailbox and does not contact a live provider.

## Progress

PR: #10367

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Composer and delivery

- [x] 1.1 Characterize the current mailbox payload rejection — e4ba27b61f
- [x] 1.2 Carry the composer payload through atomic mailbox compose and provider validation — 338f6e3441
- [x] 1.3 Verify the composer payload and run the validation gate — 06c1148890

### Phase 2: Capability archive

- [x] 2.1 Record the achieved behavior in the capability spec — 1df354bf81

## Validation evidence

- The four mailbox integration cases passed. The test commit is `54189ed011`.
- Browser verification and screenshots are in [the QA comment](https://github.com/open-mercato/open-mercato/pull/10367#issuecomment-7082336419).
- [Hosted CI](https://github.com/open-mercato/open-mercato/actions/runs/45051279068) passed all required checks and 15 integration shards on `06c1148890`. Two create-app tests also failed on the upstream base under local macOS containment.
- The approved recovery contract has focused coverage for both queue failure modes, the scoped diagnostic, the HTTP 201 response, the warning, saved-message navigation and duplicate-submit prevention. The mailbox integration suite now checks PostgreSQL rollback, file ownership, linked records and delivery status after an acknowledgement loss.
