# WMS list pages flash "Loading table" on window refocus

## Goal

Stop the WMS ASN, Lots, and Putaway list tables from swapping their content (or empty state) for the DataTable loading state every time the browser tab/window regains focus.

## Scope

- `packages/core/src/modules/wms/components/backend/WmsAsnsListPage.tsx`
- `packages/core/src/modules/wms/components/backend/WmsLotsListPage.tsx`
- `packages/core/src/modules/wms/components/backend/WmsPutawayQueuePage.tsx`
- New regression test under `packages/core/src/modules/wms/components/backend/__tests__/`

Root cause: each page binds `DataTable isLoading` to React Query `isFetching`. The shared QueryClient (`packages/ui/src/theme/QueryProvider.tsx`) has `staleTime: 0` by default and React Query's default `refetchOnWindowFocus: true`, so every refocus triggers a background refetch that sets `isFetching` and blanks the table. Fix: bind to `isLoading` (first load only). Each page already gates the table on `query.data` and shows `LoadingMessage` while `isLoading`, so key changes (page/filter/search) behave exactly as before.

### Non-goals

- `packages/core/src/modules/messages/components/MessagesInboxPageClient.tsx` (same pattern, handled separately).
- Changing QueryClient defaults (`refetchOnWindowFocus`, `staleTime`).
- Adding `placeholderData` / inline refetch indicators.

## Implementation Plan

### Phase 1: Fix and regression test

1. Bind DataTable `isLoading` to `isLoading` instead of `isFetching` in the three WMS list pages.
2. Add a render-level regression test asserting a background refetch keeps the DataTable out of the loading state.

## Risks

- Background refetches are now silent (no spinner); data still updates when the response lands. Low risk, UI-only.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Fix and regression test

- [ ] 1.1 Bind DataTable isLoading to isLoading in WMS list pages
- [ ] 1.2 Add background-refetch regression test
