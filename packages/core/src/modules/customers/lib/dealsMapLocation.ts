export type DealMapLocationSource = 'company' | 'person'

export type DealMapLocation = {
  latitude: number
  longitude: number
  city: string | null
  region: string | null
  country: string | null
  source: DealMapLocationSource
  entityId: string
  addressId: string
}

export type DealMapLink = {
  dealId: string
  entityId: string
  createdAt?: Date | string | null
}

export type DealMapAddress = {
  id: string
  entityId: string
  isPrimary: boolean
  latitude: number | null | undefined
  longitude: number | null | undefined
  city?: string | null
  region?: string | null
  country?: string | null
  createdAt?: Date | string | null
}

type LocatedAddress = DealMapAddress & { latitude: number; longitude: number }

function hasFiniteCoordinates(address: DealMapAddress): address is LocatedAddress {
  return (
    typeof address.latitude === 'number' &&
    Number.isFinite(address.latitude) &&
    typeof address.longitude === 'number' &&
    Number.isFinite(address.longitude)
  )
}

function toSortableTime(value: Date | string | null | undefined): number {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') {
    const parsed = new Date(value).getTime()
    return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed
  }
  return Number.MAX_SAFE_INTEGER
}

function compareCandidates(a: LocatedAddress, b: LocatedAddress): number {
  if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1
  const timeDiff = toSortableTime(a.createdAt) - toSortableTime(b.createdAt)
  if (timeDiff !== 0) return timeDiff
  return a.id.localeCompare(b.id)
}

function groupLinkEntityIds(links: DealMapLink[]): Map<string, string[]> {
  const entityIdsByDeal = new Map<string, string[]>()
  for (const link of links) {
    if (!link.dealId || !link.entityId) continue
    const bucket = entityIdsByDeal.get(link.dealId) ?? []
    if (!bucket.includes(link.entityId)) bucket.push(link.entityId)
    entityIdsByDeal.set(link.dealId, bucket)
  }
  return entityIdsByDeal
}

function pickLocation(
  entityIds: string[] | undefined,
  addressesByEntity: Map<string, LocatedAddress[]>,
  source: DealMapLocationSource,
): DealMapLocation | null {
  if (!entityIds || entityIds.length === 0) return null
  let best: LocatedAddress | null = null
  for (const entityId of entityIds) {
    const candidate = addressesByEntity.get(entityId)?.[0]
    if (!candidate) continue
    if (!best || compareCandidates(candidate, best) < 0) best = candidate
  }
  if (!best) return null
  return {
    latitude: best.latitude,
    longitude: best.longitude,
    city: best.city ?? null,
    region: best.region ?? null,
    country: best.country ?? null,
    source,
    entityId: best.entityId,
    addressId: best.id,
  }
}

export function resolveDealLocations(
  dealIds: string[],
  companyLinks: DealMapLink[],
  personLinks: DealMapLink[],
  addresses: DealMapAddress[],
): Map<string, DealMapLocation | null> {
  const addressesByEntity = new Map<string, LocatedAddress[]>()
  for (const address of addresses) {
    if (!address.id || !address.entityId) continue
    if (!hasFiniteCoordinates(address)) continue
    const bucket = addressesByEntity.get(address.entityId) ?? []
    bucket.push(address)
    addressesByEntity.set(address.entityId, bucket)
  }
  for (const bucket of addressesByEntity.values()) {
    bucket.sort(compareCandidates)
  }

  const companyEntityIdsByDeal = groupLinkEntityIds(companyLinks)
  const personEntityIdsByDeal = groupLinkEntityIds(personLinks)

  const locations = new Map<string, DealMapLocation | null>()
  for (const dealId of dealIds) {
    const companyLocation = pickLocation(companyEntityIdsByDeal.get(dealId), addressesByEntity, 'company')
    locations.set(
      dealId,
      companyLocation ?? pickLocation(personEntityIdsByDeal.get(dealId), addressesByEntity, 'person'),
    )
  }
  return locations
}
