# Attachments OCR timeout message

## Goal

When an OCR provider call is aborted by a timeout, report it as a timeout instead of telling the operator to check `OPENAI_API_KEY` (#6399).

## Scope

- Add a timeout/abort case to the error mapper in `packages/core/src/modules/attachments/lib/ocrService.ts`.
- Add a regression test in `packages/core/src/modules/attachments/lib/__tests__/ocrService.test.ts` that rejects the provider call with a real `AbortSignal.timeout()` reason.

## Non-goals

- Add or change the per-page OCR timeout itself (that is #6264).
- Change the existing OpenAI error-code mapping (`insufficient_quota`, `invalid_api_key`, `account_deactivated`, `rate_limit_exceeded`).
- Change the HTTP status normalization of wrapped errors.

## Implementation Plan

### Phase 1: Regression test

- Add a test that rejects `generateText` with `AbortSignal.timeout(1).reason` (`TimeoutError`) and asserts the message mentions a timeout and does not mention `OPENAI_API_KEY`.
- Confirm the test fails against the current mapper.

### Phase 2: Fix and verification

- Map `TimeoutError` / `AbortError` to a timeout message in the mapper, before the `OPENAI_API_KEY` fallback.
- Confirm the new test passes and the existing `ocrService` tests still pass.
- Run the configured validation gate.

## Risks

- An `AbortError` can also come from a caller-initiated cancel, not only a timeout, so the message must stay accurate for both ("aborted" / "timed out") and must not claim a configured limit the service does not know.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Regression test

- [x] 1.1 Add the timeout regression test and confirm it fails on develop — 8ea881e433

### Phase 2: Fix and verification

- [ ] 2.1 Map TimeoutError/AbortError in the OCR error mapper
- [ ] 2.2 Run the focused suite and the validation gate
