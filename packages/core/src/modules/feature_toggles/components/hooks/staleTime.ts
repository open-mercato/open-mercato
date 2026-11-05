// Mirrors the server-side toggle resolution cache TTL in
// `lib/feature-flag-check.ts`, so several components reading the same toggle
// share one request instead of refetching a value the server would not have
// re-resolved anyway.
export const FEATURE_FLAG_STALE_TIME_MS = 60_000
