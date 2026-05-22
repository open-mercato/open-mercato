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

export type BackendChromePayload = {
  groups: BackendChromeNavGroup[]
  settingsSections: BackendChromeSectionGroup[]
  settingsPathPrefixes: string[]
  profileSections: BackendChromeSectionGroup[]
  profilePathPrefixes: string[]
  grantedFeatures: string[]
  roles: string[]
}
