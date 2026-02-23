"use client"
import * as React from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { ChevronUp, ChevronDown } from 'lucide-react'
import { Button } from '../primitives/button'
import { IconButton } from '../primitives/icon-button'
import { Separator } from '../primitives/separator'
import { FlashMessages } from './FlashMessages'
import { usePathname, useSearchParams } from 'next/navigation'
import { apiCall } from './utils/apiCall'
import { LastOperationBanner } from './operations/LastOperationBanner'
import { UpgradeActionBanner } from './upgrades/UpgradeActionBanner'
import { PartialIndexBanner } from './indexes/PartialIndexBanner'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { slugifySidebarId } from '@open-mercato/shared/modules/navigation/sidebarPreferences'
import type { SectionNavGroup } from './section-page/types'
import { InjectionSpot } from './injection/InjectionSpot'
import { LEGACY_GLOBAL_MUTATION_INJECTION_SPOT_ID } from './injection/mutationEvents'
import {
  BACKEND_LAYOUT_FOOTER_INJECTION_SPOT_ID,
  BACKEND_LAYOUT_TOP_INJECTION_SPOT_ID,
  BACKEND_RECORD_CURRENT_INJECTION_SPOT_ID,
  BACKEND_SIDEBAR_FOOTER_INJECTION_SPOT_ID,
  BACKEND_SIDEBAR_TOP_INJECTION_SPOT_ID,
} from './injection/spotIds'

