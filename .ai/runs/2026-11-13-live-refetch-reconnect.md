# Execution plan — reconnect-aware live refresh (#9421)

## Goal

Make browser live-refresh consumers survive event-bridge reconnect gaps: export the backend and portal reconnect ids as constants, add `useLiveRefetch` / `usePortalLiveRefetch`, swap in-repo literals for the constants, move the two portal detail pages onto the new hook, and document the at-most-once contract.

## Scope

- `@open-mercato/ui`: new constants `BRIDGE_RECONNECTED_EVENT_ID` (`backend/injection/useAppEvent.ts`) and `PORTAL_BRIDGE_RECONNECTED_EVENT_ID` (`portal/hooks/usePortalAppEvent.ts`); new hooks `backend/injection/useLiveRefetch.ts` and `portal/hooks/usePortalLiveRefetch.ts`; bridges import the constants.
- Mechanical literal → constant swap in core, enterprise, search, sync-akeneo, ui (incl. unit tests).
- Behavior change limited to `warranty_claims` portal claim detail and `staff` portal support ticket detail pages (they now refetch on portal reconnect).
- Docs: `useAppEvent` / `usePortalAppEvent` JSDoc, `apps/docs/docs/framework/events/overview.mdx`, `framework/widget-injection.md` docs, `packages/ui/AGENTS.md` portal hooks table.

### Non-goals

- Server-side replay (`Last-Event-ID`, buffers).
- Changing when the bridges disconnect.
- Rewriting other consumers onto the new hook (constant swap only).
- Poll/SSE dedup (#3626).
- `__integration__` specs keep the wire-value literals.

## Implementation Plan

### Phase 1: Constants and hooks

1.1 Export the reconnect id constants and make both bridges import them.
1.2 Add `useLiveRefetch` (with optional coalescing via `useAppEventCoalesced`) plus unit tests.
1.3 Add `usePortalLiveRefetch` plus unit tests.

### Phase 2: Consumers

2.1 Replace hand-written reconnect literals in source and unit tests with the constants.
2.2 Move the warranty-claim and support-ticket portal detail pages onto `usePortalLiveRefetch`, with component tests for reconnect refetch, draft preservation, and stale-response rejection.

### Phase 3: Documentation

3.1 Document the at-most-once / refetch-on-reconnect contract in JSDoc, events overview, widget-injection docs, and `packages/ui/AGENTS.md`.

## Risks

- Local `yarn test` gate: `ai-assistant` package-exports and `create-mercato-app` inventory tests fail locally because npm 12.2.2 returns `npm pack --json` as an object, not an array. This is environmental and unrelated to this change; CI (once approved) is authoritative.

- Coalesced path: a reconnect must share the window with event bursts — implemented by listening on both patterns inside one coalesced effect rather than two hooks.
- Portal pages: reconnect refetch must not unmount the comment/reply drafts; both pages already refresh in the background with request sequencing.

## Progress

PR: #9423

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Constants and hooks

- [x] 1.1 Export the reconnect id constants and make both bridges import them — 0b4680803d
- [x] 1.2 Add useLiveRefetch with unit tests — d6df0a6ea1
- [x] 1.3 Add usePortalLiveRefetch with unit tests — bb72a6111b

### Phase 2: Consumers

- [x] 2.1 Replace hand-written reconnect literals with the constants — 6f951f0838
- [x] 2.2 Move the two portal detail pages onto usePortalLiveRefetch with component tests — 4468baa357

### Phase 3: Documentation

- [x] 3.1 Document the no-replay contract and the new hooks — 4a4630cf45
