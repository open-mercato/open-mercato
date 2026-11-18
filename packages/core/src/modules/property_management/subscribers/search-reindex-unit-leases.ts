import { reindexUnitLeases, type SearchReindexContext, type SearchReindexPayload } from '../lib/searchReindex'

export const metadata = {
  event: 'property_management.unit.updated',
  persistent: true,
  id: 'property_management:search-reindex-unit-leases',
}

export default async function handle(payload: SearchReindexPayload, ctx: SearchReindexContext): Promise<void> {
  await reindexUnitLeases(payload, ctx)
}
