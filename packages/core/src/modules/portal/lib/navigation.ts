/**
 * Portal-local import path for the boundary-crossing navigation helper.
 *
 * The implementation lives in `@open-mercato/shared/lib/navigation/pageReload` so `@open-mercato/ui`
 * — which does not depend on `@open-mercato/core` — can reach it from the portal shell and hooks.
 * This re-export keeps the published import path stable for existing callers.
 */
export { navigateWithPageReload } from '@open-mercato/shared/lib/navigation/pageReload'
