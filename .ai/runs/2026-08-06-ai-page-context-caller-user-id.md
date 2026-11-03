# Run plan — expose the caller's `userId` on `AiAgentPageContextInput`

- **Issue:** [#5049](https://github.com/open-mercato/open-mercato/issues/5049) — `AiAgentPageContextInput` lacks the caller's userId
- **Branch:** `feat/issue-5049-page-context-user-id` (base `develop`)
- **Skill:** `om-auto-fix-issue`
- **Route deviation:** the issue is labelled `feature`, but the change is one additive optional
  field on a public type plus threading an already-authenticated value through one runtime
  function. `AGENTS.md` says to skip the spec-first workflow for small fixes, so this run
  implements directly on a single PR with this tracked plan instead of authoring a design spec
  on a separate spec PR.

## 🎯 Goal

A `resolvePageContext` implementation currently receives `entityType`, `recordId`, `container`,
`tenantId` and `organizationId` — everything except *who is asking*. `recordId` is supplied by
the browser, so a resolver hydrating a per-user record (the reported case is a mail thread
scoped by `CommunicationChannel.userId`) has no way to check that the caller owns it: any member
of the organization could read a colleague's mailbox through the agent. The safe workaround
today is to not use server-side page context for per-user data at all.

Give the resolver the authenticated caller's id, taken from the server-side auth context — never
from the request payload — so it can authorize the hydration itself.

## 🧭 Approach

1. Add `userId?: string | null` to `AiAgentPageContextInput`. Optional, so every existing
   resolver and every existing construction site of the type keeps compiling
   (`BACKWARD_COMPATIBILITY.md`: optional fields on `AiAgentDefinition`-adjacent types may be
   extended, never narrowed).
2. Thread the value through `composeSystemPrompt` as a trailing optional parameter, so the
   exported signature stays call-compatible for existing 5-argument callers.
3. Both runtime entry points (`runAiAgentText` chat path and the object-mode path) pass
   `input.authContext.userId` — the same server-resolved context that already supplies
   `tenantId` / `organizationId` — so the browser cannot influence it.
4. Document the field and its fail-closed semantics (`undefined`/`null` ⇒ no verified caller
   ⇒ do not hydrate user-scoped data) in the type JSDoc, the agent docs and the developer guide.

Deliberately **out of scope**: changing what the existing `customers` / `catalog` resolvers do
with the new field. They hydrate org-shared CRM records and build their tool context with
`userId: null, isSuperAdmin: true`; rewiring that is a behaviour change on working code and
belongs in its own PR.

## 📋 Progress

- [x] Read `packages/ai-assistant/AGENTS.md`, `BACKWARD_COMPATIBILITY.md` and the current
      `resolvePageContext` call path
- [x] Confirm the gap on `develop` (triage gate) and claim the issue
- [x] Add the optional `userId` field to `AiAgentPageContextInput` with JSDoc
- [x] Thread the authenticated user through `composeSystemPrompt` and both runtime call sites
- [x] Unit test: the resolver receives the authenticated `userId`, and a browser-supplied
      `pageContext.userId` cannot override it
- [x] Unit test: an existing 5-argument `composeSystemPrompt` caller still works (BC)
- [x] Update docs (`agents.mdx`, `developer-guide.mdx`), `packages/ai-assistant/AGENTS.md`,
      `BACKWARD_COMPATIBILITY.md`
- [x] Validation gate
- [x] Open the PR, apply labels, post the summary comment

## 🧪 Verification

Validation gate from `.ai/agentic.config.json`, run locally (no compose `app` container up):
`yarn build:packages`, `yarn generate`, `yarn build:packages`, `yarn i18n:check-sync`,
`yarn i18n:check-usage`, `yarn typecheck`, `yarn test`, `yarn build:app`.

## 🏷️ Labels

`feature`, `security`, `priority-medium`, `risk-low`, `review`, `skip-qa` — backend-only change
with no `.tsx` outside tests, no schema and no API-surface change, and automated tests for the
new behaviour ship in the same PR, which is exactly the automated-verification exemption.
