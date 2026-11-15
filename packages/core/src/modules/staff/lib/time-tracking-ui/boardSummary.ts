/**
 * What the screen-6 page head says under the title:
 * `Nordvik — migracja B2B · 24 zadania · 78:20 zalogowane`.
 *
 * The active view (board or list) reports it upward rather than the head fetching the
 * same tasks a second time, so the subtitle always describes exactly the rows the user
 * is looking at — filters included.
 *
 * `loggedMinutes` MUST come from `sumTaskLoggedMinutes`. A task's `loggedMinutes` is the
 * inclusive rollup (own + children, D-2), so folding parents and children together in a
 * plain `reduce` counts the children twice — risk R10. That helper drops any row whose
 * parent is present in the same set, which is why it is the only sanctioned way to total
 * a mixed set.
 */
export type BoardSummary = {
  taskCount: number
  loggedMinutes: number
}

export const EMPTY_BOARD_SUMMARY: BoardSummary = { taskCount: 0, loggedMinutes: 0 }
