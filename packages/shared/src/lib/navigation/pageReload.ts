/**
 * Navigates by reloading the document instead of handing the route to the client router.
 *
 * The portal's `(frontend)` layout — the server component that decides the portal chrome and
 * resolves the customer session — sits *above* the `[...slug]` segment so portal navigation does
 * not remount the client subtree. A client-side `router.push`/`router.replace` therefore never
 * re-runs that layout, and any navigation that crosses the public/authenticated boundary would
 * keep rendering chrome computed for the page it came from: authenticated chrome over the login
 * page after a logout, or logged-out chrome over the dashboard after a login.
 *
 * Use this helper for every boundary-crossing navigation (login, logout, signup completion,
 * invite acceptance, auth guards redirecting to login) so the layout re-runs and recomputes both
 * the chrome and the session. Same-side navigation should keep using the client router.
 */
export function navigateWithPageReload(path: string): void {
  window.location.assign(path)
}
