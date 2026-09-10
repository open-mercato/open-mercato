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
 * Use this for redirects the user should not be able to navigate back into: an auth guard sending
 * an unauthenticated visitor to the login page, or the portal landing page forwarding a signed-in
 * customer to the dashboard. `navigateWithPageReload` would leave the redirecting page in history,
 * so pressing Back would land on it and immediately bounce forward again.
 */
export function replaceWithPageReload(path: string): void {
  window.location.replace(path)
}
