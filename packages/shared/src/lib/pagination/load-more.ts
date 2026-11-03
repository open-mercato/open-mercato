/**
 * Termination signal for incremental "load more" affordances.
 *
 * A page that comes back full is the only reliable "there may be more" signal.
 * A server-reported `total` / `totalPages` can under-report — rows inserted
 * between two requests do it today, and a capped list count will do it by
 * design once `OM_LIST_COUNT_CAP` lands (see
 * `.ai/specs/2026-07-27-list-count-strategies.md`) — and gating the affordance
 * on one strands every row past the reported end behind a button that has
 * already disappeared.
 *
 * `>=` rather than `===` so an endpoint that serves more than it was asked for
 * still terminates correctly.
 *
 * Two obligations come with this, and both have already caused real defects:
 *
 * 1. **Measure what the server served**, not what survived client-side dedupe
 *    or filtering. A deduped length shorter than the served page terminates the
 *    sequence early — reintroducing exactly the bug this replaces.
 *
 * 2. **Only for endpoints whose page past the end comes back short.** That
 *    holds for every list built on the query engine, which computes an
 *    unclamped offset. An endpoint that instead clamps the requested page to
 *    the last page re-serves that page in full, forever; a caller of one must
 *    also check it was served the page it asked for before appending. See
 *    `AttachmentsSection`, whose endpoint clamps.
 */
export function hasMoreFromPage(servedCount: number, pageSize: number): boolean {
  return servedCount >= pageSize
}
