import { dataTableExtensionHost, defineModuleExtensionPoints, injectionExtensionHost } from '@open-mercato/shared/modules/widgets/extension-points'

export const extensionPoints = defineModuleExtensionPoints({
  moduleId: 'communication_channels',
  hosts: {
    channelsTable: dataTableExtensionHost({ tableId: 'communication_channels.channels', source: 'backend/communication_channels/channels/page.tsx' }),
    profileConnect: injectionExtensionHost({
      family: 'generic',
      spotId: 'profile:communication-channels:connect',
      supported: ['render-widget'],
      source: 'backend/profile/communication-channels/page.tsx',
    }),
    profileChannelsTable: dataTableExtensionHost({ tableId: 'communication_channels.profile.channels', source: 'backend/profile/communication-channels/page.tsx' }),
  },
})

export default extensionPoints
