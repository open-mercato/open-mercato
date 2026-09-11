/**
 * Boundary-crossing navigation helpers: they reload the document instead of handing the route to
 * the client router.
 *
 * The portal's `(frontend)` layout — the server component that decides the portal chrome and
 * resolves the customer session — sits *above* the `[...slug]` segment so portal navigation does
 * not remount the client subtree. A client-side `router.push`/`router.replace` therefore never
 * re-runs that layout, and any navigation that crosses the public/authenticated boundary would
 * keep rendering chrome computed for the page it came from: authenticated chrome over the login
 * page after a logout, or logged-out chrome over the dashboard after a login.
 *
 * Use these helpers for every boundary-crossing navigation (login, logout, signup completion,
 * invite acceptance, auth guards redirecting to login) so the layout re-runs and recomputes both
 * the chrome and the session. Same-side navigation should keep using the client router.
 *
 * Pick the one that matches the client-router call it stands in for, so session history behaves
 * the same way: `navigateWithPageReload` for `router.push`, `replaceWithPageReload` for
 * `router.replace`.
 */

/** Full page load that adds a session-history entry — the document-loading counterpart of `router.push`. */
export function navigateWithPageReload(path: string): void {
  window.location.assign(path)
}

/**
 * Full page load that replaces the current session-history entry — the document-loading
 * counterpart of `router.replace`.
 *
 * Use this where the client-router call being replaced was a `router.replace`: an auth guard
 * sending an unauthenticated visitor to the login page, or the portal landing page forwarding a
 * signed-in customer to the dashboard.
 *
 * Note that for those call sites specifically, `navigateWithPageReload` was measured to behave
 * identically: they redirect from an effect during page load, and a browser treats a navigation
 * started then as a client redirect, replacing the entry rather than pushing it whichever method
 * is used. This helper exists so the call site states which semantics it means instead of relying
 * on that heuristic — and so a redirect that later moves behind a user gesture, where the
 * distinction does bite, keeps the behaviour it was written with.
 */
export function replaceWithPageReload(path: string): void {
  window.location.replace(path)
}
