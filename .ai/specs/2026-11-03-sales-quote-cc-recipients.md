# SPEC — CC Recipients When Sending a Quote

**Scope:** OSS
**Status:** Implemented in the PR for [#8460](https://github.com/open-mercato/open-mercato/issues/8460)
**Related:** #8459 (document "Send to" address precedence)

---

## TLDR

The Send quote dialog and `POST /api/sales/quotes/send` accept CC recipients. Each CC recipient gets their own copy of the quote details, without the acceptance link. The change is additive: callers that do not send `cc` behave as before.

## Problem Statement

A quote goes to one address. Sellers who need to keep a buyer's purchasing or accounting team informed have to forward the mail by hand, and nothing on the quote records who was copied.

## Proposed Solution

- The send request gets an optional `cc` list, validated and capped.
- The list is remembered on the quote, so reopening the dialog pre-fills it.
- Each recipient is mailed separately through the ordinary `sendEmail`, so no provider adapter changes and recipients do not see each other.

## Architecture

### Acceptance link

The acceptance link is a bearer capability, so it goes to the main recipient only. A shared message with a real `Cc:` header would hand it to everyone, which is why copies are separate mails rendered from `QuoteSentEmail` without a URL, with a notice saying the main recipient can review and accept.

### Order and partial failure

1. The quote is marked as sent and `metadata.recipients.cc` is stored in the transaction.
2. The main mail is sent. If it fails, the failure is reported as before and no copies are sent.
3. Copies are sent one at a time. A copy that fails is logged and reported with code `sales.quote_cc_copy_failed`, and the remaining copies still go out. The endpoint returns 200, because the quote was delivered.
4. A reporter that throws is caught and logged as a warning, so telemetry can never change the outcome of the send.

The response stays `{ ok: true }`, so it does not say which copies failed. Failed copies are visible only through logs and error reporting.

### Mutation guards

`modifiedPayload` from the guards is merged and re-parsed through `quoteSendSchema` before the quote is read, stored or mailed, so a guard can remove, rewrite or invalidate `cc`.

## API Contract

`POST /api/sales/quotes/send`, in `quoteSendSchema`:

| Field | Type | Default | Rules |
|---|---|---|---|
| `cc` | `string[]` | `[]` | Each entry trimmed and a valid e-mail, at most `QUOTE_SEND_CC_LIMIT` (10) entries. An invalid entry returns 400 and the quote stays unsent. |

The route drops the primary address and case-insensitive duplicates before sending and storing.

## Data Model

No schema change and no migration. The list is stored in the existing, encrypted `sales_quotes.metadata` column:

```json
{ "recipients": { "cc": ["purchasing@example.com"] } }
```

Other metadata keys are preserved. The list is overwritten on every send.

## UI

- The Send quote dialog gets a CC field built on `TagInput`.
- Text typed but not confirmed as a tag is sent too. Invalid pending text blocks the send and keeps the dialog open.
- Reopening the dialog pre-fills the field from `metadata.recipients.cc`.
- `TagInput` gets two optional props, `inputValue` and `onInputValueChange`, so the dialog can read the pending text. It stays uncontrolled when they are omitted.

## Migration & Backward Compatibility

| Surface | Change | Classification |
|---|---|---|
| API route `POST /api/sales/quotes/send` | Optional request field `cc`, default `[]` | Additive |
| Exports of `sales/data/validators` | `QUOTE_SEND_CC_LIMIT`, `quoteSendCcAddressSchema` | Additive |
| `TagInput` props in `packages/ui` | Optional `inputValue`, `onInputValueChange` | Additive |
| `metadata` on quotes | New key `recipients.cc` | Additive, no migration |
| `QuoteSentEmail` copy | Optional fields for the copy notice and a mail without a link | Additive |

Nothing is removed, renamed or narrowed, so no deprecation bridge is needed. Requests without `cc` send one mail, as before, except that `metadata.recipients.cc` is stored as an empty list.

## Risks & Impact Review

| Risk | Severity | Mitigation |
|---|---|---|
| Acceptance link reaches a CC recipient | High | Copies are rendered without a URL; a unit test asserts no link or anchor in a copy |
| A failed copy reports a delivered quote as failed | Medium | Each copy is isolated; failures are reported and the endpoint returns 200 |
| Telemetry failure breaks the send | Medium | Reporting has its own guard; a unit test uses a throwing reporter |
| A CC address is mailed from a stale list | Low | The dialog shows the pre-filled list before sending, and it can be edited |
| A guard rewrites `cc` after validation | Low | The merged payload is re-parsed before use |

## Integration Coverage

`packages/core/src/modules/sales/__integration__/TC-SALES-8460-quote-cc-recipients.spec.ts`:

- API: `cc` is accepted, the primary address and duplicates are dropped, and the list is stored.
- API: the main recipient gets the acceptance link and each CC recipient gets a copy without it (needs the test channel seeding).
- API: an invalid CC address returns 400 and the quote stays unsent.
- UI: a confirmed tag and pending text are both sent, including with Ctrl+Enter from inside the field.
- UI: invalid pending text blocks the send and keeps the dialog open.
- UI: reopening the dialog pre-fills the list.

Failed-copy and throwing-reporter behaviour is covered by `sales/api/__tests__/quotes.acceptance.test.ts`.

## Changelog

- 2026-11-03: Written with the implementation to record the additive contract.