export type AppShellProps = {
  productName?: string
  email?: string
  groups: {
    id?: string
    name: string
    defaultName?: string
    items: {
      href: string
      title: string
      defaultTitle?: string
      icon?: React.ReactNode
      enabled?: boolean
      hidden?: boolean
      pageContext?: 'main' | 'admin' | 'settings' | 'profile'
      children?: {
        href: string
        title: string
        defaultTitle?: string
        icon?: React.ReactNode
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

type SidebarCustomizationDraft = {
  order: string[]
  groupLabels: Record<string, string>
  itemLabels: Record<string, string>
  hiddenItemIds: Record<string, boolean>
}

type SidebarGroup = AppShellProps['groups'][number]
type SidebarItem = SidebarGroup['items'][number]
type SidebarRoleTarget = { id: string; name: string; hasPreference: boolean }

function resolveGroupKey(group: SidebarGroup): string {
  if (group.id && group.id.length) return group.id
  if (group.defaultName && group.defaultName.length) return slugifySidebarId(group.defaultName)
  return slugifySidebarId(group.name)
}

const HeaderContext = React.createContext<{
  setBreadcrumb: (b?: Breadcrumb) => void
  setTitle: (t?: string) => void
} | null>(null)

export function ApplyBreadcrumb({ breadcrumb, title, titleKey }: { breadcrumb?: Array<{ label: string; href?: string; labelKey?: string }>; title?: string; titleKey?: string }) {
  const ctx = React.useContext(HeaderContext)
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

export function AppShell({ productName, email, groups, rightHeaderSlot, children, sidebarCollapsedDefault = false, currentTitle, breadcrumb, adminNavApi, version, settingsSectionTitle, settingsPathPrefixes = [], settingsSections, profileSections, profileSectionTitle, profilePathPrefixes = [], mobileSidebarSlot }: AppShellProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const t = useT()
  const locale = useLocale()
  const resolvedProductName = productName ?? t('appShell.productName')
  const [mobileOpen, setMobileOpen] = React.useState(false)
  // Initialize from server-provided prop only to avoid hydration flicker
  const [collapsed, setCollapsed] = React.useState(sidebarCollapsedDefault)
  // Maintain internal nav state so we can augment it client-side
  const [navGroups, setNavGroups] = React.useState(AppShell.cloneGroups(groups))
  const [openGroups, setOpenGroups] = React.useState<Record<string, boolean>>(() =>
    Object.fromEntries(groups.map((g) => [resolveGroupKey(g), true])) as Record<string, boolean>
  )
  const [customizing, setCustomizing] = React.useState(false)
  const [customDraft, setCustomDraft] = React.useState<SidebarCustomizationDraft | null>(null)
  const [loadingPreferences, setLoadingPreferences] = React.useState(false)
  const [savingPreferences, setSavingPreferences] = React.useState(false)
  const [customizationError, setCustomizationError] = React.useState<string | null>(null)
  const [availableRoleTargets, setAvailableRoleTargets] = React.useState<SidebarRoleTarget[]>([])
  const [selectedRoleIds, setSelectedRoleIds] = React.useState<string[]>([])
  const [canApplyToRoles, setCanApplyToRoles] = React.useState(false)
  const originalNavRef = React.useRef<SidebarGroup[] | null>(null)
  const [headerTitle, setHeaderTitle] = React.useState<string | undefined>(currentTitle)
  const [headerBreadcrumb, setHeaderBreadcrumb] = React.useState<Breadcrumb | undefined>(breadcrumb)
  const effectiveCollapsed = customizing ? false : collapsed
  const expandedSidebarWidth = customizing ? '320px' : '240px'
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
    return settingsPathPrefixes.some((prefix) => pathname.startsWith(prefix))
  }, [pathname, settingsPathPrefixes])

  const isOnProfilePath = React.useMemo(() => {
    if (!pathname) return false
    if (pathname === '/backend/profile') return true
    return profilePathPrefixes.some((prefix) => pathname.startsWith(prefix))
  }, [pathname, profilePathPrefixes])

  const sidebarMode: 'main' | 'settings' | 'profile' =
    isOnSettingsPath ? 'settings' :
    isOnProfilePath ? 'profile' :
    'main'

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
        for (const group of groups) {
          const key = resolveGroupKey(group)
          if (key in parsed) next[key] = !!parsed[key]
          else if (group.name in parsed) next[key] = !!parsed[group.name]
        }
        return next
      })
    } catch {
      // ignore localStorage errors to avoid breaking hydration
    }
  }, [groups])

  const toggleGroup = (groupId: string) => setOpenGroups((prev) => ({ ...prev, [groupId]: prev[groupId] === false }))

  const updateDraft = React.useCallback((updater: (draft: SidebarCustomizationDraft) => SidebarCustomizationDraft) => {
    setCustomDraft((prev) => {
      if (!prev) return prev
      const next = updater(prev)
      if (originalNavRef.current) {
        setNavGroups(applyCustomizationDraft(originalNavRef.current, next))
      }
      return next
    })
  }, [])

  const startCustomization = React.useCallback(async () => {
    if (customizing || loadingPreferences) return
    setCustomizationError(null)
    setLoadingPreferences(true)
   try {
     const baseSnapshot = filterMainSidebarGroups(AppShell.cloneGroups(navGroups))
     const call = await apiCall<{
       settings?: Record<string, unknown>
       canApplyToRoles?: boolean
       roles?: Array<{ id?: string; name?: string; hasPreference?: boolean }>
     }>('/api/auth/sidebar/preferences')
      const data = call.ok ? (call.result ?? null) : null
      const rawSettings = data?.settings
      const responseOrder = Array.isArray(rawSettings?.groupOrder)
        ? rawSettings.groupOrder
            .map((id: unknown) => (typeof id === 'string' ? id.trim() : ''))
            .filter((id: string) => id.length > 0)
        : []
      const responseGroupLabels: Record<string, string> = {}
      if (rawSettings?.groupLabels && typeof rawSettings.groupLabels === 'object') {
        for (const [key, value] of Object.entries(rawSettings.groupLabels as Record<string, unknown>)) {
          if (typeof value !== 'string') continue
          const trimmedKey = key.trim()
          if (!trimmedKey) continue
          responseGroupLabels[trimmedKey] = value
        }
      }
      const responseItemLabels: Record<string, string> = {}
      if (rawSettings?.itemLabels && typeof rawSettings.itemLabels === 'object') {
        for (const [key, value] of Object.entries(rawSettings.itemLabels as Record<string, unknown>)) {
          if (typeof value !== 'string') continue
          const trimmedKey = key.trim()
          if (!trimmedKey) continue
          responseItemLabels[trimmedKey] = value
        }
      }
      const responseHiddenItems = Array.isArray(rawSettings?.hiddenItems)
        ? rawSettings.hiddenItems
            .map((href: unknown) => (typeof href === 'string' ? href.trim() : ''))
            .filter((href: string) => href.length > 0)
        : []
      const canManageRoles = data?.canApplyToRoles === true
      setCanApplyToRoles(canManageRoles)
      if (canManageRoles) {
        const roles = Array.isArray(data?.roles)
          ? (data.roles as Array<{ id?: string; name?: string; hasPreference?: boolean }>).filter((role) => typeof role?.id === 'string' && typeof role?.name === 'string')
          : []
        const mappedRoles: SidebarRoleTarget[] = roles.map((role) => ({
          id: role.id as string,
          name: role.name as string,
          hasPreference: role.hasPreference === true,
        }))
        setAvailableRoleTargets(mappedRoles)
        setSelectedRoleIds(mappedRoles.filter((role) => role.hasPreference).map((role) => role.id))
      } else {
        setAvailableRoleTargets([])
        setSelectedRoleIds([])
      }
      const currentIds = baseSnapshot.map((group) => resolveGroupKey(group))
      const order = mergeGroupOrder(responseOrder, currentIds)
      const { itemDefaults } = collectSidebarDefaults(baseSnapshot)
      const hiddenItemIds: Record<string, boolean> = {}
      for (const href of responseHiddenItems) {
        if (!itemDefaults.has(href)) continue
        hiddenItemIds[href] = true
      }
      const draft: SidebarCustomizationDraft = {
        order,
        groupLabels: { ...responseGroupLabels },
        itemLabels: { ...responseItemLabels },
        hiddenItemIds,
      }
      originalNavRef.current = baseSnapshot
      setCustomDraft(draft)
      setNavGroups(applyCustomizationDraft(baseSnapshot, draft))
      setCustomizing(true)
    } catch (error) {
      console.error('Failed to load sidebar preferences', error)
      setCustomizationError(t('appShell.sidebarCustomizationLoadError'))
    } finally {
      setLoadingPreferences(false)
    }
  }, [customizing, loadingPreferences, navGroups, t])

  const cancelCustomization = React.useCallback(() => {
    setCustomizing(false)
    setCustomDraft(null)
    setCustomizationError(null)
    setAvailableRoleTargets([])
    setSelectedRoleIds([])
    setCanApplyToRoles(false)
    if (originalNavRef.current) {
      setNavGroups(AppShell.cloneGroups(originalNavRef.current))
    }
    originalNavRef.current = null
  }, [])

  const resetCustomization = React.useCallback(() => {
    if (!originalNavRef.current) return
    const base = AppShell.cloneGroups(originalNavRef.current)
    const order = base.map((group) => resolveGroupKey(group))
    const draft: SidebarCustomizationDraft = { order, groupLabels: {}, itemLabels: {}, hiddenItemIds: {} }
    originalNavRef.current = base
    setCustomDraft(draft)
    setNavGroups(applyCustomizationDraft(base, draft))
    if (canApplyToRoles) {
      setSelectedRoleIds(availableRoleTargets.filter((role) => role.hasPreference).map((role) => role.id))
    }
  }, [availableRoleTargets, canApplyToRoles])

  const saveCustomization = React.useCallback(async () => {
    if (!customDraft) return
    setSavingPreferences(true)
    setCustomizationError(null)
    try {
      const baseGroups = originalNavRef.current ?? filterMainSidebarGroups(AppShell.cloneGroups(navGroups))
      const { groupDefaults, itemDefaults } = collectSidebarDefaults(baseGroups)
      const sanitizedGroupLabels: Record<string, string> = {}
      for (const [key, value] of Object.entries(customDraft.groupLabels)) {
        const trimmed = value.trim()
        const base = groupDefaults.get(key)
        if (!trimmed || !base) continue
        if (trimmed !== base) sanitizedGroupLabels[key] = trimmed
      }
      const sanitizedItemLabels: Record<string, string> = {}
      for (const [href, value] of Object.entries(customDraft.itemLabels)) {
        const trimmed = value.trim()
        const base = itemDefaults.get(href)
        if (!trimmed || !base) continue
        if (trimmed !== base) sanitizedItemLabels[href] = trimmed
      }
      const sanitizedHiddenItems: string[] = []
      for (const [href, hidden] of Object.entries(customDraft.hiddenItemIds)) {
        if (!hidden) continue
        if (!itemDefaults.has(href)) continue
        sanitizedHiddenItems.push(href)
      }
      const applyToRolesPayload = canApplyToRoles ? [...selectedRoleIds] : []
      const clearRoleIdsPayload = canApplyToRoles
        ? availableRoleTargets
            .filter((role) => role.hasPreference && !selectedRoleIds.includes(role.id))
            .map((role) => role.id)
        : []
      const payload: Record<string, unknown> = {
        groupOrder: customDraft.order,
        groupLabels: sanitizedGroupLabels,
        itemLabels: sanitizedItemLabels,
        hiddenItems: sanitizedHiddenItems,
      }
      if (canApplyToRoles) {
        payload.applyToRoles = applyToRolesPayload
        payload.clearRoleIds = clearRoleIdsPayload
      }
      const call = await apiCall<{
        canApplyToRoles?: boolean
        roles?: Array<{ id?: string; name?: string; hasPreference?: boolean }>
      }>('/api/auth/sidebar/preferences', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!call.ok) {
        setCustomizationError(t('appShell.sidebarCustomizationSaveError'))
        return
      }
      const data = call.result ?? null
      if (data?.canApplyToRoles !== undefined) {
        setCanApplyToRoles(data.canApplyToRoles === true)
      }
      if (Array.isArray(data?.roles)) {
        const mappedRoles: SidebarRoleTarget[] = (data.roles as Array<{ id?: string; name?: string; hasPreference?: boolean }>).filter((role) => typeof role?.id === 'string' && typeof role?.name === 'string').map((role) => ({
          id: role.id as string,
          name: role.name as string,
          hasPreference: role.hasPreference === true,
        }))
        setAvailableRoleTargets(mappedRoles)
        setSelectedRoleIds(mappedRoles.filter((role) => role.hasPreference).map((role) => role.id))
      }
      originalNavRef.current = applyCustomizationDraft(baseGroups, customDraft)
      setNavGroups(AppShell.cloneGroups(originalNavRef.current))
      setCustomizing(false)
      setCustomDraft(null)
      try { window.dispatchEvent(new Event('om:refresh-sidebar')) } catch {}
    } catch (error) {
      console.error('Failed to save sidebar preferences', error)
      setCustomizationError(t('appShell.sidebarCustomizationSaveError'))
    } finally {
      setSavingPreferences(false)
    }
  }, [customDraft, navGroups, t])

  const moveGroup = React.useCallback((groupId: string, offset: number) => {
    updateDraft((draft) => {
      const order = [...draft.order]
      const index = order.indexOf(groupId)
      if (index === -1) return draft
      const nextIndex = Math.max(0, Math.min(order.length - 1, index + offset))
      if (nextIndex === index) return draft
      order.splice(index, 1)
      order.splice(nextIndex, 0, groupId)
      return { ...draft, order }
    })
  }, [updateDraft])

  const setGroupLabel = React.useCallback((groupId: string, value: string) => {
    updateDraft((draft) => {
      const next = { ...draft.groupLabels }
      if (value.trim().length === 0) delete next[groupId]
      else next[groupId] = value
      return { ...draft, groupLabels: next }
    })
  }, [updateDraft])

  const setItemLabel = React.useCallback((href: string, value: string) => {
    updateDraft((draft) => {
      const next = { ...draft.itemLabels }
      if (value.trim().length === 0) delete next[href]
      else next[href] = value
      return { ...draft, itemLabels: next }
    })
  }, [updateDraft])
  const setItemHidden = React.useCallback((href: string, hidden: boolean) => {
    updateDraft((draft) => {
      const next = { ...draft.hiddenItemIds }
      if (hidden) next[href] = true
      else delete next[href]
      return { ...draft, hiddenItemIds: next }
    })
  }, [updateDraft])

  const toggleRoleSelection = React.useCallback((roleId: string) => {
    setSelectedRoleIds((prev) => (prev.includes(roleId) ? prev.filter((id) => id !== roleId) : [...prev, roleId]))
  }, [])

  const asideWidth = effectiveCollapsed ? '72px' : expandedSidebarWidth
  // Use min-h-svh so the border extends with tall content; keep overflow for long menus
  const asideClassesBase = `border-r bg-background/60 py-4 min-h-svh overflow-y-auto`;

  // Persist collapse state to localStorage and cookie
  React.useEffect(() => {
    try { localStorage.setItem('om:sidebarCollapsed', collapsed ? '1' : '0') } catch {}
    try {
      document.cookie = `om_sidebar_collapsed=${collapsed ? '1' : '0'}; path=/; max-age=31536000; samesite=lax`
    } catch {}
  }, [collapsed])
  React.useEffect(() => {
    try { localStorage.setItem('om:sidebarOpenGroups', JSON.stringify(openGroups)) } catch {}
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

  // Keep navGroups in sync when server-provided groups change
  React.useEffect(() => {
    if (customizing && customDraft && originalNavRef.current) {
      originalNavRef.current = filterMainSidebarGroups(AppShell.cloneGroups(groups))
      setNavGroups(applyCustomizationDraft(originalNavRef.current, customDraft))
      return
    }
    setNavGroups(AppShell.cloneGroups(groups))
  }, [groups, customizing, customDraft])

  // Optional: full refresh from adminNavApi, used to reflect RBAC/org/entity changes without page reload
  React.useEffect(() => {
    let cancelled = false
    function indexIcons(groupsToIndex: AppShellProps['groups']): Map<string, React.ReactNode | undefined> {
      const map = new Map<string, React.ReactNode | undefined>()
      for (const g of groupsToIndex) {
        for (const i of g.items) {
          map.set(i.href, i.icon)
          if (i.children) for (const c of i.children) map.set(c.href, c.icon)
        }
      }
      return map
    }
    function mergePreservingIcons(oldG: AppShellProps['groups'], newG: AppShellProps['groups']): AppShellProps['groups'] {
      const iconMap = indexIcons(oldG)
      const merged = newG.map((g) => ({
        id: g.id,
        name: g.name,
        defaultName: g.defaultName,
        items: g.items.map((i) => ({
          href: i.href,
          title: i.title,
          defaultTitle: i.defaultTitle,
          enabled: i.enabled,
          hidden: i.hidden,
          icon: i.icon ?? iconMap.get(i.href),
          pageContext: i.pageContext,
          children: i.children?.map((c) => ({
            href: c.href,
            title: c.title,
            defaultTitle: c.defaultTitle,
            enabled: c.enabled,
            hidden: c.hidden,
            icon: c.icon ?? iconMap.get(c.href),
            pageContext: c.pageContext,
          })),
        })),
      }))
      return merged
    }
    async function refreshFullNav() {
      if (!adminNavApi) return
      try {
        const call = await apiCall<{ groups?: unknown[] }>(adminNavApi, { credentials: 'include' as any })
        if (!call.ok) return
        const data = call.result
        if (cancelled) return
        const nextGroups = Array.isArray(data?.groups) ? data.groups : []
        if (nextGroups.length) setNavGroups((prev) => AppShell.cloneGroups(mergePreservingIcons(prev, nextGroups as any)))
      } catch {}
    }
    // Refresh on window focus
    const onFocus = () => refreshFullNav()
    window.addEventListener('focus', onFocus)
    return () => { cancelled = true; window.removeEventListener('focus', onFocus) }
  }, [adminNavApi])

  // Refresh sidebar when other parts of the app dispatch an explicit event
  React.useEffect(() => {
    if (!adminNavApi) return
    const api = adminNavApi as string
    let cancelled = false
    function indexIcons(groupsToIndex: AppShellProps['groups']): Map<string, React.ReactNode | undefined> {
      const map = new Map<string, React.ReactNode | undefined>()
      for (const g of groupsToIndex) {
        for (const i of g.items) {
          map.set(i.href, i.icon)
          if (i.children) for (const c of i.children) map.set(c.href, c.icon)
        }
      }
      return map
    }
    function mergePreservingIcons(oldG: AppShellProps['groups'], newG: AppShellProps['groups']): AppShellProps['groups'] {
      const iconMap = indexIcons(oldG)
      const merged = newG.map((g) => ({
        id: g.id,
        name: g.name,
        defaultName: g.defaultName,
        items: g.items.map((i) => ({
          href: i.href,
          title: i.title,
          defaultTitle: i.defaultTitle,
          enabled: i.enabled,
          hidden: i.hidden,
          icon: i.icon ?? iconMap.get(i.href),
          pageContext: i.pageContext,
          children: i.children?.map((c) => ({
            href: c.href,
            title: c.title,
            defaultTitle: c.defaultTitle,
            enabled: c.enabled,
            hidden: c.hidden,
            icon: c.icon ?? iconMap.get(c.href),
            pageContext: c.pageContext,
          })),
        })),
      }))
      return merged
    }
    async function refreshFullNav() {
      try {
        const call = await apiCall<{ groups?: unknown[] }>(api, { credentials: 'include' as any })
        if (!call.ok) return
        const data = call.result
        if (cancelled) return
        const nextGroups = Array.isArray(data?.groups) ? data.groups : []
        if (nextGroups.length) setNavGroups((prev) => AppShell.cloneGroups(mergePreservingIcons(prev, nextGroups as any)))
      } catch {}
    }
    const onRefresh = () => { refreshFullNav() }
    window.addEventListener('om:refresh-sidebar', onRefresh as any)
    return () => { cancelled = true; window.removeEventListener('om:refresh-sidebar', onRefresh as any) }
  }, [adminNavApi])

  // adminNavApi already includes user entities; no extra fetch

  function renderSectionSidebar(
    sections: SectionNavGroup[],
    title: string,
    compact: boolean,
    hideHeader?: boolean
  ) {
    const sortedSections = [...sections].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    const lastVisibleIndex = sortedSections.length - 1

    return (
      <div className="flex flex-col min-h-full gap-3">
        {!hideHeader && (
          <div className={`flex items-center ${compact ? 'justify-center' : 'justify-between'} mb-2`}>
            <Link href="/backend" className="flex items-center gap-2" aria-label={t('appShell.goToDashboard')}>
              <Image src="/open-mercato.svg" alt={resolvedProductName} width={32} height={32} className="rounded m-4" />
              {!compact && <div className="text-m font-semibold">{resolvedProductName}</div>}
            </Link>
          </div>
        )}
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto pr-1">
          <Link
            href="/backend"
            className={`flex items-center gap-2 ${compact ? 'justify-center px-2' : 'px-2'} py-1 text-sm text-muted-foreground hover:text-foreground transition-colors`}
            aria-label={t('backend.nav.backToMain', 'Back')}
          >
            <span className="flex items-center justify-center shrink-0">{BackArrowIcon}</span>
            {!compact && <span>{title}</span>}
          </Link>
          <nav className="flex flex-col gap-2">
          {sortedSections.map((section, sectionIndex) => {
            const visibleItems = section.items
            if (visibleItems.length === 0) return null
            const sortedItems = [...visibleItems].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
            const sectionLabel = section.labelKey ? t(section.labelKey, section.label) : section.label
            const sectionKey = `settings:${section.id}`
            const open = openGroups[sectionKey] !== false
            const sortSectionItems = (items: typeof section.items = []) =>
              [...items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

            const renderSectionItem = (item: (typeof section.items)[number], depth = 0): React.ReactNode => {
              const label = item.labelKey ? t(item.labelKey, item.label) : item.label
              const childItems = sortSectionItems(item.children)
              const isOnItemBranch = !!pathname && (
                pathname === item.href ||
                pathname.startsWith(`${item.href}/`)
              )
              const hasActiveChild = !!(pathname && childItems.some((child) => (
                pathname === child.href ||
                pathname.startsWith(`${child.href}/`)
              )))
              const showChildren = childItems.length > 0 && isOnItemBranch
              const isActive = isOnItemBranch || hasActiveChild
              const base = compact ? 'w-10 h-10 justify-center' : 'py-1 gap-2'
              const spacingStyle = !compact
                ? {
                    paddingLeft: `${8 + depth * 16}px`,
                    paddingRight: '8px',
                  }
                : undefined

              return (
                <React.Fragment key={item.id}>
                  <Link
                    href={item.href}
                    className={`relative text-sm rounded inline-flex items-center ${base} ${
                      isActive
                        ? 'bg-background border shadow-sm'
                        : 'hover:bg-accent hover:text-accent-foreground'
                    }`}
                    style={spacingStyle}
                    title={compact ? label : undefined}
                    onClick={() => setMobileOpen(false)}
                  >
                    {isActive && (
                      <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded bg-foreground" />
                    )}
                    <span className={`flex items-center justify-center shrink-0 ${compact ? '' : 'text-muted-foreground'}`}>
                      {item.icon ?? (item.href.includes('/backend/entities/user/') && item.href.endsWith('/records') ? DataTableIcon : DefaultIcon)}
                    </span>
                    {!compact && <span className="truncate">{label}</span>}
                  </Link>
                  {showChildren ? childItems.map((child) => renderSectionItem(child, depth + 1)) : null}
                </React.Fragment>
              )
            }

            return (
              <div key={section.id}>
                <Button
                  variant="muted"
                  onClick={() => toggleGroup(sectionKey)}
                  className={`w-full ${compact ? 'px-0 justify-center' : 'px-2 justify-between'} flex text-xs uppercase text-muted-foreground/90 py-2`}
                  aria-expanded={open}
                >
                  {!compact && <span>{sectionLabel}</span>}
                  {!compact && <Chevron open={open} />}
                </Button>
                {open && (
                  <div className={`flex flex-col ${compact ? 'items-center' : ''} gap-1 ${!compact ? 'pl-1' : ''}`}>
                    {sortedItems.map((item) => renderSectionItem(item))}
                  </div>
                )}
                {sectionIndex !== lastVisibleIndex && <div className="my-2 border-t border-dotted" />}
              </div>
            )
          })}
        </nav>
        </div>
      </div>
    )
  }

  function renderSidebar(compact: boolean, hideHeader?: boolean) {
    if (sidebarMode === 'settings' && settingsSections && settingsSections.length > 0) {
      return renderSectionSidebar(
        settingsSections,
        settingsSectionTitle ?? t('backend.nav.settings', 'Settings'),
        compact,
        hideHeader
      )
    }

    if (sidebarMode === 'profile' && profileSections && profileSections.length > 0) {
      return renderSectionSidebar(
        profileSections,
        profileSectionTitle ?? t('backend.nav.profile', 'Profile'),
        compact,
        hideHeader
      )
    }

    const isMobileVariant = !!hideHeader
    const shouldRenderSidebarInjectionSpots = !isMobileVariant
    const baseGroupsForDefaults = originalNavRef.current ?? navGroups
    const baseGroupMap = new Map<string, SidebarGroup>()
    for (const group of baseGroupsForDefaults) {
      baseGroupMap.set(resolveGroupKey(group), group)
    }
    const localeLabel = (locale || '').toUpperCase()

    const orderedGroupIds = customDraft
      ? mergeGroupOrder(customDraft.order, Array.from(baseGroupMap.keys()))
      : navGroups.map((group) => resolveGroupKey(group))

    const lastVisibleGroupIndex = (() => {
      for (let idx = navGroups.length - 1; idx >= 0; idx -= 1) {
        if (navGroups[idx].items.some((item) => item.hidden !== true)) return idx
      }
      return -1
    })()

    const renderEditableItems = (baseItems: SidebarItem[], currentItems: SidebarItem[], depth = 0): React.ReactNode => {
      if (!customDraft) return null
      return baseItems.map((baseItem) => {
        const current = currentItems.find((item) => item.href === baseItem.href) ?? baseItem
        const placeholder = baseItem.defaultTitle ?? baseItem.title
        const value = customDraft.itemLabels[baseItem.href] ?? ''
        const hidden = customDraft.hiddenItemIds[baseItem.href] === true
        return (
          <div
            key={baseItem.href}
            className={`flex flex-col gap-1 ${hidden ? 'opacity-60' : ''}`}
            style={depth ? { marginLeft: depth * 16 } : undefined}
          >
            <span className="text-xs font-medium text-muted-foreground">{placeholder}</span>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 accent-foreground"
                checked={!hidden}
                onChange={(event) => setItemHidden(baseItem.href, !event.target.checked)}
                disabled={savingPreferences}
                aria-label={t('appShell.sidebarCustomizationShowItem')}
                title={t('appShell.sidebarCustomizationShowItem')}
              />
              <input
                value={value}
                onChange={(event) => setItemLabel(baseItem.href, event.target.value)}
                placeholder={placeholder}
                disabled={savingPreferences}
                className="h-8 flex-1 rounded border bg-background px-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
              />
            </div>
            {baseItem.children && baseItem.children.length > 0 ? (
              <div className="flex flex-col gap-1">
                {renderEditableItems(baseItem.children, current.children ?? [], depth + 1)}
              </div>
            ) : null}
          </div>
        )
      })
    }

    const customizationEditor = customizing ? (
      customDraft ? (
        <div className="flex flex-col gap-3 rounded border border-dashed bg-muted/20 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold">{t('appShell.sidebarCustomizationHeading')}</div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={resetCustomization}
                disabled={savingPreferences}
              >
                {t('appShell.sidebarCustomizationReset')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={cancelCustomization}
                disabled={savingPreferences}
              >
                {t('appShell.sidebarCustomizationCancel')}
              </Button>
              <Button
                size="sm"
                className="bg-foreground text-background hover:bg-foreground/90"
                onClick={saveCustomization}
                disabled={savingPreferences}
              >
                {savingPreferences ? t('appShell.sidebarCustomizationSaving') : t('appShell.sidebarCustomizationSave')}
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t('appShell.sidebarCustomizationHint', { locale: localeLabel })}</p>
          {canApplyToRoles ? (
            <div className="flex flex-col gap-2 rounded border bg-background/70 p-3 shadow-sm">
              <div>
                <div className="text-sm font-semibold">{t('appShell.sidebarApplyToRolesTitle')}</div>
                <p className="text-xs text-muted-foreground">{t('appShell.sidebarApplyToRolesDescription')}</p>
              </div>
              {availableRoleTargets.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {availableRoleTargets.map((role) => {
                    const checked = selectedRoleIds.includes(role.id)
                    const willClear = role.hasPreference && !checked
                    return (
                      <label key={role.id} className="flex items-center gap-2 rounded border bg-background px-2 py-1 text-sm shadow-sm">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-foreground"
                          checked={checked}
                          onChange={() => toggleRoleSelection(role.id)}
                          disabled={savingPreferences}
                        />
                        <span className="flex-1 truncate">{role.name}</span>
                        {role.hasPreference ? (
                          <span className={`text-xs ${willClear ? 'text-destructive' : 'text-muted-foreground'}`}>
                            {willClear ? t('appShell.sidebarRoleWillClear') : t('appShell.sidebarRoleHasPreset')}
                          </span>
                        ) : null}
                      </label>
                    )
                  })}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">{t('appShell.sidebarApplyToRolesEmpty')}</p>
              )}
            </div>
          ) : null}
          {customizationError ? <p className="text-xs text-destructive">{customizationError}</p> : null}
          <div className="flex flex-col gap-3">
            {orderedGroupIds.map((groupId, index) => {
              const baseGroup = baseGroupMap.get(groupId)
              if (!baseGroup) return null
              const currentGroup = navGroups.find((group) => resolveGroupKey(group) === groupId) ?? baseGroup
              const placeholder = baseGroup.defaultName ?? baseGroup.name
              const value = customDraft.groupLabels[groupId] ?? ''
              return (
                <div key={groupId} className="flex flex-col gap-3 rounded border bg-background p-3 shadow-sm">
                  <div className={`flex ${compact ? 'flex-col gap-2' : 'items-center gap-2'}`}>
                    <div className="flex-1">
                      <span className="text-xs font-medium text-muted-foreground">{t('appShell.sidebarCustomizationGroupLabel')}</span>
                      <input
                        value={value}
                        onChange={(event) => setGroupLabel(groupId, event.target.value)}
                        placeholder={placeholder}
                        disabled={savingPreferences}
                        className="mt-1 h-8 w-full rounded border bg-background px-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
                      />
                    </div>
                    <div className="flex items-center gap-1 self-start">
                      <IconButton
                        variant="outline"
                        size="sm"
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() => moveGroup(groupId, -1)}
                        disabled={index === 0 || savingPreferences}
                        aria-label={t('appShell.sidebarCustomizationMoveUp')}
                      >
                        <ChevronUp className="size-4" />
                      </IconButton>
                      <IconButton
                        variant="outline"
                        size="sm"
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() => moveGroup(groupId, 1)}
                        disabled={index === orderedGroupIds.length - 1 || savingPreferences}
                        aria-label={t('appShell.sidebarCustomizationMoveDown')}
                      >
                        <ChevronDown className="size-4" />
                      </IconButton>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    {renderEditableItems(baseGroup.items, currentGroup.items)}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="rounded border border-dashed bg-muted/20 p-3 text-sm text-muted-foreground">
          {t('appShell.sidebarCustomizationLoading')}
        </div>
      )
    ) : null

    return (
      <div className="flex flex-col min-h-full gap-3">
        {!hideHeader && (
          <div className={`flex items-center ${compact ? 'justify-center' : 'justify-between'} mb-2`}>
            <Link href="/backend" className="flex items-center gap-2" aria-label={t('appShell.goToDashboard')}>
              <Image src="/open-mercato.svg" alt={resolvedProductName} width={32} height={32} className="rounded m-4" />
              {!compact && <div className="text-m font-semibold">{resolvedProductName}</div>}
            </Link>
          </div>
        )}
        {shouldRenderSidebarInjectionSpots ? (
          <InjectionSpot
            spotId={BACKEND_SIDEBAR_TOP_INJECTION_SPOT_ID}
            context={injectionContext}
          />
        ) : null}
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto pr-1">
          {customizing ? (
            customizationEditor
          ) : (
            (() => {
              const isSettingsPath = (href: string) => {
                if (href === '/backend/settings') return true
                return settingsPathPrefixes.some((prefix) => href.startsWith(prefix))
              }

              const isMainItem = (item: SidebarItem) => {
                if (item.pageContext && item.pageContext !== 'main') return false
                if (isSettingsPath(item.href)) return false
                return true
              }

              const mainGroups = navGroups.map((g) => ({
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
                  <nav className="flex flex-col gap-2">
                    {mainGroups.map((g, gi) => {
                      const groupId = resolveGroupKey(g)
                      const open = openGroups[groupId] !== false
                      const visibleItems = g.items.filter((item) => item.hidden !== true)
                      if (visibleItems.length === 0) return null
                      return (
                        <div key={groupId}>
                          <Button
                            variant="muted"
                            onClick={() => toggleGroup(groupId)}
                            className={`w-full ${compact ? 'px-0 justify-center' : 'px-2 justify-between'} flex text-xs uppercase text-muted-foreground/90 py-2`}
                            aria-expanded={open}
                          >
                            {!compact && <span>{g.name}</span>}
                            {!compact && <Chevron open={open} />}
                          </Button>
                          {open && (
                            <div className={`flex flex-col ${compact ? 'items-center' : ''} gap-1 ${!compact ? 'pl-1' : ''}`}>
                              {visibleItems.map((i) => {
                                const childItems = (i.children ?? []).filter((child) => child.hidden !== true)
                                const showChildren = !!pathname && childItems.length > 0 && pathname.startsWith(i.href)
                                const hasActiveChild = !!(pathname && childItems.some((c) => pathname.startsWith(c.href)))
                                const isParentActive = (pathname === i.href) || (showChildren && !hasActiveChild)
                                const base = compact ? 'w-10 h-10 justify-center' : 'px-2 py-1 gap-2'
                                return (
                                  <React.Fragment key={i.href}>
                                    <Link
                                      href={i.href}
                                      className={`relative text-sm rounded inline-flex items-center ${base} ${
                                        isParentActive ? 'bg-background border shadow-sm' : 'hover:bg-accent hover:text-accent-foreground'
                                      } ${i.enabled === false ? 'pointer-events-none opacity-50' : ''}`}
                                      aria-disabled={i.enabled === false}
                                      title={compact ? i.title : undefined}
                                      onClick={() => setMobileOpen(false)}
                                    >
                                      {isParentActive ? (
                                        <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded bg-foreground" />
                                      ) : null}
                                      <span className={`flex items-center justify-center shrink-0 ${compact ? '' : 'text-muted-foreground'}`}>
                                        {i.icon ?? DefaultIcon}
                                      </span>
                                      {!compact && <span>{i.title}</span>}
                                    </Link>
                                    {showChildren ? (
                                      <div className={`flex flex-col ${compact ? 'items-center' : ''} gap-1 ${!compact ? 'pl-4' : ''}`}>
                                        {childItems.map((c) => {
                                          const childActive = pathname?.startsWith(c.href)
                                          const childBase = compact ? 'w-10 h-8 justify-center' : 'px-2 py-1 gap-2'
                                          return (
                                            <Link
                                              key={c.href}
                                              href={c.href}
                                              className={`relative text-sm rounded inline-flex items-center ${childBase} ${
                                                childActive ? 'bg-background border shadow-sm' : 'hover:bg-accent hover:text-accent-foreground'
                                              } ${c.enabled === false ? 'pointer-events-none opacity-50' : ''}`}
                                              aria-disabled={c.enabled === false}
                                              title={compact ? c.title : undefined}
                                              onClick={() => setMobileOpen(false)}
                                            >
                                              {childActive ? (
                                                <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded bg-foreground" />
                                              ) : null}
                                              <span className={`flex items-center justify-center shrink-0 ${compact ? '' : 'text-muted-foreground'}`}>
                                                {c.icon ?? (c.href.includes('/backend/entities/user/') && c.href.endsWith('/records') ? DataTableIcon : DefaultIcon)}
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
                          {gi !== mainLastVisibleGroupIndex && <div className="my-2 border-t border-dotted" />}
                        </div>
                      )
                    })}
                  </nav>
                  <div className="mt-4 pt-4 border-t">
                    <Link
                      href="/backend/settings"
                      className={`relative text-sm rounded inline-flex items-center w-full ${
                        compact ? 'w-10 h-10 justify-center' : 'px-2 py-1 gap-2'
                      } ${
                        pathname?.startsWith('/backend/settings') || pathname?.startsWith('/backend/config') || pathname?.startsWith('/backend/users') || pathname?.startsWith('/backend/roles') || pathname?.startsWith('/backend/api-keys') || pathname?.startsWith('/backend/entities') || pathname?.startsWith('/backend/query-indexes') || pathname?.startsWith('/backend/definitions') || pathname?.startsWith('/backend/instances') || pathname?.startsWith('/backend/tasks') || pathname?.startsWith('/backend/events') || pathname?.startsWith('/backend/rules') || pathname?.startsWith('/backend/sets') || pathname?.startsWith('/backend/logs') || pathname?.startsWith('/backend/directory') || pathname?.startsWith('/backend/feature-toggles')
                          ? 'bg-background border shadow-sm font-medium'
                          : 'hover:bg-accent hover:text-accent-foreground'
                      }`}
                      title={compact ? t('backend.nav.settings', 'Settings') : undefined}
                      onClick={() => setMobileOpen(false)}
                    >
                      {(pathname?.startsWith('/backend/settings') || pathname?.startsWith('/backend/config') || pathname?.startsWith('/backend/users') || pathname?.startsWith('/backend/roles') || pathname?.startsWith('/backend/api-keys') || pathname?.startsWith('/backend/entities') || pathname?.startsWith('/backend/query-indexes') || pathname?.startsWith('/backend/definitions') || pathname?.startsWith('/backend/instances') || pathname?.startsWith('/backend/tasks') || pathname?.startsWith('/backend/events') || pathname?.startsWith('/backend/rules') || pathname?.startsWith('/backend/sets') || pathname?.startsWith('/backend/logs') || pathname?.startsWith('/backend/directory') || pathname?.startsWith('/backend/feature-toggles')) && (
                        <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded bg-foreground" />
                      )}
                      <span className={`flex items-center justify-center shrink-0 ${compact ? '' : 'text-muted-foreground'}`}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="3" />
                          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                        </svg>
                      </span>
                      {!compact && <span>{t('backend.nav.settings', 'Settings')}</span>}
                    </Link>
                  </div>
                </>
              )
            })()
          )}
        </div>
        {!customizing && (
          <>
          {compact || isMobileVariant ? (
            <IconButton
              variant="outline"
              size="lg"
              className="mt-auto"
              onClick={startCustomization}
              disabled={loadingPreferences}
              aria-label={t('appShell.customizeSidebar')}
            >
              {CustomizeIcon}
            </IconButton>
          ) : (
            <Button
              variant="outline"
              size="default"
              className="mt-auto"
              onClick={startCustomization}
              disabled={loadingPreferences}
              aria-label={t('appShell.customizeSidebar')}
            >
              {CustomizeIcon}
              {loadingPreferences ? t('appShell.sidebarCustomizationLoading') : t('appShell.customizeSidebar')}
            </Button>
          )}
          </>
        )}
        {shouldRenderSidebarInjectionSpots ? (
          <InjectionSpot
            spotId={BACKEND_SIDEBAR_FOOTER_INJECTION_SPOT_ID}
            context={injectionContext}
          />
        ) : null}
      </div>
    )
  }

  const gridColsClass = customizing
    ? 'lg:grid-cols-[320px_1fr]'
    : (effectiveCollapsed ? 'lg:grid-cols-[72px_1fr]' : 'lg:grid-cols-[240px_1fr]')
  const headerCtxValue = React.useMemo(() => ({
    setBreadcrumb: setHeaderBreadcrumb,
    setTitle: setHeaderTitle,
  }), [])

  return (
    <HeaderContext.Provider value={headerCtxValue}>
    <div className={`min-h-svh lg:grid ${gridColsClass}`}>
      {/* Desktop sidebar */}
      <aside className={`${asideClassesBase} ${effectiveCollapsed ? 'px-2' : 'px-3'} hidden lg:block`} style={{ width: asideWidth }}>{renderSidebar(effectiveCollapsed)}</aside>

      <div className="flex min-h-svh flex-col min-w-0">
        <header className="border-b bg-background/60 px-3 lg:px-4 py-2 lg:py-3 flex items-center justify-between gap-2">
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
              disabled={customizing}
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
            {rightHeaderSlot ? (
              rightHeaderSlot
            ) : (
              <span className="opacity-80">{email || t('appShell.userFallback')}</span>
            )}
          </div>
        </header>
        <main className="flex-1 p-4 lg:p-6">
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
        <footer className="border-t bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/50 px-4 py-3 flex flex-wrap items-center justify-end gap-4">
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
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 flex h-full w-[260px] flex-col bg-background border-r overflow-hidden">
            <div className="shrink-0 p-3 pb-2 flex items-center justify-between border-b">
              <Link href="/backend" className="flex items-center gap-2 text-sm font-semibold" onClick={() => setMobileOpen(false)} aria-label={t('appShell.goToDashboard')}>
                <Image src="/open-mercato.svg" alt={resolvedProductName} width={28} height={28} className="rounded" />
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
    </HeaderContext.Provider>
  )
}

// Helper: deep-clone minimal shape we mutate (children arrays)
AppShell.cloneGroups = function cloneGroups(groups: AppShellProps['groups']): AppShellProps['groups'] {
  const cloneItem = (item: SidebarItem): SidebarItem => ({
    href: item.href,
    title: item.title,
    defaultTitle: item.defaultTitle,
    icon: item.icon,
    enabled: item.enabled,
    hidden: item.hidden,
    pageContext: item.pageContext,
    children: item.children ? item.children.map((child) => cloneItem(child)) : undefined,
  })
  return groups.map((group) => ({
    id: group.id,
    name: group.name,
    defaultName: group.defaultName,
    items: group.items.map((item) => cloneItem(item)),
  }))
}

function applyCustomizationDraft(baseGroups: SidebarGroup[], draft: SidebarCustomizationDraft): SidebarGroup[] {
  const clones = AppShell.cloneGroups(baseGroups)
  const byId = new Map<string, SidebarGroup>()
  for (const group of clones) {
    byId.set(resolveGroupKey(group), group)
  }
  const orderedIds = mergeGroupOrder(draft.order, Array.from(byId.keys()))
  const seen = new Set<string>()
  const result: SidebarGroup[] = []
  for (const id of orderedIds) {
    if (seen.has(id)) continue
    const group = byId.get(id)
    if (!group) continue
    seen.add(id)
    const baseName = group.defaultName ?? group.name
    const override = draft.groupLabels[id]?.trim()
    result.push({
      ...group,
      name: override && override.length > 0 ? override : baseName,
      items: group.items.map((item) => applyItemDraft(item, draft)),
    })
  }
  return result
}

function applyItemDraft(item: SidebarItem, draft: SidebarCustomizationDraft): SidebarItem {
  const baseTitle = item.defaultTitle ?? item.title
  const override = draft.itemLabels[item.href]?.trim()
  const children = item.children
    ? item.children
        .map((child) => applyItemDraft(child, draft))
    : undefined
  const hidden = draft.hiddenItemIds[item.href] === true
  return {
    ...item,
    title: override && override.length > 0 ? override : baseTitle,
    hidden,
    children,
  }
}

function mergeGroupOrder(preferred: string[], current: string[]): string[] {
  const seen = new Set<string>()
  const merged: string[] = []
  for (const id of preferred) {
    const trimmed = id.trim()
    if (!trimmed || seen.has(trimmed) || !current.includes(trimmed)) continue
    seen.add(trimmed)
    merged.push(trimmed)
  }
  for (const id of current) {
    if (seen.has(id)) continue
    seen.add(id)
    merged.push(id)
  }
  return merged
}

function collectSidebarDefaults(groups: SidebarGroup[]) {
  const groupDefaults = new Map<string, string>()
  const itemDefaults = new Map<string, string>()

  const visitItems = (items: SidebarItem[]) => {
    for (const item of items) {
      const baseTitle = item.defaultTitle ?? item.title
      itemDefaults.set(item.href, baseTitle)
      if (item.children && item.children.length > 0) visitItems(item.children)
    }
  }

  for (const group of groups) {
    const key = resolveGroupKey(group)
    groupDefaults.set(key, group.defaultName ?? group.name)
    visitItems(group.items)
  }

  return { groupDefaults, itemDefaults }
}

/**
 * Filters groups to include only main sidebar items.
 * Excludes items with pageContext 'settings' or 'profile' from customization.
 * Per SPEC-007: Sidebar customization applies only to the main sidebar.
 */
function filterMainSidebarGroups(groups: SidebarGroup[]): SidebarGroup[] {
  const isMainItem = (item: SidebarItem): boolean => {
    if (item.pageContext && item.pageContext !== 'main') return false
    return true
  }

  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter(isMainItem).map((item) => ({
        ...item,
        children: item.children?.filter(isMainItem),
      })),
    }))
    .filter((group) => group.items.length > 0)
}
