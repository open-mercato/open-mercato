import { dataTableExtensionHost, defineModuleExtensionPoints, injectionExtensionHost } from '@open-mercato/shared/modules/widgets/extension-points'

export const extensionPoints = defineModuleExtensionPoints({
  moduleId: 'messages',
  hosts: {
    inboxTable: dataTableExtensionHost({ tableId: 'messages', source: 'components/MessagesInboxPageClient.tsx' }),
    composeFields: injectionExtensionHost({ family: 'generic', spotId: 'crud-form:messages:message:fields', supported: ['render-widget'], source: 'components/ComposeMessagePageClient.tsx' }),
    detailBodyAfter: injectionExtensionHost({ family: 'detail', spotId: 'detail:messages:message:body:after', supported: ['render-widget'], source: 'components/MessageDetailPageClient.tsx' }),
    detailSidebar: injectionExtensionHost({ family: 'detail', spotId: 'detail:messages:message:sidebar', supported: ['render-widget'], source: 'components/MessageDetailPageClient.tsx' }),
  },
})

export default extensionPoints
