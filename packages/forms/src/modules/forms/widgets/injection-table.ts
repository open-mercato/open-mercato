import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

/**
 * Phase 2b — forms submission-drawer injection table.
 *
 * Maps the four compliance widgets onto the FROZEN spot IDs declared by the
 * phase-2a submission drawer (`SubmissionDrawer.tsx`):
 *
 *   - `submission-drawer:header-actions`  → PDF snapshot download
 *   - `submission-drawer:anonymize-action`→ irreversible anonymize action
 *   - `submission-drawer:access-audit`    → access-audit trail panel
 *   - `submission-drawer:footer`          → "this view is logged" note
 *
 * The drawer page only renders the shared `<InjectionSpot>` mount points; the
 * triggers, dialogs, fetch logic, and download flow all live in the injection
 * widgets so third-party modules can copy the pattern unchanged.
 */
export const injectionTable: ModuleInjectionTable = {
  'submission-drawer:header-actions': [
    {
      widgetId: 'forms.injection.pdf-download-button',
      priority: 100,
    },
  ],
  'submission-drawer:anonymize-action': [
    {
      widgetId: 'forms.injection.anonymize-button',
      priority: 100,
    },
  ],
  'submission-drawer:access-audit': [
    {
      widgetId: 'forms.injection.access-audit-panel',
      priority: 100,
    },
  ],
  'submission-drawer:footer': [
    {
      widgetId: 'forms.injection.self-audit-footer',
      priority: 100,
    },
  ],
}

export default injectionTable
