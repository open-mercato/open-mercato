export const metadata = {
  // Public token-gated surface: the token itself is the gate (verified by the
  // API route with uniform 404 semantics) — no staff session, no chrome.
  requireAuth: false,
  pageTitle: 'Mockup',
  pageTitleKey: 'design_system.mockups.share.pageTitle',
}
