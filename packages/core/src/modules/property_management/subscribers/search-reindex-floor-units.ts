import { reindexFloorUnits, type SearchReindexContext, type SearchReindexPayload } from '../lib/searchReindex'

export const metadata = {
  event: 'property_management.floor.updated',
  persistent: true,
  id: 'property_management:search-reindex-floor-units',
}

export default async function handle(payload: SearchReindexPayload, ctx: SearchReindexContext): Promise<void> {
  await reindexFloorUnits(payload, ctx)
}
