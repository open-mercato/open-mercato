# Authorize record-lock validation reads

## Goal

Apply the shared target read policy before the validation endpoint returns record-lock information.

## Scope

Use the policy introduced by [#10626](https://github.com/open-mercato/open-mercato/pull/10626) and cover the validation endpoint independently. This PR targets that branch so the policy has a single implementation.

## Implementation Plan

Gate validation on the request's resolved organization scope and the shared target read check. Preserve the existing response for authorized requests. Add route and integration coverage for allowed and denied callers.

## Risks

The stacked change depends on #10626. Review the resulting contract and rerun its validation when the prerequisite reaches main.

Source doc: .ai/specs/enterprise/2026-06-09-record-locks-unified-coverage.md

## Progress

PR: #10797

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Authorization

- [x] 1.1 Enforce target read access before validation. — 40f9a3e337
- [x] 1.2 Add endpoint regression coverage. — 40f9a3e337
- [ ] 1.3 Validate and review the change.
