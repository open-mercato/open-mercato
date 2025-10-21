"use client"
import * as React from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Separator } from '../primitives/separator'
import { FlashMessages } from './FlashMessages'
import { usePathname } from 'next/navigation'
import { apiFetch } from './utils/api'
import { LanguageSwitcher } from '../frontend/LanguageSwitcher'
import { LastOperationBanner } from './operations/LastOperationBanner'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { slugifySidebarId } from '@open-mercato/shared/modules/navigation/sidebarPreferences'

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
      children?: {
        href: string
        title: string
        defaultTitle?: string
        icon?: React.ReactNode
        enabled?: boolean
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

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={`transition-transform ${open ? 'rotate-180' : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
  )
}

export function AppShell({ productName, email, groups, rightHeaderSlot, children, sidebarCollapsedDefault = false, currentTitle, breadcrumb, adminNavApi }: AppShellProps) {
  const pathname = usePathname()
  const t = useT()
  const locale = useLocale()
  const resolvedProductName = productName ?? t('appShell.productName')
  const [mobileOpen, setMobileOpen] = React.useState(false)
  // Initialize from server-provided prop only to avoid hydration flicker
  const [collapsed, setCollapsed] = React.useState<boolean>(sidebarCollapsedDefault)
  // Maintain internal nav state so we can augment it client-side
  const [navGroups, setNavGroups] = React.useState(AppShell.cloneGroups(groups))
  const [openGroups, setOpenGroups] = React.useState<Record<string, boolean>>(() => {
    const base = Object.fromEntries(groups.map(g => [resolveGroupKey(g), true])) as Record<string, boolean>
    if (typeof window === 'undefined') return base
    try {
      const savedOpen = localStorage.getItem('om:sidebarOpenGroups')
      if (savedOpen) {
        const parsed = JSON.parse(savedOpen) as Record<string, boolean>
        for (const group of groups) {
          const key = resolveGroupKey(group)
          if (key in parsed) base[key] = !!parsed[key]
          else if (group.name in parsed) base[key] = !!parsed[group.name]
        }
      }
    } catch {}
    return base
  })
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

  const toggleGroup = (groupId: string) => setOpenGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }))

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
     const baseSnapshot = AppShell.cloneGroups(navGroups)
     const res = await apiFetch('/api/auth/sidebar/preferences')
      const data = res.ok ? await res.json().catch(() => null) : null
      const rawSettings = data?.settings
      const responseSettings = {
        order: Array.isArray(rawSettings?.groupOrder) ? rawSettings.groupOrder.filter((id: unknown): id is string => typeof id === 'string') : [],
        groupLabels: rawSettings?.groupLabels && typeof rawSettings.groupLabels === 'object' ? rawSettings.groupLabels : {},
        itemLabels: rawSettings?.itemLabels && typeof rawSettings.itemLabels === 'object' ? rawSettings.itemLabels : {},
        hiddenItems: Array.isArray(rawSettings?.hiddenItems)
          ? rawSettings.hiddenItems
              .filter((href: unknown): href is string => typeof href === 'string')
              .map((href: string) => href.trim())
              .filter((href) => href.length > 0)
          : [],
      }
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
      const order = mergeGroupOrder(responseSettings.order, currentIds)
      const { itemDefaults } = collectSidebarDefaults(baseSnapshot)
      const hiddenItemIds: Record<string, boolean> = {}
      for (const href of responseSettings.hiddenItems) {
        if (!itemDefaults.has(href)) continue
        hiddenItemIds[href] = true
      }
      const draft: SidebarCustomizationDraft = {
        order,
        groupLabels: { ...responseSettings.groupLabels },
        itemLabels: { ...responseSettings.itemLabels },
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
      const baseGroups = originalNavRef.current ?? AppShell.cloneGroups(navGroups)
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
      const res = await apiFetch('/api/auth/sidebar/preferences', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        setCustomizationError(t('appShell.sidebarCustomizationSaveError'))
        return
      }
      const data = await res.json().catch(() => null)
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
      originalNavRef.current = AppShell.cloneGroups(groups)
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
          icon: i.icon ?? iconMap.get(i.href),
          children: i.children?.map((c) => ({
            href: c.href,
            title: c.title,
            defaultTitle: c.defaultTitle,
            enabled: c.enabled,
            icon: c.icon ?? iconMap.get(c.href),
          })),
        })),
      }))
      return merged
    }
    async function refreshFullNav() {
      if (!adminNavApi) return
      try {
        const res = await apiFetch(adminNavApi, { credentials: 'include' as any })
        if (!res.ok) return
        const data = await res.json()
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
        name: g.name,
        items: g.items.map((i) => ({
          href: i.href,
          title: i.title,
          enabled: i.enabled,
          icon: i.icon ?? iconMap.get(i.href),
          children: i.children?.map((c) => ({
            href: c.href,
            title: c.title,
            enabled: c.enabled,
            icon: c.icon ?? iconMap.get(c.href),
          })),
        })),
      }))
      return merged
    }
    async function refreshFullNav() {
      try {
        const res = await apiFetch(api, { credentials: 'include' as any })
        if (!res.ok) return
        const data = await res.json()
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

  function renderSidebar(compact: boolean, hideHeader?: boolean) {
    const isMobileVariant = !!hideHeader
    const baseGroupsForDefaults = originalNavRef.current ?? navGroups
    const baseGroupMap = new Map<string, SidebarGroup>()
    for (const group of baseGroupsForDefaults) {
      baseGroupMap.set(resolveGroupKey(group), group)
    }
    const localeLabel = (locale || '').toUpperCase()

    const orderedGroupIds = customDraft
      ? mergeGroupOrder(customDraft.order, Array.from(baseGroupMap.keys()))
      : navGroups.map((group) => resolveGroupKey(group))

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
              <button
                type="button"
                className="h-8 rounded border px-3 text-sm"
                onClick={resetCustomization}
                disabled={savingPreferences}
              >
                {t('appShell.sidebarCustomizationReset')}
              </button>
              <button
                type="button"
                className="h-8 rounded border px-3 text-sm"
                onClick={cancelCustomization}
                disabled={savingPreferences}
              >
                {t('appShell.sidebarCustomizationCancel')}
              </button>
              <button
                type="button"
                className="h-8 rounded bg-foreground px-3 text-sm font-medium text-background disabled:opacity-60"
                onClick={saveCustomization}
                disabled={savingPreferences}
              >
                {savingPreferences ? t('appShell.sidebarCustomizationSaving') : t('appShell.sidebarCustomizationSave')}
              </button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t('appShell.sidebarCustomizationHint', { locale: localeLabel })}</p>
          {canApplyToRoles ? (
            <div className="flex flex-col gap-2 rounded border bg-background/70 p-3">
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
                      <button
                        type="button"
                        className="h-8 w-8 rounded border text-muted-foreground hover:text-foreground disabled:opacity-40"
                        onClick={() => moveGroup(groupId, -1)}
                        disabled={index === 0 || savingPreferences}
                        aria-label={t('appShell.sidebarCustomizationMoveUp')}
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        className="h-8 w-8 rounded border text-muted-foreground hover:text-foreground disabled:opacity-40"
                        onClick={() => moveGroup(groupId, 1)}
                        disabled={index === orderedGroupIds.length - 1 || savingPreferences}
                        aria-label={t('appShell.sidebarCustomizationMoveDown')}
                      >
                        ▼
                      </button>
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
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto pr-1">
          {customizing ? (
            customizationEditor
          ) : (
            <nav className="flex flex-col gap-2">
              {navGroups.map((g, gi) => {
                const groupId = resolveGroupKey(g)
                const open = openGroups[groupId] !== false
                return (
                  <div key={groupId}>
                    <button
                      type="button"
                      onClick={() => toggleGroup(groupId)}
                      className={`w-full ${compact ? 'px-0 justify-center' : 'px-2 justify-between'} flex items-center text-xs uppercase text-muted-foreground/90 py-2`}
                      aria-expanded={open}
                    >
                      {!compact && <span>{g.name}</span>}
                      {!compact && <Chevron open={open} />}
                    </button>
                    {open && (
                      <div className={`flex flex-col ${compact ? 'items-center' : ''} gap-1 ${!compact ? 'pl-1' : ''}`}>
                        {g.items.map((i) => {
                          const showChildren = !!pathname && pathname.startsWith(i.href)
                          const hasActiveChild = !!(i.children && pathname && i.children.some((c) => pathname.startsWith(c.href)))
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
                              {showChildren && i.children && i.children.length > 0 ? (
                                <div className={`flex flex-col ${compact ? 'items-center' : ''} gap-1 ${!compact ? 'pl-4' : ''}`}>
                                  {i.children.map((c) => {
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
                    {gi < navGroups.length - 1 && <div className="my-2 border-t border-dotted" />}
                  </div>
                )
              })}
            </nav>
          )}
        </div>
        {!customizing && (
          <button
            type="button"
            onClick={startCustomization}
            className={`mt-auto inline-flex items-center justify-center gap-2 rounded border hover:bg-accent hover:text-accent-foreground disabled:opacity-60 ${
              compact || isMobileVariant ? 'h-10 w-10 p-0' : 'h-9 px-3 text-sm font-medium'
            }`}
            disabled={loadingPreferences}
            aria-label={t('appShell.customizeSidebar')}
          >
            <span className="flex items-center justify-center">{CustomizeIcon}</span>
            {!(compact || isMobileVariant) && (
              <span>{loadingPreferences ? t('appShell.sidebarCustomizationLoading') : t('appShell.customizeSidebar')}</span>
            )}
          </button>
        )}
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

      <div className="flex min-h-svh flex-col">
        <header className="border-b bg-background/60 px-3 lg:px-4 py-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Mobile menu button */}
            <button type="button" className="lg:hidden rounded border px-2 py-1" aria-label={t('appShell.openMenu')} onClick={() => setMobileOpen(true)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
            </button>
            {/* Desktop collapse toggle */}
            <button
              type="button"
              className="hidden lg:inline-flex rounded border px-2 py-1 disabled:opacity-60"
              aria-label={t('appShell.toggleSidebar')}
              onClick={() => setCollapsed((c) => !c)}
              disabled={customizing}
            >
              {/* Sidebar toggle icon */}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="16" rx="2"/>
                <path d="M9 4v16"/>
              </svg>
            </button>
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
              return (
                <nav className="flex items-center gap-2 text-sm">
                  {items.map((b, i) => (
                    <React.Fragment key={i}>
                      {i > 0 && <span className="text-muted-foreground">/</span>}
                      {b.href ? (
                        <Link href={b.href} className="text-muted-foreground hover:text-foreground">
                          {b.label}
                        </Link>
                      ) : (
                        <span className="font-medium truncate max-w-[60vw]">{b.label}</span>
                      )}
                    </React.Fragment>
                  ))}
                </nav>
              )
            })()}
          </div>
          <div className="flex items-center gap-2 text-sm w-full lg:w-auto lg:justify-end">
            {rightHeaderSlot ? (
              rightHeaderSlot
            ) : (
              <>
                <Separator className="w-px h-5 mx-1" />
                <span className="opacity-80">{email || t('appShell.userFallback')}</span>
              </>
            )}
          </div>
        </header>
        <main className="flex-1 p-4 lg:p-6">
          <FlashMessages />
          <LastOperationBanner />
          {children}
        </main>
        <footer className="border-t bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/50 px-4 py-3 flex justify-end">
          <LanguageSwitcher />
        </footer>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-[260px] bg-background border-r p-3">
            <div className="mb-2 flex items-center justify-between">
              <Link href="/backend" className="flex items-center gap-2 text-sm font-semibold" onClick={() => setMobileOpen(false)} aria-label={t('appShell.goToDashboard')}>
                <Image src="/open-mercato.svg" alt={resolvedProductName} width={28} height={28} className="rounded" />
                {resolvedProductName}
              </Link>
              <button className="rounded border px-2 py-1" onClick={() => setMobileOpen(false)} aria-label={t('appShell.closeMenu')}>✕</button>
            </div>
            {/* Force expanded sidebar in mobile drawer, hide its header and collapse toggle */}
            {renderSidebar(false, true)}
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
    const appliedItems = group.items
      .map((item) => applyItemDraft(item, draft))
      .filter((item): item is SidebarItem => item !== null)
    result.push({
      ...group,
      name: override && override.length > 0 ? override : baseName,
      items: appliedItems,
    })
  }
  return result
}

function applyItemDraft(item: SidebarItem, draft: SidebarCustomizationDraft): SidebarItem | null {
  if (draft.hiddenItemIds[item.href] === true) return null
  const baseTitle = item.defaultTitle ?? item.title
  const override = draft.itemLabels[item.href]?.trim()
  const children = item.children
    ? item.children
        .map((child) => applyItemDraft(child, draft))
        .filter((child): child is SidebarItem => child !== null)
    : undefined
  return {
    ...item,
    title: override && override.length > 0 ? override : baseTitle,
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
