"use client"
import * as React from 'react'
import { createContext, useContext } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { ChevronDown, ChevronLeft, Search, Settings, X } from 'lucide-react'
import { Button } from '../primitives/button'
import { IconButton } from '../primitives/icon-button'
import { Input } from '../primitives/input'
import { Checkbox } from '../primitives/checkbox'
import { Separator } from '../primitives/separator'
import { FlashMessages } from './FlashMessages'
import { QueryProvider } from '../theme/QueryProvider'
import { usePathname, useSearchParams } from 'next/navigation'
import { apiCall } from './utils/apiCall'
import { LastOperationBanner } from './operations/LastOperationBanner'
import { ProgressTopBar } from './progress/ProgressTopBar'
import { UpgradeActionBanner } from './upgrades/UpgradeActionBanner'
import { PartialIndexBanner } from './indexes/PartialIndexBanner'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { slugifySidebarId } from '@open-mercato/shared/modules/navigation/sidebarPreferences'
import { cloneSidebarGroups } from './sidebar/customization-helpers'
import type { SectionNavGroup } from './section-page/types'
import { InjectionSpot } from './injection/InjectionSpot'
import type { InjectionMenuItem } from '@open-mercato/shared/modules/widgets/injection'
import { LEGACY_GLOBAL_MUTATION_INJECTION_SPOT_ID } from './injection/mutationEvents'
import { mergeMenuItems } from './injection/mergeMenuItems'
import { useInjectedMenuItems } from './injection/useInjectedMenuItems'
import { resolveInjectedIcon } from './injection/resolveInjectedIcon'
import { useEventBridge } from './injection/eventBridge'
import { StatusBadgeInjectionSpot } from './injection/StatusBadgeInjectionSpot'
import { UmesDevToolsPanel } from './devtools'
import { BackendChromeProvider, useBackendChrome } from './BackendChromeProvider'
import {
  BACKEND_LAYOUT_FOOTER_INJECTION_SPOT_ID,
  BACKEND_LAYOUT_TOP_INJECTION_SPOT_ID,
  BACKEND_RECORD_CURRENT_INJECTION_SPOT_ID,
  BACKEND_SIDEBAR_FOOTER_INJECTION_SPOT_ID,
  BACKEND_SIDEBAR_TOP_INJECTION_SPOT_ID,
  BACKEND_SIDEBAR_NAV_FOOTER_INJECTION_SPOT_ID,
  BACKEND_SIDEBAR_NAV_INJECTION_SPOT_ID,
  BACKEND_TOPBAR_ACTIONS_INJECTION_SPOT_ID,
  GLOBAL_HEADER_STATUS_INDICATORS_INJECTION_SPOT_ID,
  GLOBAL_SIDEBAR_STATUS_BADGES_INJECTION_SPOT_ID,
} from './injection/spotIds'

export type ShellLogo = {
  src: string
  alt?: string
}

export type AppShellProps = {
  productName?: string
  logo?: ShellLogo
  email?: string
  groups: {
    id?: string
    name: string
    defaultName?: string
    items: {
      id?: string
      href: string
      title: string
      defaultTitle?: string
      icon?: React.ReactNode
      iconName?: string
      iconMarkup?: string
      enabled?: boolean
      hidden?: boolean
      pageContext?: 'main' | 'admin' | 'settings' | 'profile'
      children?: {
        id?: string
        href: string
        title: string
        defaultTitle?: string
        icon?: React.ReactNode
        iconName?: string
        iconMarkup?: string
        enabled?: boolean
        hidden?: boolean
        pageContext?: 'main' | 'admin' | 'settings' | 'profile'
      }[]
    }[]
  }[]
  children: React.ReactNode
  rightHeaderSlot?: React.ReactNode
  sidebarCollapsedDefault?: boolean
  currentTitle?: string
  breadcrumb?: Array<{ label: string; href?: string }>
  // Optional: full admin nav API to refresh sidebar client-side
  adminNavApi?: string
  version?: string
  settingsSectionTitle?: string
  settingsPathPrefixes?: string[]
  settingsSections?: SectionNavGroup[]
  profileSections?: SectionNavGroup[]
  profileSectionTitle?: string
  profilePathPrefixes?: string[]
  mobileSidebarSlot?: React.ReactNode
}

type Breadcrumb = Array<{ label: string; href?: string }>

type SidebarGroup = AppShellProps['groups'][number]
type SidebarItem = SidebarGroup['items'][number]

function convertInjectedMenuItemToSidebarItem(item: InjectionMenuItem, title: string): SidebarItem | null {
  if (!item.href) return null
  return {
    id: item.id,
    href: item.href,
    title,
    defaultTitle: title,
    icon: resolveInjectedIcon(item.icon) ?? undefined,
    iconName: item.icon,
    enabled: true,
    hidden: false,
    pageContext: 'main',
  }
}

function resolveInjectedMenuLabel(
  item: { id: string; label?: string; labelKey?: string },
  t: (key: string, fallback?: string) => string,
): string {
  if (item.labelKey && item.label) return t(item.labelKey, item.label)
  if (item.labelKey) return t(item.labelKey, item.id)
  if (item.label && item.label.includes('.')) return t(item.label, item.id)
  return item.label ?? item.id
}

function mergeSidebarItemsWithInjected(
  items: SidebarItem[],
  injectedItems: InjectionMenuItem[],
  t: (key: string, fallback?: string) => string,
): SidebarItem[] {
  if (injectedItems.length === 0) return items

  const builtInById = new Map<string, SidebarItem>()
  for (const item of items) {
    builtInById.set(item.id ?? item.href, item)
  }

  const merged = mergeMenuItems(
    items.map((item) => ({
      id: item.id ?? item.href,
    })),
    injectedItems,
  )

  const result: SidebarItem[] = []
  for (const entry of merged) {
    if (entry.source === 'built-in') {
      const original = builtInById.get(entry.id)
      if (original) result.push(original)
      continue
    }
    const translatedLabel = resolveInjectedMenuLabel(
      { id: entry.id, label: entry.label, labelKey: entry.labelKey },
      t,
    )
    const converted = convertInjectedMenuItemToSidebarItem(
      {
        id: entry.id,
        label: translatedLabel,
        icon: entry.icon,
        href: entry.href,
      },
      translatedLabel,
    )
    if (converted) result.push(converted)
  }

  return result
}

