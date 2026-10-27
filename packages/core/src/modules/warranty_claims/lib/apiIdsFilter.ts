type IdFilterQuery = {
  id?: string | null
  ids?: string[] | null
}

export function applyIdsFilter(filters: Record<string, unknown>, query: IdFilterQuery): void {
  if (query.id) {
    filters.id = { $eq: query.id }
    return
  }
  if (query.ids?.length) filters.id = { $in: query.ids }
}
