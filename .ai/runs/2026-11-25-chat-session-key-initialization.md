# OpenCode chat session initialization

Status: in-progress

A new OpenCode chat requires a persisted staff session key before the route starts streaming. Return a localized service error when issuance fails so that a failed credential setup cannot continue as a chat request.

The route uses the existing session-key service and error-reporting helper. A request with a valid existing session follows the existing ownership path.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Chat session startup

- [x] 1.1 Refuse startup when session-key persistence fails and cover the route response
- [ ] 1.2 Verify the candidate and open the PR
