# Execution plan — Platform hardening

## Goal

Strengthen access controls, request handling, and deployment defaults across the supported platform.

## Scope

Apply targeted changes to identity, data access, public request processing, and shipped deployment configuration. Keep the main change coordinated with the supported maintenance line.

## Implementation Plan

The four independent implementation groups run in parallel and converge for verification and review.

### Phase 1: Platform hardening

- 1.1 Strengthen identity and session decisions.
- 1.2 Harden shipped deployment defaults.
- 1.3 Harden checkout, cart, and workflow operations.
- 1.4 Align data access and resource limits across entry points.

### Phase 2: Verification

- 2.1 Verify the supported maintenance backport locally.
- 2.2 Run the validation gate and review the integrated change.

### Phase 3: QA follow-up

- 3.1 Integrate the latest main branch and verify both sets of authorization changes.
- 3.2 Add accessible labels, autocomplete, and password instructions to the Enterprise Security form.

## Risks

Confirm normal authentication, operator setup, and storefront behavior alongside the negative cases. Changes to operator defaults and narrowly changed API behavior need migration notes.

## Progress

PR: #10543

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Platform hardening

- [x] 1.1 Strengthen identity and session decisions. — dff069b00c
- [x] 1.2 Harden shipped deployment defaults. — 3b0f79c432
- [x] 1.3 Harden checkout, cart, and workflow operations. — 36dc4cbd38
- [x] 1.4 Align data access and resource limits across entry points. — 1ddf842a0a

### Phase 2: Verification

- [x] 2.1 Verify the supported maintenance backport locally. — f8fa79d3a6 (PR #10455, 106 focused tests passed on the release line.)
- [x] 2.2 Run the validation gate and review the integrated change. — ff8c15fea8 (Configured local gate passed on the integrated implementation. Credential and cart merge API checks passed. Browser QA remains open after the documented integration readiness redirect loop.)

### Phase 3: QA follow-up

- [x] 3.1 Integrate the latest main branch and verify both sets of authorization changes. — bcc4d33e4b (Merge 6a34aa410d. All 179 focused Jest tests passed.)
- [x] 3.2 Add accessible labels, autocomplete, and password instructions to the Enterprise Security form. — 57f476674c (Enterprise Chromium assertions included in TC-SEC-016.)
