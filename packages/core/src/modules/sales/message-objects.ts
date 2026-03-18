import type { MessageObjectTypeDefinition } from '@open-mercato/shared/modules/messages/types'
import { MessageObjectDetail, MessageObjectPreview } from '@open-mercato/ui/backend/messages'
import { SalesDocumentMessageDetail } from './widgets/messages/SalesDocumentMessageDetail'
import { SalesDocumentMessagePreview } from './widgets/messages/SalesDocumentMessagePreview'

const objectMessageTypes = ['default', 'messages.defaultWithObjects']

export const messageObjectTypes: MessageObjectTypeDefinition[] = [
  {
    module: 'sales',
    entityType: 'order',
    messageTypes: objectMessageTypes,
    entityId: 'sales:sales_order',
    optionLabelField: 'number',
    optionSubtitleField: 'status',
    labelKey: 'sales.documents.detail.order',
    icon: 'receipt-text',
    PreviewComponent: SalesDocumentMessagePreview,
    DetailComponent: SalesDocumentMessageDetail,
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/sales/orders/{entityId}',
      },
    ],
    loadPreview: async (entityId, ctx) => {
      if (typeof window !== 'undefined') {
        return {
          title: 'Sales order',
          subtitle: entityId,
        }
      }
      const { loadSalesOrderPreview } = await import('./lib/messageObjectPreviews')
      return loadSalesOrderPreview(entityId, ctx)
    },
  },
  {
    module: 'sales',
    entityType: 'quote',
    messageTypes: objectMessageTypes,
    entityId: 'sales:sales_quote',
    optionLabelField: 'number',
    optionSubtitleField: 'status',
    labelKey: 'sales.documents.detail.quote',
    icon: 'file-text',
    PreviewComponent: SalesDocumentMessagePreview,
    DetailComponent: SalesDocumentMessageDetail,
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/sales/quotes/{entityId}',
      },
    ],
    loadPreview: async (entityId, ctx) => {
      if (typeof window !== 'undefined') {
        return {
          title: 'Sales quote',
          subtitle: entityId,
        }
      }
      const { loadSalesQuotePreview } = await import('./lib/messageObjectPreviews')
      return loadSalesQuotePreview(entityId, ctx)
    },
  },
  {
    module: 'sales',
    entityType: 'channel',
    messageTypes: objectMessageTypes,
    entityId: 'sales:sales_channel',
    optionLabelField: 'name',
    optionSubtitleField: 'status',
    labelKey: 'sales.messageObjects.channel.title',
    icon: 'store',
    PreviewComponent: MessageObjectPreview,
    DetailComponent: MessageObjectDetail,
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/sales/channels/{entityId}/edit',
      },
    ],
    loadPreview: async (entityId, ctx) => {
      if (typeof window !== 'undefined') {
        return { title: 'Sales channel', subtitle: entityId }
      }
      const { loadSalesChannelPreview } = await import('./lib/messageObjectPreviews')
      return loadSalesChannelPreview(entityId, ctx)
    },
  },
]

export default messageObjectTypes
