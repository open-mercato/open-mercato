# OpenCode chat session initialization

Status: complete

When new staff session-key issuance rejects, return a localized service error before starting an OpenCode chat. The route test covers the reported failure and verifies the streaming handler stays uncalled.

The route uses the existing session-key service and error-reporting helper. A request with a valid existing session follows the existing ownership path.

## Progress

PR: #10657

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Chat session startup

- [x] 1.1 Refuse startup when session-key persistence fails and cover the route response — 018bf6aecf
- [x] 1.2 Verify the candidate and open the PR — 018bf6aecf
- [x] 1.3 Record automated review and current hosted check status — 6d276eb88f

The full local gate passed. Independent automated review found no blockers in the route change. Hosted checks continue on the pull request.
