import { buildCollectionTags, canonicalizeResourceTag } from '@open-mercato/shared/lib/crud/cache'

/**
 * Resources whose collection tags the cached person-detail payload depends on.
 *
 * Single source of truth, shared by the READ side (`api/people/[id]/route.ts`,
 * which stores under these tags) and every WRITE side that must invalidate them.
 * Hand-formatting the tag strings at a write site is how they silently stop
 * matching: the canonical shape is `crud:<resource>:tenant:<t>:org:<o>:collection`
 * and it is produced only by `buildCollectionTags`.
 */
export const PERSON_DETAIL_TAG_RESOURCES = [
  'customers.person',
  'customers.address',
  'customers.tagAssignment',
  'customers.labelAssignment',
  'customers.personCompanyLink',
  'customers.interaction',
  'customers.activity',
] as const

/**
 * Collection tags the cached person-detail payload is stored under.
 *
 * The resource ids are canonicalized with `canonicalizeResourceTag` (they are
 * already canonical today, but going through the helper keeps this aligned if the
 * canonical form ever changes).
 */
export function buildPersonDetailCacheTags(
  tenantId: string | null,
  organizationId: string | null,
): string[] {
  const tags: string[] = []
  for (const resource of PERSON_DETAIL_TAG_RESOURCES) {
    const canonical = canonicalizeResourceTag(resource) ?? resource
    tags.push(...buildCollectionTags(canonical, tenantId, [organizationId]))
  }
  return tags
}

type CacheLike = { invalidateTags?: (tags: string[]) => Promise<void> }

/**
 * Invalidate the person-detail collection tags after a write that widens or
 * narrows email visibility.
 *
 * Both email-sharing write paths (per-Person conversation share, whole-channel
 * flag) change which rows the read filter admits without writing any resource the
 * person-detail cache tags observe, so neither would otherwise invalidate. The
 * revoke direction is the one that matters: without this a teammate keeps reading
 * now-private email from their own warm cache entry until the TTL expires.
 *
 * Best effort — a stale cached page is a TTL-bounded annoyance, and the write is
 * already committed by the time this runs.
 */
export async function invalidatePersonDetailCache(
  container: { resolve: (name: string) => unknown },
  tenantId: string | null,
  organizationId: string | null,
): Promise<void> {
  try {
    const cache = container.resolve('cache') as CacheLike | undefined
    if (!cache?.invalidateTags) return
    await cache.invalidateTags(buildPersonDetailCacheTags(tenantId, organizationId))
  } catch {
    /* best effort — never fail a committed write over cache invalidation */
  }
}
