import type { MessageObjectTypeDefinition } from '@open-mercato/shared/modules/messages/types'
import { CustomerMessageObjectDetail } from './components/CustomerMessageObjectDetail'
import { CustomerMessageObjectPreview } from './components/CustomerMessageObjectPreview'

const objectMessageTypes = ['default', 'messages.defaultWithObjects']

export const messageObjectTypes: MessageObjectTypeDefinition[] = [
  {
    module: 'customers',
    entityType: 'person',
    messageTypes: objectMessageTypes,
    entityId: 'customers:customer_person_profile',
    optionLabelField: 'name',
    optionSubtitleField: 'email',
    labelKey: 'customers.people.list.title',
    icon: 'user-round',
    PreviewComponent: CustomerMessageObjectPreview,
    DetailComponent: CustomerMessageObjectDetail,
    actions: [],
    loadPreview: async (entityId, ctx) => {
      if (typeof window !== 'undefined') {
        return { title: 'Person', subtitle: entityId }
      }
      const { loadCustomerPersonPreview } = await import('./lib/messageObjectPreviews')
      return loadCustomerPersonPreview(entityId, ctx)
    },
  },
  {
    module: 'customers',
    entityType: 'company',
    messageTypes: objectMessageTypes,
    entityId: 'customers:customer_company_profile',
    optionLabelField: 'name',
    optionSubtitleField: 'taxId',
    labelKey: 'customers.companies.list.title',
    icon: 'building2',
    PreviewComponent: CustomerMessageObjectPreview,
    DetailComponent: CustomerMessageObjectDetail,
    actions: [],
    loadPreview: async (entityId, ctx) => {
      if (typeof window !== 'undefined') {
        return { title: 'Company', subtitle: entityId }
      }
      const { loadCustomerCompanyPreview } = await import('./lib/messageObjectPreviews')
      return loadCustomerCompanyPreview(entityId, ctx)
    },
  },
  {
    module: 'customers',
    entityType: 'deal',
    messageTypes: objectMessageTypes,
    entityId: 'customers:customer_deal',
    optionLabelField: 'title',
    optionSubtitleField: 'status',
    labelKey: 'customers.deals.list.title',
    icon: 'briefcase-business',
    PreviewComponent: CustomerMessageObjectPreview,
    DetailComponent: CustomerMessageObjectDetail,
    actions: [],
    loadPreview: async (entityId, ctx) => {
      if (typeof window !== 'undefined') {
        return { title: 'Deal', subtitle: entityId }
      }
      const { loadCustomerDealPreview } = await import('./lib/messageObjectPreviews')
      return loadCustomerDealPreview(entityId, ctx)
    },
  },
]

export default messageObjectTypes
