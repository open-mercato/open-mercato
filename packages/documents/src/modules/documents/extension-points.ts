import { defineModuleExtensionPoints, injectionExtensionHost } from '@open-mercato/shared/modules/widgets/extension-points'

export const extensionPoints = defineModuleExtensionPoints({
  moduleId: 'documents',
  hosts: {
    documentHeader: injectionExtensionHost({
      family: 'detail',
      spotId: 'detail:documents.document:header',
      supported: ['render-widget'],
      contextContract: 'DocumentHeaderInjectionContext: documentId, document, summary (latest review findings summary or null)',
      dataContract: 'Current document detail record (read-only)',
      source: 'backend/documents/[id]/DocumentPageClient.tsx',
    }),
  },
})
