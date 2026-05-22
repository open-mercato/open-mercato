# Fix Deal Analyzer Stage Approval Tool Availability

## Goal

Ensure the `customers.deal_analyzer` agent can create a pending deal stage-change approval when the operator asks for that action directly, instead of reporting that `customers.update_deal_stage` is unavailable.

## Scope

- Customers module AI agent definition.
- Customers module AI agent unit coverage.

## Non-goals

- No new AI tools.
- No changes to mutation approval persistence or approval-card rendering.
- No changes to customer deal write APIs.

## Implementation Plan

### Phase 1: Root Cause And Patch

1. Update the deal analyzer loop `prepareStep` tool narrowing so `customers.update_deal_stage` remains available on the first step while the prompt still instructs the agent to analyze first.
2. Update unit coverage to assert the mutation tool is available in step 0 and step 1.

### Phase 2: Validation And PR

1. Run targeted customers AI-agent tests.
2. Run package-level typecheck if practical.
3. Push the branch and open a PR against `develop`.

## Risks

- Exposing the mutation tool in step 0 could let the model call it before `customers.analyze_deals`; the agent prompt still requires analysis first, and the mutation remains gated by `prepareMutation` + `confirm-required`.
- Tenant policy overrides can still make the mutation unavailable when the tenant is read-only; that behavior is intentional and not changed.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append `— <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Root Cause And Patch

- [ ] 1.1 Update deal analyzer first-step active tools
- [ ] 1.2 Update unit coverage

### Phase 2: Validation And PR

- [ ] 2.1 Run targeted validation
- [ ] 2.2 Open PR
