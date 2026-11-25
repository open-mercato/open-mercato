# Security scanner findings

## Goal

Address source-generation findings and replace a checked-in webhook test credential with a generated fixture. Record the Tpay checksum requirement and the independent signature check.

## Scope

Storybook variant generation, both feedback-widget browser fixtures, outbound webhook integration fixtures, and the Tpay operator guide.

## Implementation plan

Reuse TypeScript syntax nodes for the generated Storybook declarations and pass translations to the browser as serialized fixture data. Generate a webhook secret in each integration-test setup. Verify the browser paths, generation output, and webhook signature checks.

## Risks

Keep Storybook export names and variant IDs stable. Preserve Tpay compatibility with its notification protocol.

## Progress

PR: #10659

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Scanner findings

- [x] 1.1 Generate Storybook variant declarations through the TypeScript AST — e2b89212b6
- [x] 1.2 Pass feedback translations as fixture data and generate webhook test secrets — e2b89212b6
- [x] 1.3 Document the Tpay checksum and signature requirements — e2b89212b6

### Phase 2: Verification

- [x] 2.1 Run focused tests and review the scanner results — e2b89212b6
