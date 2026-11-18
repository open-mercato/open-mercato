import { reindexBuildingUnits, type SearchReindexContext, type SearchReindexPayload } from '../lib/searchReindex'

export const metadata = {
  event: 'property_management.building.updated',
  persistent: true,
  id: 'property_management:search-reindex-building-units',
}

export default async function handle(payload: SearchReindexPayload, ctx: SearchReindexContext): Promise<void> {
  await reindexBuildingUnits(payload, ctx)
}
