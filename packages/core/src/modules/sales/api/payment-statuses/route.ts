import { E } from '#generated/entities.ids.generated'
import * as F from '#generated/entities/dictionary_entry'
import { makeStatusDictionaryRoute } from '../../lib/makeStatusDictionaryRoute'

const route = makeStatusDictionaryRoute({
  kind: 'payment-status',
  entityId: E.dictionaries.dictionary_entry,
  fieldConstants: F,
  openApi: {
    resourceName: 'Payment status',
    pluralName: 'Payment statuses',
    description: 'Manage the lifecycle states available for payments.',
  },
})

export const metadata = route.metadata
export const openApi = route.openApi
export const GET = route.GET
export const POST = route.POST
export const PUT = route.PUT
export const DELETE = route.DELETE
