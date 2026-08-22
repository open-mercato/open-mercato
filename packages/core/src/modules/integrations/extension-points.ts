import { defineModuleExtensionPoints, injectionExtensionHost } from '@open-mercato/shared/modules/widgets/extension-points'

export const extensionPoints = defineModuleExtensionPoints({
  moduleId: 'integrations',
  hosts: {
    detail: injectionExtensionHost({
      family: 'integration',
      pattern: 'integrations.detail:{integrationId}',
      parameters: {
        integrationId: { source: 'IntegrationDefinition.id', pattern: '^[a-z0-9_]+$' },
      },
      fallbacks: ['integrations.detail:tabs'],
      supported: ['render-widget'],
      contextContract: 'integrations.detail.v1',
      source: 'backend/integrations/[id]/page.tsx',
    }),
    legacyDetailTabs: injectionExtensionHost({
      family: 'integration',
      spotId: 'integrations.detail:tabs',
      supported: ['render-widget'],
      contextContract: 'integrations.detail.v1',
      source: 'backend/integrations/[id]/page.tsx',
    }),
  },
})

export default extensionPoints
