# Sales order line validation focus

Source doc: .ai/specs/2026-11-26-sales-order-line-validation-focus.md

## Goal

Bring the existing line-items alert into view and focus it every time the sales order form rejects an empty order. [Issue #10679](https://github.com/open-mercato/open-mercato/issues/10679) · [Design PR #10840](https://github.com/open-mercato/open-mercato/pull/10840)

## Scope

Use the existing sales form submission path, localized alert, and order validation. Cover both Create buttons at laptop viewport size and retrying an empty order.

## Risks

An error can be rendered after the submit handler rejects. Pair each attempt with the rendered alert so focus runs after the alert is available and ordinary edits leave focus alone.

## Implementation Plan

### Phase 1: Order creation feedback

1.1 Connect empty order rejection to the existing alert and cover focus and retry in component tests.

1.2 Cover both Create buttons in the sales browser suite and archive the requirement.

## Progress

PR: #10841

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Order creation feedback

- [x] 1.1 Connect empty order rejection to the existing alert and cover focus and retry in component tests. — 07a459550e8dbaa4c25b081a0578014650761b9b
- [x] 1.2 Cover both Create buttons in the sales browser suite and archive the requirement. — d862143d22126438003ae81e651a282f6c4d184f
