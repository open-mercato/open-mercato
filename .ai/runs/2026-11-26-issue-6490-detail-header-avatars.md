# Replaceable company and person detail header avatars

Source doc: .ai/specs/2026-09-28-customers-detail-header-avatar-handles.md

## Goal and scope

Let CRM extensions render a company logo or contact photo in the existing detail header using the component registry. The two typed hosts receive the overview already loaded by the page and the heading's display name. Image storage, uploads, and customer API changes are outside this work.

## Implementation plan

1. Register both avatar components, declare the hosts and render them inside the headers. Preserve the current `xl` company avatar and `lg` person avatar.
2. Exercise both contracts through the override provider and the headers, covering default rendering, wrappers, replacements, permissions and error fallback.
3. Document the frozen contracts and run the repository validation and review workflows.

## Risks

Applications depend on the handle names and prop shapes once shipped. Tests will pin the names to the declarations and check that the original overview reaches the override. Keep the person's current avatar dimensions, which changed since the spec was written.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Customer header avatar contracts

- [ ] 1.1 Register and render both customer header avatars
- [ ] 1.2 Test the contracts and detail header integration
- [ ] 1.3 Document the public handles and verify the change
