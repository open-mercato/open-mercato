# Communication channel setup

Source doc: .ai/specs/2026-11-22-communication-channel-setup.md

Help workspace users find provider setup and know whether Gmail is ready before they connect.

Phase 1 adds feature-gated navigation and an optional marketplace category filter. Phase 2 adds scoped, read-only OAuth readiness and recovery guidance. The route must return only a setup flag for the signed-in organization and must never start OAuth. Phase 3 covers the flows in integration tests and archives the capability.

## Progress

PR: #10365

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Setup navigation

- [x] 1.1 Gate shared channel links and accept the initial marketplace category — 8d7d5e015d

### Phase 2: OAuth readiness

- [x] 2.1 Read scoped client configuration before enabling Gmail and show recovery guidance — e29acb4885

### Phase 3: Verification

- [x] 3.1 Add API and UI integration coverage and archive the capability — 393a5eebc3
- [ ] 3.2 Run validation and review
