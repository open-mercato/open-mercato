import { defineModuleExtensionPoints, injectionExtensionHost } from '@open-mercato/shared/modules/widgets/extension-points'

export const extensionPoints = defineModuleExtensionPoints({
  moduleId: 'configs',
  hosts: {
    systemStatusDetails: injectionExtensionHost({
      family: 'detail',
      spotId: 'configs.system_status:details',
      supported: ['render-widget'],
      source: 'backend/config/system-status/page.tsx',
    }),
    queuesStatusDetails: injectionExtensionHost({
      family: 'detail',
      spotId: 'configs.queues_status:details',
      supported: ['render-widget'],
      source: 'backend/config/queues-status/page.tsx',
    }),
  },
})

export default extensionPoints
