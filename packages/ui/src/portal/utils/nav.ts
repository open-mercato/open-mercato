import type { FrontendRouteManifestEntry } from '@open-mercato/shared/modules/registry'
import { hasAllFeatures } from '@open-mercato/shared/security/features'

export type PortalNavGroupId = 'main' | 'account'

export type PortalNavItem = {
  id: string
  label: string
  labelKey?: string
  href: string
  icon?: string
  order: number
}

export type PortalNavGroup = {
  id: PortalNavGroupId
  items: PortalNavItem[]
}

export type BuildPortalNavOptions = {
  /** Route manifest to inspect (typically `getFrontendRouteManifests()`). */
  routes: readonly FrontendRouteManifestEntry[]
  /** Current customer org slug — substituted into `[orgSlug]` patterns. */
  orgSlug: string
  /** Feature strings granted to the current customer (may include wildcards). */
  grantedFeatures: readonly string[]
  /** If true, bypass feature checks (portal admin). Defaults to false. */
  isPortalAdmin?: boolean
}

function isPortalPattern(pattern: string | undefined): pattern is string {
  if (!pattern) return false
  return pattern.startsWith('/[orgSlug]/portal/') || pattern === '/[orgSlug]/portal'
}

function hasNoUnresolvedParams(href: string): boolean {
  return !href.includes('[')
}

function resolveHref(pattern: string, orgSlug: string): string {
  return pattern.replace('[orgSlug]', orgSlug)
}

function pickGroup(group: unknown): PortalNavGroupId {
  if (group === 'main' || group === 'account') return group
  return 'main'
}

function pickPreferredRoute(
  existing: FrontendRouteManifestEntry,
  candidate: FrontendRouteManifestEntry,
): FrontendRouteManifestEntry {
  const existingFeatures = existing.requireCustomerFeatures ?? []
  const candidateFeatures = candidate.requireCustomerFeatures ?? []
  if (existingFeatures.length === 0 && candidateFeatures.length > 0) return candidate
  if (candidateFeatures.length === 0 && existingFeatures.length > 0) return existing
  if (existingFeatures.length !== candidateFeatures.length) {
    return candidateFeatures.length > existingFeatures.length ? candidate : existing
  }
  return existing
}

/**
 * Build the portal sidebar from the frontend route manifest.
 *
 * Mirrors `buildAdminNav()` for the portal surface: selects routes under
 * `/[orgSlug]/portal/*` that declare a `nav` block, applies
 * `requireCustomerFeatures` against the caller's grants (wildcards honored),
 * and returns ordered sidebar groups.
 *
 * Absence of `nav` on a metadata file means the page is routable but not
 * auto-listed — useful for detail/create pages.
 */
export function buildPortalNav({
  routes,
  orgSlug,
  grantedFeatures,
  isPortalAdmin = false,
}: BuildPortalNavOptions): PortalNavGroup[] {
  const mainItems: PortalNavItem[] = []
  const accountItems: PortalNavItem[] = []

  const dedupedByPattern = new Map<string, FrontendRouteManifestEntry>()
  for (const route of routes) {
    const pattern = route.pattern ?? route.path
    if (!isPortalPattern(pattern)) continue
    if (route.navHidden) continue
    const nav = route.nav
    if (!nav || typeof nav.label !== 'string' || nav.label.length === 0) continue
    const existing = dedupedByPattern.get(pattern)
    dedupedByPattern.set(pattern, existing ? pickPreferredRoute(existing, route) : route)
  }

  for (const route of dedupedByPattern.values()) {
    const pattern = (route.pattern ?? route.path) as string
    const nav = route.nav!

    const requireFeatures = route.requireCustomerFeatures ?? []
    if (!isPortalAdmin && requireFeatures.length) {
      if (!hasAllFeatures(grantedFeatures as string[], requireFeatures as string[])) continue
    }

    const href = resolveHref(pattern, orgSlug)
    if (!hasNoUnresolvedParams(href)) continue

    const group = pickGroup(nav.group)
    const item: PortalNavItem = {
      id: `portal-nav:${pattern}`,
      label: nav.label,
      labelKey: nav.labelKey,
      href,
      icon: nav.icon,
      order: typeof nav.order === 'number' ? nav.order : 100,
    }
    if (group === 'account') accountItems.push(item)
    else mainItems.push(item)
  }

  const sortItems = (items: PortalNavItem[]) =>
    items.sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order
      return a.label.localeCompare(b.label)
    })

  sortItems(mainItems)
  sortItems(accountItems)

  const groups: PortalNavGroup[] = []
  if (mainItems.length) groups.push({ id: 'main', items: mainItems })
  if (accountItems.length) groups.push({ id: 'account', items: accountItems })
  return groups
}

/**
 * Merge sidebar groups from the portal nav endpoint with items contributed via
 * `usePortalInjectedMenuItems`. Auto-discovered entries take precedence —
 * injected items with matching `id` or `href` are dropped as duplicates.
 */
export function mergePortalSidebarGroupsWithInjected<TInjected extends { id: string; href?: string }>(
  discovered: readonly PortalNavGroup[],
  injected: {
    main: readonly TInjected[]
    account: readonly TInjected[]
  },
): {
  main: Array<PortalNavItem | TInjected>
  account: Array<PortalNavItem | TInjected>
} {
  const mergeGroup = <T extends PortalNavItem | TInjected>(
    base: readonly PortalNavItem[],
    extra: readonly TInjected[],
  ): Array<PortalNavItem | TInjected> => {
    const knownIds = new Set(base.map((item) => item.id))
    const knownHrefs = new Set(base.map((item) => item.href).filter((href): href is string => Boolean(href)))
    const merged: Array<PortalNavItem | TInjected> = [...base]
    for (const item of extra) {
      if (knownIds.has(item.id)) continue
      if (item.href && knownHrefs.has(item.href)) continue
      merged.push(item)
      knownIds.add(item.id)
      if (item.href) knownHrefs.add(item.href)
    }
    return merged
  }

  const mainBase = discovered.find((g) => g.id === 'main')?.items ?? []
  const accountBase = discovered.find((g) => g.id === 'account')?.items ?? []
  return {
    main: mergeGroup(mainBase, injected.main),
    account: mergeGroup(accountBase, injected.account),
  }
}
