import { defineModuleExtensionPoints, injectionExtensionHost } from '@open-mercato/shared/modules/widgets/extension-points'

/**
 * Injection hosts the submission drawer mounts. The drawer renders only the
 * `<InjectionSpot>` mount points; the PDF download trigger, the anonymize
 * action, the access-audit trail and the "this view is logged" note all live in
 * `widgets/injection/` and are mapped onto these spots by
 * `widgets/injection-table.ts`, so a third-party module can copy the pattern
 * unchanged.
 */
export const extensionPoints = defineModuleExtensionPoints({
  moduleId: 'forms',
  hosts: {
    submissionDrawerHeaderActions: injectionExtensionHost({
      family: 'detail',
      spotId: 'submission-drawer:header-actions',
      supported: ['render-widget'],
      source: 'backend/forms/[id]/submissions/components/SubmissionDrawer.tsx',
    }),
    submissionDrawerAnonymizeAction: injectionExtensionHost({
      family: 'detail',
      spotId: 'submission-drawer:anonymize-action',
      supported: ['render-widget'],
      source: 'backend/forms/[id]/submissions/components/SubmissionDrawer.tsx',
    }),
    submissionDrawerAccessAudit: injectionExtensionHost({
      family: 'detail',
      spotId: 'submission-drawer:access-audit',
      supported: ['render-widget'],
      source: 'backend/forms/[id]/submissions/components/SubmissionDrawer.tsx',
    }),
    submissionDrawerFooter: injectionExtensionHost({
      family: 'detail',
      spotId: 'submission-drawer:footer',
      supported: ['render-widget'],
      source: 'backend/forms/[id]/submissions/components/SubmissionDrawer.tsx',
    }),
  },
})

export default extensionPoints
