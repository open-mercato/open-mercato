import type { MessageObjectTypeDefinition } from '@open-mercato/shared/modules/messages/types'
import { MessageObjectDetail, MessageObjectPreview } from '@open-mercato/ui/backend/messages'

const objectMessageTypes = ['default', 'messages.defaultWithObjects']

export const messageObjectTypes: MessageObjectTypeDefinition[] = [
  {
    module: 'catalog',
    entityType: 'product',
    messageTypes: objectMessageTypes,
    entityId: 'catalog:catalog_product',
    optionLabelField: 'title',
    optionSubtitleField: 'subtitle',
    labelKey: 'catalog.messageObjects.product.title',
    icon: 'package',
    PreviewComponent: MessageObjectPreview,
    DetailComponent: MessageObjectDetail,
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/catalog/products/{entityId}',
      },
    ],
    loadPreview: async (entityId) => {
      return { title: 'Product', subtitle: entityId }
    },
  },
  {
    module: 'catalog',
    entityType: 'variant',
    messageTypes: objectMessageTypes,
    entityId: 'catalog:catalog_product_variant',
    optionLabelField: 'name',
    optionSubtitleField: 'sku',
    labelKey: 'catalog.variants.form.editTitle',
    icon: 'package-plus',
    PreviewComponent: MessageObjectPreview,
    DetailComponent: MessageObjectDetail,
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/catalog/products',
      },
    ],
    loadPreview: async (entityId) => {
      return { title: 'Variant', subtitle: entityId }
    },
  },
  {
    module: 'catalog',
    entityType: 'category',
    messageTypes: objectMessageTypes,
    entityId: 'catalog:catalog_product_category',
    optionLabelField: 'name',
    optionSubtitleField: 'description',
    labelKey: 'catalog.messageObjects.category.title',
    icon: 'tag',
    PreviewComponent: MessageObjectPreview,
    DetailComponent: MessageObjectDetail,
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/catalog/categories/{entityId}/edit',
      },
    ],
    loadPreview: async (entityId) => {
      return { title: 'Category', subtitle: entityId }
    },
  },
]

export default messageObjectTypes
