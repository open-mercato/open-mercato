/**
 * Phase 2b — shared types + constants for the submission-drawer injection
 * widgets (AnonymizeButton, AccessAuditPanel, SelfAuditFooter,
 * PdfDownloadButton).
 *
 * The host drawer (`SubmissionDrawer.tsx`) passes a `DrawerInjectionContext`
 * into every spot. The injection runtime additionally merges a `sharedState`
 * bag into the context object, so widgets accept the host shape plus that
 * optional field — never `any`.
 */

import type { DrawerInjectionContext } from '../../backend/forms/[id]/submissions/components/SubmissionDrawer'

export type FormsDrawerWidgetContext = DrawerInjectionContext & {
  sharedState?: Record<string, unknown>
}

/**
 * DOM event the widgets fire after a successful mutation so the host drawer can
 * reload. The drawer listens for it and re-fetches the submission detail. The
 * canonical string lives on the drawer module (single source of truth); it is
 * re-exported here so the widgets stay decoupled from the drawer's internals.
 */
export { FORMS_DRAWER_REFRESH_EVENT } from '../../backend/forms/[id]/submissions/components/SubmissionDrawer'
