export type BackendChromePageContext = 'main' | 'admin' | 'settings' | 'profile'

export type BackendChromeNavItem = {
  id?: string
  href: string
  title: string
  defaultTitle?: string
  enabled?: boolean
  hidden?: boolean
  pageContext?: BackendChromePageContext
  iconName?: string
  iconMarkup?: string
  /**
   * The weight this item was sorted by: `pagePriority` when the page declared one, else `pageOrder`,
   * else a large fallback so undeclared pages sort last. Always a number, so re-sorting by it
   * reproduces the order the payload shipped in; the field exists so ordering is inspectable rather
   * than implied by array position (#4845).
   *
   * Note this is NOT the same precedence as `BackendChromeSectionItem.order`, which resolves
   * `order ?? priority ?? 100` for the settings/profile sidebars. A page rendered in both surfaces can
   * legitimately report a different weight in each.
   */
  order?: number
  children?: BackendChromeNavItem[]
}

export type BackendChromeNavGroup = {
  id?: string
  name: string
  defaultName?: string
  items: BackendChromeNavItem[]
}

export type BackendChromeSectionItem = {
  id: string
  label: string
  labelKey?: string
  href: string
  order?: number
  iconName?: string
  iconMarkup?: string
  children?: BackendChromeSectionItem[]
}

export type BackendChromeSectionGroup = {
  id: string
  label: string
  labelKey?: string
  items: BackendChromeSectionItem[]
  order?: number
}

export type BackendChromeBrand = {
  name?: string
  logo?: {
    src: string
    alt?: string
    preserveAspectRatio?: boolean
  } | null
}

/**
 * The organization the current request is scoped to, resolved server-side.
 *
 * Distinct from `brand`, which is a *branding* channel and only populates when the organization has a
 * logo configured. This is always present when a single organization is in scope, so UI can label
 * "you are viewing: <name>" without a second round trip. `null` under an all-organizations selection,
 * when no organization is in scope, or when the lookup fails.
 */
export type BackendChromeCurrentOrganization = {
  id: string
  name: string
}

export type BackendChromePayload = {
  groups: BackendChromeNavGroup[]
  settingsSections: BackendChromeSectionGroup[]
  settingsPathPrefixes: string[]
  profileSections: BackendChromeSectionGroup[]
  profilePathPrefixes: string[]
  grantedFeatures: string[]
  roles: string[]
  brand?: BackendChromeBrand | null
  currentOrganization?: BackendChromeCurrentOrganization | null
}