function mergeSidebarGroupsWithInjected(
  groups: SidebarGroup[],
  injectedItems: InjectionMenuItem[],
  t: (key: string, fallback?: string) => string,
): SidebarGroup[] {
  if (injectedItems.length === 0) return groups

  const injectedByGroup = new Map<string, InjectionMenuItem[]>()
  const ungrouped: InjectionMenuItem[] = []

  for (const item of injectedItems) {
    if (item.groupId && item.groupId.trim().length > 0) {
      const groupItems = injectedByGroup.get(item.groupId) ?? []
      groupItems.push(item)
      injectedByGroup.set(item.groupId, groupItems)
      continue
    }
    ungrouped.push(item)
  }

  const nextGroups = groups.map((group, index) => {
    const groupId = group.id || resolveGroupKey(group)
    const groupInjected = [
      ...(injectedByGroup.get(groupId) ?? []),
      ...(index === 0 ? ungrouped : []),
    ]
    return {
      ...group,
      items: mergeSidebarItemsWithInjected(group.items, groupInjected, t),
    }
  })

  const existingIds = new Set(nextGroups.map((group) => group.id || resolveGroupKey(group)))
  for (const [groupId, items] of injectedByGroup.entries()) {
    if (existingIds.has(groupId)) continue
    const first = items[0]
    const label = first.groupLabelKey
      ? t(first.groupLabelKey, first.groupLabel ?? groupId)
      : (first.groupLabel ?? groupId)
    const groupItems = mergeSidebarItemsWithInjected([], items, t)
    if (groupItems.length === 0) continue
    nextGroups.push({
      id: groupId,
      name: label,
      defaultName: label,
      items: groupItems,
    })
  }

  return nextGroups
}

function mergeSectionGroupsWithInjected(
  sections: SectionNavGroup[],
  injectedItems: InjectionMenuItem[],
  t: (key: string, fallback?: string) => string,
): SectionNavGroup[] {
  if (injectedItems.length === 0) return sections
  const byGroup = new Map<string, InjectionMenuItem[]>()
  for (const item of injectedItems) {
    const groupId = item.groupId && item.groupId.trim().length > 0 ? item.groupId : 'injected'
    const bucket = byGroup.get(groupId) ?? []
    bucket.push(item)
    byGroup.set(groupId, bucket)
  }

  const nextSections = sections.map((section) => {
    const sectionItems = byGroup.get(section.id) ?? []
    if (sectionItems.length === 0) return section
    const mergedItems = mergeMenuItems(
      section.items.map((item) => ({ id: item.id, item })),
      sectionItems,
    ).flatMap((item) => {
      if (item.source === 'built-in') {
        const original = section.items.find((entry) => entry.id === item.id)
        return original ? [original] : []
      }
      if (!item.href) return []
      const label = resolveInjectedMenuLabel(item, t)
      return [{
        id: item.id,
        label,
        href: item.href,
        icon: resolveInjectedIcon(item.icon) ?? undefined,
      }]
    })
    return {
      ...section,
      items: mergedItems,
    }
  })

  for (const [sectionId, sectionItems] of byGroup.entries()) {
    const exists = nextSections.some((section) => section.id === sectionId)
    if (exists) continue
    const first = sectionItems[0]
    const label = first.groupLabelKey
      ? t(first.groupLabelKey, first.groupLabel ?? sectionId)
      : (first.groupLabel ?? sectionId)
    const items = sectionItems.flatMap((item) => {
      if (!item.href) return []
      const itemLabel = resolveInjectedMenuLabel(item, t)
      return [{
        id: item.id,
        label: itemLabel,
        href: item.href,
        icon: resolveInjectedIcon(item.icon) ?? undefined,
      }]
    })
    if (items.length === 0) continue
    nextSections.push({ id: sectionId, label, items })
  }

  return nextSections
}

function resolveGroupKey(group: SidebarGroup): string {
  if (group.id && group.id.length) return group.id
  if (group.defaultName && group.defaultName.length) return slugifySidebarId(group.defaultName)
  return slugifySidebarId(group.name)
}

function resolveItemKey(item: { id?: string; href: string }): string {
  const candidate = item.id?.trim()
  if (candidate && candidate.length > 0) return candidate
  return item.href
}

function SerializedIcon({ markup }: { markup: string }) {
  return <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: markup }} />
}

function renderIcon(
  icon: React.ReactNode | undefined,
  iconName: string | undefined,
  iconMarkup: string | undefined,
  fallback: React.ReactNode,
) {
  if (icon) return icon
  if (iconName) {
    const resolved = resolveInjectedIcon(iconName)
    if (resolved) return resolved
  }
  if (iconMarkup) return <SerializedIcon markup={iconMarkup} />
  return fallback
}

const HeaderContext = createContext<{
  setBreadcrumb: (b?: Breadcrumb) => void
  setTitle: (t?: string) => void
} | null>(null)

export function ApplyBreadcrumb({ breadcrumb, title, titleKey }: { breadcrumb?: Array<{ label: string; href?: string; labelKey?: string }>; title?: string; titleKey?: string }) {
  const ctx = useContext(HeaderContext)
  const t = useT()
  const resolvedBreadcrumb = React.useMemo<Breadcrumb | undefined>(() => {
    if (!breadcrumb) return undefined
    return breadcrumb.map(({ label, labelKey, href }) => {
      const translated = labelKey ? t(labelKey) : undefined
      const finalLabel = translated && translated !== labelKey ? translated : label
      return {
        href,
        label: finalLabel,
      }
    })
  }, [breadcrumb, t])
  const resolvedTitle = React.useMemo(() => {
    if (!titleKey) return title
    const translated = t(titleKey)
    if (translated && translated !== titleKey) return translated
    return title
  }, [titleKey, title, t])
  React.useEffect(() => {
    ctx?.setBreadcrumb(resolvedBreadcrumb)
    if (resolvedTitle !== undefined) ctx?.setTitle(resolvedTitle)
  }, [ctx, resolvedBreadcrumb, resolvedTitle])
  return null
}

const DefaultIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M8 6h13M8 12h13M8 18h13"/>
    <path d="M3 6h.01M3 12h.01M3 18h.01"/>
  </svg>
)

// DataTable icon used for dynamic custom entity records links
const DataTableIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="4" width="18" height="16" rx="2" ry="2"/>
    <line x1="3" y1="8" x2="21" y2="8"/>
    <line x1="9" y1="8" x2="9" y2="20"/>
    <line x1="15" y1="8" x2="15" y2="20"/>
  </svg>
)

const CustomizeIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.05.05a2 2 0 1 1-2.83 2.83l-.05-.05A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 .6 1.65 1.65 0 0 0-.33 1.82l-.05.05a2 2 0 1 1-2.83-2.83l.05-.05A1.65 1.65 0 0 0 9 15a1.65 1.65 0 0 0-1-.6 1.65 1.65 0 0 0-1.82.33l-.05.05a2 2 0 1 1-2.83-2.83l.05-.05A1.65 1.65 0 0 0 4.6 9 1.65 1.65 0 0 0 4 8a1.65 1.65 0 0 0-.6-1.82l-.05-.05a2 2 0 1 1 2.83-2.83l.05.05A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-.6 1.65 1.65 0 0 0 .33-1.82l.05-.05a2 2 0 1 1 2.83 2.83l-.05.05A1.65 1.65 0 0 0 15 9a1.65 1.65 0 0 0 1 .6 1.65 1.65 0 0 0 1.82-.33l.05-.05a2 2 0 1 1 2.83 2.83l-.05.05A1.65 1.65 0 0 0 19.4 15z" />
  </svg>
)

const BackArrowIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 12H5M12 19l-7-7 7-7" />
  </svg>
)

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={`transition-transform ${open ? 'rotate-180' : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
  )
}

export function AppShell(props: AppShellProps) {
  return (
    <QueryProvider>
      <BackendChromeProvider adminNavApi={props.adminNavApi}>
        <AppShellBody {...props} />
      </BackendChromeProvider>
    </QueryProvider>
  )
}

function AppShellBody({ productName, logo, email, groups, rightHeaderSlot, children, sidebarCollapsedDefault = false, currentTitle, breadcrumb, version, settingsSectionTitle, settingsPathPrefixes = [], settingsSections, profileSections, profileSectionTitle, profilePathPrefixes = [], mobileSidebarSlot }: AppShellProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const t = useT()
  const locale = useLocale()
  const { payload: chromePayload, isReady: isChromeReady, isLoading: isChromeLoading } = useBackendChrome()
  const resolvedGroups = React.useMemo(
    () => cloneSidebarGroups(chromePayload?.groups ?? groups),
    [chromePayload?.groups, groups],
  )
  const resolvedSettingsSections = chromePayload?.settingsSections ?? settingsSections
  const resolvedSettingsPathPrefixes = chromePayload?.settingsPathPrefixes ?? settingsPathPrefixes
  const resolvedProfileSections = chromePayload?.profileSections ?? profileSections
  const resolvedProfilePathPrefixes = chromePayload?.profilePathPrefixes ?? profilePathPrefixes
  const { items: mainSidebarInjectedMenuItems } = useInjectedMenuItems('menu:sidebar:main')
  const { items: settingsSidebarInjectedMenuItems } = useInjectedMenuItems('menu:sidebar:settings')
  const { items: profileSidebarInjectedMenuItems } = useInjectedMenuItems('menu:sidebar:profile')
  const { items: topbarInjectedMenuItems } = useInjectedMenuItems('menu:topbar:actions')
  useEventBridge() // SSE DOM Event Bridge — singleton SSE connection for real-time server events
  const resolvedProductName = productName ?? t('appShell.productName')
  const [mobileOpen, setMobileOpen] = React.useState(false)
  // Initialize from server-provided prop only to avoid hydration flicker
  const [collapsed, setCollapsed] = React.useState(sidebarCollapsedDefault)
  // Maintain internal nav state so we can augment it client-side
  const [navGroups, setNavGroups] = React.useState(resolvedGroups)
  const [openGroups, setOpenGroups] = React.useState<Record<string, boolean>>(() =>
    Object.fromEntries(resolvedGroups.map((g) => [resolveGroupKey(g), true])) as Record<string, boolean>
  )
  const [headerTitle, setHeaderTitle] = React.useState<string | undefined>(currentTitle)
  const [headerBreadcrumb, setHeaderBreadcrumb] = React.useState<Breadcrumb | undefined>(breadcrumb)
  const [navQuery, setNavQuery] = React.useState('')
  const navQueryNorm = navQuery.trim().toLowerCase()
  const navQueryActive = navQueryNorm.length > 0
  const matchesQuery = React.useCallback((label: string | undefined) => {
    if (!navQueryActive) return true
    if (!label) return false
    return label.toLowerCase().includes(navQueryNorm)
  }, [navQueryActive, navQueryNorm])
  const effectiveCollapsed = collapsed
  const expandedSidebarWidth = '240px'

  // Track scroll position of the desktop sidebar's inner scroll container so we can
  // flip the affordance chevron between down/up (and hide it entirely when content
  // fits without scrolling). The inner div is rendered deep in renderSidebar /
  // renderSectionSidebar — we tag it with `data-sidebar-scroll="true"` and look it
  // up via the aside ref so we don't have to thread refs through the JSX tree.
  const sidebarAsideRef = React.useRef<HTMLElement>(null)
  const [sidebarScrollState, setSidebarScrollState] = React.useState<'down' | 'up' | 'none'>('down')
  React.useEffect(() => {
    const aside = sidebarAsideRef.current
    if (!aside) return
    const target = aside.querySelector<HTMLElement>('[data-sidebar-scroll="true"]')
    if (!target) return
    const update = () => {
      const { scrollTop, scrollHeight, clientHeight } = target
      const canScroll = scrollHeight > clientHeight + 1
      if (!canScroll) {
        setSidebarScrollState('none')
        return
      }
      const atBottom = scrollTop + clientHeight >= scrollHeight - 8
      setSidebarScrollState(atBottom ? 'up' : 'down')
    }
    update()
    target.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(target)
    return () => {
      target.removeEventListener('scroll', update)
      ro.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, effectiveCollapsed])
  const injectionContext = React.useMemo(
    () => ({
      path: pathname ?? '',
      query: searchParams?.toString() ?? '',
    }),
    [pathname, searchParams],
  )

  const isOnSettingsPath = React.useMemo(() => {
    if (!pathname) return false
    if (pathname === '/backend/settings') return true
    return resolvedSettingsPathPrefixes.some((prefix) => pathname.startsWith(prefix))
  }, [pathname, resolvedSettingsPathPrefixes])

  const isOnProfilePath = React.useMemo(() => {
    if (!pathname) return false
    if (pathname === '/backend/profile') return true
    return resolvedProfilePathPrefixes.some((prefix) => pathname.startsWith(prefix))
  }, [pathname, resolvedProfilePathPrefixes])

  const sidebarMode: 'main' | 'settings' | 'profile' =
    isOnSettingsPath ? 'settings' :
    isOnProfilePath ? 'profile' :
    'main'

  const mainNavGroupsWithInjected = React.useMemo(
    () => mergeSidebarGroupsWithInjected(navGroups, mainSidebarInjectedMenuItems, t),
    [mainSidebarInjectedMenuItems, navGroups, t],
  )

  // Lock body scroll when mobile drawer is open so touch scroll stays in the drawer
  React.useEffect(() => {
    if (!mobileOpen || typeof document === 'undefined') return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [mobileOpen])

  React.useEffect(() => {
    try {
      const savedOpen = typeof window !== 'undefined' ? localStorage.getItem('om:sidebarOpenGroups') : null
      if (!savedOpen) return
      const parsed = JSON.parse(savedOpen) as Record<string, boolean>
      setOpenGroups((prev) => {
        const next = { ...prev }
        for (const group of resolvedGroups) {
          const key = resolveGroupKey(group)
          if (key in parsed) next[key] = !!parsed[key]
          else if (group.name in parsed) next[key] = !!parsed[group.name]
        }
        return next
      })
    } catch {
      // ignore localStorage errors to avoid breaking hydration
    }
  }, [resolvedGroups])

  const toggleGroup = (groupId: string) => setOpenGroups((prev) => ({ ...prev, [groupId]: prev[groupId] === false }))

  const asideWidth = effectiveCollapsed ? '80px' : expandedSidebarWidth
  // Use min-h-svh so the border extends with tall content; no overflow so sticky bottom works
  const asideClassesBase = `border-r bg-background py-4`;

  // Persist collapse state to localStorage and cookie. Both writes can throw in
  // private/incognito mode (storage blocked) or when cookies are disabled —
  // the persisted preference is purely a UX nice-to-have, never functional, so
  // swallow the failure and let the component fall back to the default state.
  React.useEffect(() => {
    try { localStorage.setItem('om:sidebarCollapsed', collapsed ? '1' : '0') } catch { /* localStorage blocked (private mode) — non-critical */ }
    try {
      document.cookie = `om_sidebar_collapsed=${collapsed ? '1' : '0'}; path=/; max-age=31536000; samesite=lax`
    } catch { /* cookies disabled — non-critical */ }
  }, [collapsed])

  // Two-level sidebar (Option B): when entering settings/profile mode, force the
  // main sidebar to collapsed (icons only) so the section sub-nav can sit beside
  // it; restore the user's previous expansion when returning to the main mode.
  // Initial ref is 'main' so direct mounts on /backend/settings also auto-collapse.
  const collapsedBeforeSectionRef = React.useRef<boolean | null>(null)
  const previousSidebarModeRef = React.useRef<'main' | 'settings' | 'profile'>('main')
  React.useEffect(() => {
    const previous = previousSidebarModeRef.current
    if (previous === 'main' && sidebarMode !== 'main') {
      collapsedBeforeSectionRef.current = collapsed
      if (!collapsed) setCollapsed(true)
    } else if (previous !== 'main' && sidebarMode === 'main' && collapsedBeforeSectionRef.current !== null) {
      const restoreTo = collapsedBeforeSectionRef.current
      collapsedBeforeSectionRef.current = null
      if (collapsed !== restoreTo) setCollapsed(restoreTo)
    }
    previousSidebarModeRef.current = sidebarMode
  }, [sidebarMode, collapsed])
  React.useEffect(() => {
    try { localStorage.setItem('om:sidebarOpenGroups', JSON.stringify(openGroups)) } catch { /* localStorage blocked (private mode) — non-critical */ }
  }, [openGroups])

  // Ensure current route's group is expanded on load
  React.useEffect(() => {
    const activeGroup = navGroups.find((g) => g.items.some((i) => pathname?.startsWith(i.href)))
    if (!activeGroup) return
    const key = resolveGroupKey(activeGroup)
    setOpenGroups((prev) => (prev[key] === false ? { ...prev, [key]: true } : prev))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, navGroups])
  // Keep header state in sync with props (server-side updates)
  React.useEffect(() => {
    setHeaderTitle(currentTitle)
    setHeaderBreadcrumb(breadcrumb)
  }, [currentTitle, breadcrumb])
  // Clear breadcrumb on client-side navigation so stale state doesn't persist;
  // the new page's ApplyBreadcrumb (if any) will set the correct values
  const prevPathname = React.useRef(pathname)
  React.useEffect(() => {
    if (pathname !== prevPathname.current) {
      prevPathname.current = pathname
      setHeaderTitle(undefined)
      setHeaderBreadcrumb(undefined)
    }
  }, [pathname])

  // Keep navGroups in sync when server-provided groups change
  React.useEffect(() => {
    setNavGroups(cloneSidebarGroups(resolvedGroups))
  }, [resolvedGroups])

  function renderSectionSidebar(
    sections: SectionNavGroup[],
    title: string,
    compact: boolean,
    hideHeader?: boolean,
    hideSearch?: boolean
  ) {
    const sortedSections = [...sections].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    const lastVisibleIndex = sortedSections.length - 1

    return (
      <div className="flex h-full flex-col gap-3">
        {!hideHeader && (
          <div className="mb-2">
            <Link
              href="/backend"
              className={`flex items-center gap-3 rounded-xl transition-colors hover:bg-muted ${compact ? 'p-2 justify-center' : 'p-3'}`}
              aria-label={t('appShell.goToDashboard')}
            >
              <Image src={logo?.src ?? "/open-mercato.svg"} alt={logo?.alt ?? resolvedProductName} width={40} height={40} className="rounded-full shrink-0" />
              {!compact && <span className="text-sm font-medium text-foreground">{resolvedProductName}</span>}
            </Link>
          </div>
        )}
        {!compact && !hideSearch && (
          <Input
            type="text"
            value={navQuery}
            onChange={(e) => setNavQuery(e.target.value)}
            placeholder={t('appShell.searchNavPlaceholder', 'Search...')}
            aria-label={t('appShell.searchNavAria', 'Search navigation')}
            leftIcon={<Search aria-hidden />}
            rightIcon={navQueryActive ? (
              <IconButton
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => setNavQuery('')}
                aria-label={t('appShell.searchNavClear', 'Clear search')}
              >
                <X className="size-3.5" aria-hidden />
              </IconButton>
            ) : undefined}
            className="mb-2"
          />
        )}
        <div data-sidebar-scroll="true" className={`flex flex-1 flex-col gap-3 overflow-y-auto scrollbar-hide pr-1 ${compact ? '-ml-2 pl-2' : '-ml-3 pl-3'}`}>
          <nav className="flex flex-col gap-2">
          {sortedSections.map((section, sectionIndex) => {
            const sectionNavQueryActive = hideSearch ? false : navQueryActive
            const matchesItemQuery = (item: typeof section.items[number]): boolean => {
              if (!sectionNavQueryActive) return true
              const label = item.labelKey ? t(item.labelKey, item.label) : item.label
              if (matchesQuery(label)) return true
              return Array.isArray(item.children) && item.children.some(matchesItemQuery)
            }
            const visibleItems = sectionNavQueryActive
              ? section.items.filter(matchesItemQuery)
              : section.items
            if (visibleItems.length === 0) return null
            const sortedItems = [...visibleItems].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
            const sectionLabel = section.labelKey ? t(section.labelKey, section.label) : section.label
            const sectionKey = `settings:${section.id}`
            const open = openGroups[sectionKey] !== false
            const sortSectionItems = (items: typeof section.items = []) =>
              [...items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
            const filterChildren = (children: typeof section.items | undefined) => {
              if (!children) return [] as typeof section.items
              if (!sectionNavQueryActive) return [...children]
              return children.filter(matchesItemQuery)
            }

            const renderSectionItem = (item: (typeof section.items)[number], depth = 0): React.ReactNode => {
              const label = item.labelKey ? t(item.labelKey, item.label) : item.label
              const childItems = sortSectionItems(filterChildren(item.children))
              const isOnItemBranch = !!pathname && (
                pathname === item.href ||
                pathname.startsWith(`${item.href}/`)
              )
              const hasActiveChild = !!(pathname && childItems.some((child) => (
                pathname === child.href ||
                pathname.startsWith(`${child.href}/`)
              )))
              const showChildren = childItems.length > 0 && (isOnItemBranch || sectionNavQueryActive)
              const isActive = isOnItemBranch || hasActiveChild
              const base = compact ? 'w-10 h-10 justify-center' : 'w-full py-2 gap-2'
              const spacingStyle = !compact
                ? {
                    paddingLeft: `${12 + depth * 16}px`,
                    paddingRight: '12px',
                  }
                : undefined

              return (
                <React.Fragment key={item.id}>
                  <Link
                    href={item.href}
                    className={`relative text-sm font-medium rounded-lg inline-flex items-center ${base} ${
                      isActive
                        ? 'bg-muted text-foreground'
                        : 'text-muted-foreground hover:bg-muted'
                    }`}
                    style={spacingStyle}
                    title={compact ? label : undefined}
                    data-menu-item-id={item.id}
                    onClick={() => setMobileOpen(false)}
                  >
                    {isActive && (
                      <span aria-hidden className={`absolute ${compact ? 'left-[-20px]' : 'left-[-12px]'} top-2 w-1 h-5 rounded-r bg-foreground`} />
                    )}
                    <span className="flex items-center justify-center shrink-0">
                      {renderIcon(
                        item.icon,
                        item.iconName,
                        item.iconMarkup,
                        item.href.includes('/backend/entities/user/') && item.href.endsWith('/records') ? DataTableIcon : DefaultIcon,
                      )}
                    </span>
                    {!compact && <span className="truncate">{label}</span>}
                  </Link>
                  {showChildren ? childItems.map((child) => renderSectionItem(child, depth + 1)) : null}
                </React.Fragment>
              )
            }

            return (
              <div key={section.id}>
                {!compact && (
                  <Button
                    variant="muted"
                    onClick={() => toggleGroup(sectionKey)}
                    className="w-full px-1 justify-between flex text-xs font-medium uppercase tracking-wider text-muted-foreground/70 py-1"
                    aria-expanded={open}
                  >
                    <span>{sectionLabel}</span>
                    <Chevron open={open} />
                  </Button>
                )}
                {(open || compact) && (
                  <div className={`flex flex-col ${compact ? 'items-center' : ''} gap-1`}>
                    {sortedItems.map((item) => renderSectionItem(item))}
                  </div>
                )}
                {sectionIndex !== lastVisibleIndex && <div className={`my-2 border-t ${compact ? '-ml-2 -mr-3' : '-ml-3 -mr-4'}`} />}
              </div>
            )
          })}
        </nav>
        </div>
      </div>
    )
  }

  function renderSidebar(compact: boolean, hideHeader?: boolean, forceMainOnly?: boolean) {
    if (!isChromeReady && isChromeLoading && resolvedGroups.length === 0) {
      return (
        <div className="flex flex-col min-h-full gap-3" data-testid="backend-chrome-loading">
          {!hideHeader ? (
            <div className="mb-2">
              <Link
                href="/backend"
                className={`flex items-center gap-3 rounded-xl transition-colors hover:bg-muted ${compact ? 'p-2 justify-center' : 'p-3'}`}
                aria-label={t('appShell.goToDashboard')}
              >
                <Image src={logo?.src ?? "/open-mercato.svg"} alt={logo?.alt ?? resolvedProductName} width={40} height={40} className="rounded-full shrink-0" />
                {!compact && <span className="text-sm font-medium text-foreground">{resolvedProductName}</span>}
              </Link>
            </div>
          ) : null}
          <div className="flex flex-1 flex-col gap-3 pr-1">
            <div className="space-y-3">
              <div className="h-8 rounded bg-muted/50" />
              <div className="space-y-2 pl-1">
                <div className="h-8 rounded bg-muted/50" />
                <div className="h-8 rounded bg-muted/50" />
                <div className="h-8 rounded bg-muted/50" />
              </div>
            </div>
            <div className="space-y-3">
              <div className="h-8 rounded bg-muted/50" />
              <div className="space-y-2 pl-1">
                <div className="h-8 rounded bg-muted/50" />
                <div className="h-8 rounded bg-muted/50" />
              </div>
            </div>
          </div>
        </div>
      )
    }

    if (!forceMainOnly && sidebarMode === 'settings' && resolvedSettingsSections && resolvedSettingsSections.length > 0) {
      const mergedSettingsSections = mergeSectionGroupsWithInjected(
        resolvedSettingsSections,
        settingsSidebarInjectedMenuItems,
        t,
      )
      return renderSectionSidebar(
        mergedSettingsSections,
        settingsSectionTitle ?? t('backend.nav.settings', 'Settings'),
        compact,
        hideHeader
      )
    }

    if (!forceMainOnly && sidebarMode === 'profile' && resolvedProfileSections && resolvedProfileSections.length > 0) {
      const mergedProfileSections = mergeSectionGroupsWithInjected(
        resolvedProfileSections,
        profileSidebarInjectedMenuItems,
        t,
      )
      return renderSectionSidebar(
        mergedProfileSections,
        profileSectionTitle ?? t('backend.nav.profile', 'Profile'),
        compact,
        hideHeader
      )
    }

    const isMobileVariant = !!hideHeader
    const shouldRenderSidebarInjectionSpots = !isMobileVariant

    return (
      <div className="flex h-full flex-col gap-3">
        {!hideHeader && (
          <div className="mb-2">
            <Link
              href="/backend"
              className={`flex items-center gap-3 rounded-xl transition-colors hover:bg-muted ${compact ? 'p-2 justify-center' : 'p-3'}`}
              aria-label={t('appShell.goToDashboard')}
            >
              <Image src={logo?.src ?? "/open-mercato.svg"} alt={logo?.alt ?? resolvedProductName} width={40} height={40} className="rounded-full shrink-0" />
              {!compact && <span className="text-sm font-medium text-foreground">{resolvedProductName}</span>}
            </Link>
          </div>
        )}
        {shouldRenderSidebarInjectionSpots ? (
          <InjectionSpot
            spotId={BACKEND_SIDEBAR_TOP_INJECTION_SPOT_ID}
            context={injectionContext}
          />
        ) : null}
        {!compact && (
          <Input
            type="text"
            value={navQuery}
            onChange={(e) => setNavQuery(e.target.value)}
            placeholder={t('appShell.searchNavPlaceholder', 'Search...')}
            aria-label={t('appShell.searchNavAria', 'Search navigation')}
            leftIcon={<Search aria-hidden />}
            rightIcon={navQueryActive ? (
              <IconButton
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => setNavQuery('')}
                aria-label={t('appShell.searchNavClear', 'Clear search')}
              >
                <X className="size-3.5" aria-hidden />
              </IconButton>
            ) : undefined}
            className="mb-2"
          />
        )}
        <div data-sidebar-scroll="true" className={`flex flex-1 flex-col gap-3 overflow-y-auto scrollbar-hide pr-1 ${compact ? '-ml-2 pl-2' : '-ml-3 pl-3'}`}>
          {(() => {
              const isSettingsPath = (href: string) => {
                if (href === '/backend/settings') return true
                return resolvedSettingsPathPrefixes.some((prefix) => href.startsWith(prefix))
              }

              const isMainItem = (item: SidebarItem) => {
                if (item.pageContext && item.pageContext !== 'main') return false
                if (isSettingsPath(item.href)) return false
                return true
              }

              const mainGroups = mainNavGroupsWithInjected.map((g) => ({
                ...g,
                items: g.items.filter((item) => isMainItem(item) && item.hidden !== true),
              })).filter((g) => g.items.length > 0)

              const mainLastVisibleGroupIndex = (() => {
                for (let idx = mainGroups.length - 1; idx >= 0; idx -= 1) {
                  if (mainGroups[idx].items.some((item) => item.hidden !== true)) return idx
                }
                return -1
              })()

              return (
                <>
                  <nav className="flex flex-col gap-2" data-testid="sidebar">
                    {shouldRenderSidebarInjectionSpots ? (
                      <InjectionSpot
                        spotId={BACKEND_SIDEBAR_NAV_INJECTION_SPOT_ID}
                        context={injectionContext}
                      />
                    ) : null}
                    {mainGroups.map((g, gi) => {
                      const groupId = resolveGroupKey(g)
                      const open = navQueryActive ? true : openGroups[groupId] !== false
                      const visibleItems = g.items.filter((item) => {
                        if (item.hidden === true) return false
                        if (!navQueryActive) return true
                        if (matchesQuery(item.title)) return true
                        const itemChildren = (item.children ?? []).filter((c) => c.hidden !== true)
                        return itemChildren.some((c) => matchesQuery(c.title))
                      })
                      if (visibleItems.length === 0) return null
                      return (
                        <div key={groupId}>
                          {!compact && (
                            <Button
                              variant="muted"
                              onClick={() => toggleGroup(groupId)}
                              className="w-full px-1 justify-between flex text-xs font-medium uppercase tracking-wider text-muted-foreground/70 py-1"
                              aria-expanded={open}
                            >
                              <span>{g.name}</span>
                              <Chevron open={open} />
                            </Button>
                          )}
                          {(open || compact) && (
                            <div className={`flex flex-col ${compact ? 'items-center' : ''} gap-1`}>
                              {visibleItems.map((i) => {
                                const allChildItems = (i.children ?? []).filter((child) => child.hidden !== true)
                                const matchingChildItems = navQueryActive
                                  ? allChildItems.filter((c) => matchesQuery(c.title))
                                  : allChildItems
                                const childItems = navQueryActive ? matchingChildItems : allChildItems
                                const showChildren = navQueryActive
                                  ? matchingChildItems.length > 0
                                  : (!!pathname && allChildItems.length > 0 && pathname.startsWith(i.href))
                                const hasActiveChild = !!(pathname && allChildItems.some((c) => pathname.startsWith(c.href)))
                                const isParentActive = (pathname === i.href) || (!navQueryActive && showChildren && !hasActiveChild)
                                const base = compact ? 'w-10 h-10 justify-center' : 'w-full px-3 py-2 gap-2'
                                return (
                                  <React.Fragment key={i.href}>
                                    <Link
                                      href={i.href}
                                      className={`relative text-sm font-medium rounded-lg inline-flex items-center ${base} ${
                                        isParentActive ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted'
                                      } ${i.enabled === false ? 'pointer-events-none opacity-50' : ''}`}
                                      aria-disabled={i.enabled === false}
                                      title={compact ? i.title : undefined}
                                      data-menu-item-id={i.id ?? i.href}
                                      onClick={() => setMobileOpen(false)}
                                    >
                                      {isParentActive ? (
                                        <span aria-hidden className={`absolute ${compact ? 'left-[-20px]' : 'left-[-12px]'} top-2 w-1 h-5 rounded-r bg-foreground`} />
                                      ) : null}
                                      <span className="flex items-center justify-center shrink-0">
                                        {renderIcon(
                                          i.icon,
                                          i.iconName,
                                          i.iconMarkup,
                                          DefaultIcon,
                                        )}
                                      </span>
                                      {!compact && <span>{i.title}</span>}
                                    </Link>
                                    {showChildren ? (
                                      <div className={`relative flex flex-col ${compact ? 'items-center' : ''} gap-1`}>
                                        {!compact && (
                                          <span aria-hidden className="pointer-events-none absolute left-1.5 top-1 bottom-1 w-px bg-border" />
                                        )}
                                        {childItems.map((c) => {
                                          const childActive = pathname?.startsWith(c.href)
                                          const childBase = compact ? 'w-10 h-8 justify-center' : 'w-full pl-5 pr-3 py-2 gap-2'
                                          return (
                                            <Link
                                              key={c.href}
                                              href={c.href}
                                              className={`relative text-sm font-medium rounded-lg inline-flex items-center ${childBase} ${
                                                childActive ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted'
                                              } ${c.enabled === false ? 'pointer-events-none opacity-50' : ''}`}
                                              aria-disabled={c.enabled === false}
                                              title={compact ? c.title : undefined}
                                              data-menu-item-id={c.id ?? c.href}
                                              onClick={() => setMobileOpen(false)}
                                            >
                                              {childActive ? (
                                                <span aria-hidden className={`absolute ${compact ? 'left-[-20px]' : 'left-[-12px]'} top-2 w-1 h-5 rounded-r bg-foreground`} />
                                              ) : null}
                                              <span className="flex items-center justify-center shrink-0">
                                                {renderIcon(
                                                  c.icon,
                                                  c.iconName,
                                                  c.iconMarkup,
                                                  c.href.includes('/backend/entities/user/') && c.href.endsWith('/records') ? DataTableIcon : DefaultIcon,
                                                )}
                                              </span>
                                              {!compact && <span>{c.title}</span>}
                                            </Link>
                                          )
                                        })}
                                      </div>
                                    ) : null}
                                  </React.Fragment>
                                )
                              })}
                            </div>
                          )}
                          {gi !== mainLastVisibleGroupIndex && <div className={`my-2 border-t ${compact ? '-ml-2 -mr-3' : '-ml-3 -mr-4'}`} />}
                        </div>
                      )
                    })}
                  </nav>
                </>
              )
            })()}
        </div>
        <div className="sticky bottom-0 bg-background pb-1">
          {shouldRenderSidebarInjectionSpots ? (
            <InjectionSpot
              spotId={BACKEND_SIDEBAR_NAV_FOOTER_INJECTION_SPOT_ID}
              context={injectionContext}
            />
          ) : null}
          {(() => {
            const settingsHref = '/backend/settings'
            const isActive = !!pathname && (
              pathname === settingsHref ||
              pathname.startsWith(`${settingsHref}/`) ||
              resolvedSettingsPathPrefixes.some((prefix) => pathname.startsWith(prefix))
            )
            const base = compact ? 'w-10 h-10 justify-center' : 'w-full px-3 py-2 gap-2'
            return (
              <Link
                href={settingsHref}
                className={`relative text-sm font-medium rounded-lg inline-flex items-center ${base} ${
                  isActive ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted'
                }`}
                title={compact ? t('backend.nav.settings', 'Settings') : undefined}
                data-menu-item-id="backend-sidebar-settings"
                onClick={() => setMobileOpen(false)}
              >
                {isActive ? (
                  <span aria-hidden className={`absolute ${compact ? 'left-[-20px]' : 'left-[-12px]'} top-2 w-1 h-5 rounded-r bg-foreground`} />
                ) : null}
                <span className="flex items-center justify-center shrink-0">
                  <Settings className="size-4" aria-hidden />
                </span>
                {!compact && <span>{t('backend.nav.settings', 'Settings')}</span>}
              </Link>
            )
          })()}
          {shouldRenderSidebarInjectionSpots ? (
            <StatusBadgeInjectionSpot
              spotId={GLOBAL_SIDEBAR_STATUS_BADGES_INJECTION_SPOT_ID}
              context={injectionContext}
            />
          ) : null}
          {shouldRenderSidebarInjectionSpots ? (
            <InjectionSpot
              spotId={BACKEND_SIDEBAR_FOOTER_INJECTION_SPOT_ID}
              context={injectionContext}
            />
          ) : null}
        </div>
      </div>
    )
  }

  function renderSectionAside() {
    let sections: SectionNavGroup[] | null = null
    let title = ''
    if (sidebarMode === 'settings' && resolvedSettingsSections && resolvedSettingsSections.length > 0) {
      sections = mergeSectionGroupsWithInjected(
        resolvedSettingsSections,
        settingsSidebarInjectedMenuItems,
        t,
      )
      title = settingsSectionTitle ?? t('backend.nav.settings', 'Settings')
    } else if (sidebarMode === 'profile' && resolvedProfileSections && resolvedProfileSections.length > 0) {
      sections = mergeSectionGroupsWithInjected(
        resolvedProfileSections,
        profileSidebarInjectedMenuItems,
        t,
      )
      title = profileSectionTitle ?? t('backend.nav.profile', 'Profile')
    }
    if (!sections) return null
    return (
      <div className="flex h-full flex-col gap-2">
        <Link
          href="/backend"
          className="inline-flex items-center gap-2 rounded-lg px-2 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
          data-testid="appshell-section-back-to-main"
          aria-label={t('backend.nav.backToMain', 'Back to Main')}
        >
          <ChevronLeft className="size-4 shrink-0" aria-hidden />
          <span className="truncate">{title}</span>
        </Link>
        <div className="min-h-0 flex-1">
          {renderSectionSidebar(sections, title, false, true, true)}
        </div>
      </div>
    )
  }

  const isSectionView =
    (sidebarMode === 'settings' && !!resolvedSettingsSections && resolvedSettingsSections.length > 0) ||
    (sidebarMode === 'profile' && !!resolvedProfileSections && resolvedProfileSections.length > 0)
  const gridColsClass = isSectionView
    ? (effectiveCollapsed ? 'lg:grid-cols-[80px_240px_1fr]' : 'lg:grid-cols-[240px_240px_1fr]')
    : (effectiveCollapsed ? 'lg:grid-cols-[80px_1fr]' : 'lg:grid-cols-[240px_1fr]')
  const headerCtxValue = React.useMemo(() => ({
    setBreadcrumb: setHeaderBreadcrumb,
    setTitle: setHeaderTitle,
  }), [])
  const renderedTopbarInjectedActions = React.useMemo(
    () =>
      topbarInjectedMenuItems.map((item) => {
        const label = resolveInjectedMenuLabel(item, t)
        if (item.href) {
          return (
            <Link
              key={item.id}
              href={item.href}
              className="inline-flex items-center rounded border px-2 py-1 text-xs hover:bg-accent hover:text-accent-foreground"
              data-menu-item-id={item.id}
            >
              {label}
            </Link>
          )
        }
        return (
          <Button
            key={item.id}
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            data-menu-item-id={item.id}
            onClick={() => item.onClick?.()}
          >
            {label}
          </Button>
        )
      }),
    [t, topbarInjectedMenuItems],
  )

  return (
    <HeaderContext.Provider value={headerCtxValue}>
    <div className={`min-h-svh lg:grid transition-[grid-template-columns] duration-200 ease-out ${gridColsClass}`}>
      {/* Desktop main sidebar */}
      <aside ref={sidebarAsideRef} className={`${asideClassesBase} ${effectiveCollapsed ? 'px-2' : 'px-3'} hidden lg:block lg:sticky lg:top-0 lg:h-svh lg:self-start lg:overflow-hidden lg:relative transition-[width,padding] duration-200 ease-out`} style={{ width: asideWidth }}>
        {renderSidebar(effectiveCollapsed, false, isSectionView)}
        {/* Scroll affordance — gradient fade + chevron that flips up when the user
            reaches the bottom and disappears when nothing is scrollable. */}
        {sidebarScrollState !== 'none' ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 flex h-10 items-end justify-center bg-gradient-to-t from-background via-background/80 to-transparent pb-1.5"
          >
            {/* Outer div owns the rotate transition so it doesn't fight with the
                animate-bounce keyframes (both target `transform`). */}
            <span
              className={`inline-flex transition-transform duration-300 ${sidebarScrollState === 'up' ? 'rotate-180' : ''}`}
            >
              <ChevronDown className="size-4 animate-bounce text-muted-foreground/70" />
            </span>
          </div>
        ) : null}
      </aside>

      {/* Desktop section sidebar (Option B two-level) — sits beside the main sidebar
          when the user is on settings/profile routes. Mobile drawer keeps the
          original swap behavior to fit the narrow width. */}
      {isSectionView ? (
        <aside
          className={`${asideClassesBase} px-3 hidden lg:block lg:sticky lg:top-0 lg:h-svh lg:self-start lg:overflow-hidden lg:relative`}
          style={{ width: '240px' }}
          data-testid="appshell-section-sidebar"
        >
          {renderSectionAside()}
          {/* Static bottom fade — covers the native iOS scroll indicator and signals
              that the section list is scrollable. Same look as the main sidebar's
              affordance but without the chevron / scroll-state machinery. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-background via-background/80 to-transparent"
          />
        </aside>
      ) : null}

      <div className="flex min-h-svh flex-col min-w-0">
        <header className="border-b bg-background/80 px-3 lg:px-4 py-2 lg:py-3 flex items-center justify-between gap-2">
          <div
            data-testid="backend-chrome-ready"
            data-ready={isChromeReady ? 'true' : 'false'}
            className="hidden"
          />
          <div className="flex items-center gap-2 min-w-0">
            {/* Mobile menu button */}
            <IconButton variant="outline" size="sm" className="lg:hidden" aria-label={t('appShell.openMenu')} onClick={() => setMobileOpen(true)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
            </IconButton>
            {/* Desktop collapse toggle */}
            <IconButton
              variant="outline"
              size="sm"
              className="hidden lg:inline-flex"
              aria-label={t('appShell.toggleSidebar')}
              onClick={() => setCollapsed((c) => !c)}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="16" rx="2"/>
                <path d="M9 4v16"/>
              </svg>
            </IconButton>
            {/* Header breadcrumb: always starts with Dashboard */}
            {(() => {
              const dashboardLabel = t('dashboard.title')
              const root: Breadcrumb = [{ label: dashboardLabel, href: '/backend' }]
              let rest: Breadcrumb = []
              if (headerBreadcrumb && headerBreadcrumb.length) {
                const first = headerBreadcrumb[0]
                const dup = first && (first.href === '/backend' || first.label === dashboardLabel || first.label?.toLowerCase() === 'dashboard')
                rest = dup ? headerBreadcrumb.slice(1) : headerBreadcrumb
              } else if (headerTitle) {
                rest = [{ label: headerTitle }]
              }
              const items = [...root, ...rest]
              const lastIndex = items.length - 1
              return (
                <nav className="flex items-center gap-2 text-sm min-w-0">
                  {items.map((b, i) => {
                    const isLast = i === lastIndex
                    const hiddenOnMobile = !isLast ? 'hidden md:inline' : ''
                    return (
                      <React.Fragment key={i}>
                        {i > 0 && <span className={`text-muted-foreground hidden md:inline`}>/</span>}
                        {b.href ? (
                          <Link href={b.href} className={`text-muted-foreground hover:text-foreground ${hiddenOnMobile}`}>
                            {b.label}
                          </Link>
                        ) : (
                          <span className={`font-medium truncate max-w-[45vw] md:max-w-[60vw]`}>{b.label}</span>
                        )}
                      </React.Fragment>
                    )
                  })}
                </nav>
              )
            })()}
          </div>
          <div className="flex items-center gap-1 md:gap-2 text-sm shrink-0">
            <StatusBadgeInjectionSpot
              spotId={GLOBAL_HEADER_STATUS_INDICATORS_INJECTION_SPOT_ID}
              context={injectionContext}
            />
            <InjectionSpot
              spotId={BACKEND_TOPBAR_ACTIONS_INJECTION_SPOT_ID}
              context={injectionContext}
            />
            {renderedTopbarInjectedActions}
            {rightHeaderSlot ? (
              rightHeaderSlot
            ) : (
              <span className="opacity-80">{email || t('appShell.userFallback')}</span>
            )}
          </div>
        </header>
        <ProgressTopBar t={t} className="sticky top-0 z-sticky" />
        <main className="flex-1 p-4 lg:p-6 mx-auto w-full max-w-screen-2xl">
          <InjectionSpot spotId={BACKEND_LAYOUT_TOP_INJECTION_SPOT_ID} context={injectionContext} />
          <FlashMessages />
          <PartialIndexBanner />
          <UpgradeActionBanner />
          <LastOperationBanner />
          <InjectionSpot spotId={BACKEND_RECORD_CURRENT_INJECTION_SPOT_ID} context={injectionContext} />
          <InjectionSpot
            spotId={LEGACY_GLOBAL_MUTATION_INJECTION_SPOT_ID}
            context={injectionContext}
          />
          <div id="om-top-banners" className="mb-3 space-y-2" />
          {children}
          <InjectionSpot spotId={BACKEND_LAYOUT_FOOTER_INJECTION_SPOT_ID} context={injectionContext} />
        </main>
        <footer className="border-t bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/80 px-4 py-3 flex flex-wrap items-center justify-end gap-4">
          {version ? (
            <span className="text-xs text-muted-foreground">
              {t('appShell.version', { version })}
            </span>
          ) : null}
          <nav className="flex items-center gap-3 text-xs text-muted-foreground">
            <Link href="/terms" className="transition hover:text-foreground">
              {t('common.terms')}
            </Link>
            <Link href="/privacy" className="transition hover:text-foreground">
              {t('common.privacy')}
            </Link>
          </nav>
        </footer>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-modal">
          <div className="absolute inset-0 bg-black/20" onClick={() => setMobileOpen(false)} aria-hidden="true" />
          <aside className="absolute left-0 top-0 flex h-full w-[260px] flex-col bg-background border-r overflow-hidden">
            <div className="shrink-0 p-3 pb-2 flex items-center justify-between border-b">
              <Link href="/backend" className="flex items-center gap-2 text-sm font-semibold" onClick={() => setMobileOpen(false)} aria-label={t('appShell.goToDashboard')}>
                <Image src={logo?.src ?? "/open-mercato.svg"} alt={logo?.alt ?? resolvedProductName} width={28} height={28} className="rounded" />
                {resolvedProductName}
              </Link>
              <IconButton variant="outline" size="sm" onClick={() => setMobileOpen(false)} aria-label={t('appShell.closeMenu')}>✕</IconButton>
            </div>
            {mobileSidebarSlot && (
              <div className="shrink-0 border-b px-3 py-2">
                {mobileSidebarSlot}
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3">
              {/* Force expanded sidebar in mobile drawer, hide its header and collapse toggle */}
              {renderSidebar(false, true)}
            </div>
          </aside>
        </div>
      )}
    </div>
    <UmesDevToolsPanel />
    </HeaderContext.Provider>
  )
}

