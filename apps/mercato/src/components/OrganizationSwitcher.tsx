"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { emitOrganizationScopeChanged } from '@open-mercato/shared/lib/frontend/organizationEvents'
import { OrganizationSelect, type OrganizationTreeNode } from '@open-mercato/core/modules/directory/components/OrganizationSelect'
import { TenantSelect, type TenantRecord } from '@open-mercato/core/modules/directory/components/TenantSelect'
import { ALL_ORGANIZATIONS_COOKIE_VALUE } from '@open-mercato/core/modules/directory/constants'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type OrganizationMenuNode = {
  id: string
  name: string
  depth: number
  selectable: boolean
  children: OrganizationMenuNode[]
}

type SwitcherState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'hidden' }
  | {
      status: 'ready'
      nodes: OrganizationMenuNode[]
      selectedId: string | null
      canManage: boolean
      tenantId: string | null
      tenants: TenantRecord[]
      isSuperAdmin: boolean
    }

type SelectedCookieState = {
  value: string
  hasCookie: boolean
  raw: string | null
}

type TenantCookieState = {
  value: string
  hasCookie: boolean
  raw: string | null
}

type OrganizationSwitcherPayload = {
  items?: unknown
  selectedId?: string | null
  canManage?: boolean
  tenantId?: string | null
  tenants?: unknown
  isSuperAdmin?: boolean
}

function readSelectedOrganizationCookie(): SelectedCookieState {
  if (typeof document === 'undefined') return { value: '', hasCookie: false, raw: null }
  const cookies = document.cookie.split(';')
  for (const entry of cookies) {
    const trimmed = entry.trim()
    if (trimmed.startsWith('om_selected_org=')) {
      const raw = trimmed.slice('om_selected_org='.length)
      try {
        const decoded = decodeURIComponent(raw)
        if (!decoded) {
          return { value: '', hasCookie: true, raw: '' }
        }
        if (decoded === ALL_ORGANIZATIONS_COOKIE_VALUE) {
          return { value: '', hasCookie: true, raw: decoded }
        }
        return { value: decoded, hasCookie: true, raw: decoded }
      } catch {
        if (!raw) {
          return { value: '', hasCookie: true, raw }
        }
        if (raw === ALL_ORGANIZATIONS_COOKIE_VALUE) {
          return { value: '', hasCookie: true, raw }
        }
        return { value: raw, hasCookie: true, raw }
      }
    }
  }
  return { value: '', hasCookie: false, raw: null }
}

function readSelectedTenantCookie(): TenantCookieState {
  if (typeof document === 'undefined') return { value: '', hasCookie: false, raw: null }
  const cookies = document.cookie.split(';')
  for (const entry of cookies) {
    const trimmed = entry.trim()
    if (trimmed.startsWith('om_selected_tenant=')) {
      const raw = trimmed.slice('om_selected_tenant='.length)
      try {
        const decoded = decodeURIComponent(raw)
        return { value: decoded || '', hasCookie: true, raw: decoded }
      } catch {
        return { value: raw || '', hasCookie: true, raw }
      }
    }
  }
  return { value: '', hasCookie: false, raw: null }
}

function findFirstSelectable(nodes: OrganizationMenuNode[] | undefined): string | null {
  if (!Array.isArray(nodes)) return null
  for (const node of nodes) {
    if (!node) continue
    if (node.selectable !== false && typeof node.id === 'string' && node.id) return node.id
    const child = findFirstSelectable(node.children)
    if (child) return child
  }
  return null
}

type OrganizationSwitcherExternalProps = {
  compact?: boolean
}

export default function OrganizationSwitcher({ compact }: OrganizationSwitcherExternalProps = {}) {
  const router = useRouter()
  const t = useT()
  const [state, setState] = React.useState<SwitcherState>({ status: 'loading' })
  const [cookieState, setCookieState] = React.useState<SelectedCookieState>(() => readSelectedOrganizationCookie())
  const [tenantCookieState, setTenantCookieState] = React.useState<TenantCookieState>(() => readSelectedTenantCookie())
  const cookieStateRef = React.useRef(cookieState)
  cookieStateRef.current = cookieState
  const tenantCookieRef = React.useRef(tenantCookieState)
  tenantCookieRef.current = tenantCookieState
  const value = cookieState.value
  const tenantValue = tenantCookieState.value

  const persistTenant = React.useCallback((next: string | null, options?: { refresh?: boolean }) => {
    if (typeof document === 'undefined') return
    const resolved = next ?? ''
    setTenantCookieState({ value: resolved, hasCookie: true, raw: resolved })
    const maxAge = 60 * 60 * 24 * 30
    try {
      document.cookie = `om_selected_tenant=${encodeURIComponent(resolved)}; path=/; max-age=${maxAge}; samesite=lax`
    } catch {
      // ignore failures
    }
    if (options?.refresh !== false) {
      try { router.refresh() } catch {}
    }
  }, [router])

  const persistSelection = React.useCallback((tenantId: string | null, next: string | null, options?: { refresh?: boolean }) => {
    const resolved = next ?? ''
    const cookieValue = next ?? ALL_ORGANIZATIONS_COOKIE_VALUE
    setCookieState({ value: resolved, hasCookie: true, raw: cookieValue })
    const maxAge = 60 * 60 * 24 * 30 // 30 days
    if (typeof document !== 'undefined') {
      document.cookie = `om_selected_org=${encodeURIComponent(cookieValue)}; path=/; max-age=${maxAge}; samesite=lax`
    }
    if (tenantId !== undefined) {
      persistTenant(tenantId ?? null, { refresh: false })
    }
    emitOrganizationScopeChanged({ organizationId: resolved || null, tenantId: tenantId ?? null })
    if (options?.refresh !== false) {
      try { router.refresh() } catch {}
    }
  }, [persistTenant, router])

  const handleChange = React.useCallback((next: string | null) => {
    const tenantId = state.status === 'ready' ? state.tenantId ?? null : tenantValue || null
    persistSelection(tenantId, next, { refresh: true })
  }, [persistSelection, state, tenantValue])

  type LoadOptions = { tenantId?: string | null; abortRef?: { current: boolean }; refreshAfter?: boolean }

  const load = React.useCallback(async (options?: LoadOptions) => {
    const abortRef = options?.abortRef
    const targetTenant = typeof options?.tenantId === 'string' && options.tenantId.trim().length > 0 ? options.tenantId.trim() : null
    setState({ status: 'loading' })
    try {
      const params = new URLSearchParams()
      if (targetTenant) params.set('tenantId', targetTenant)
      const search = params.toString()
      const url = `/api/directory/organization-switcher${search ? `?${search}` : ''}`
      const call = await apiCall<OrganizationSwitcherPayload>(url)
      if (abortRef?.current) return
      if (call.status === 401 || call.status === 403) {
        setState({ status: 'hidden' })
        return
      }
      if (!call.ok) {
        await raiseCrudError(call.response, t('organizationSwitcher.error', 'Failed to load'))
      }
      const json = (call.result ?? {}) as OrganizationSwitcherPayload
      if (abortRef?.current) return
      const rawItems = Array.isArray(json.items) ? json.items : []
      const selected = typeof json.selectedId === 'string' ? json.selectedId : null
      const manage = Boolean(json.canManage)
      const resolvedTenantId = typeof json.tenantId === 'string' && json.tenantId.trim().length > 0 ? json.tenantId.trim() : null
      const tenantList = Array.isArray(json.tenants)
        ? (json.tenants as unknown[]).map((entry) => {
            if (!entry || typeof entry !== 'object') return null
            const record = entry as Record<string, unknown>
            const id = typeof record.id === 'string' ? record.id : null
            if (!id) return null
            const name = typeof record.name === 'string' && record.name.length > 0 ? record.name : id
            const isActive = record.isActive !== false
            return { id, name, isActive }
          }).filter((tenant): tenant is TenantRecord => tenant !== null)
        : []
      const cookieInfo = cookieStateRef.current
      const shouldFallbackToFirst =
        !selected
        && (
          !cookieInfo.hasCookie
          || (cookieInfo.raw !== null && cookieInfo.raw !== ALL_ORGANIZATIONS_COOKIE_VALUE)
        )
      const fallbackSelected = selected ?? (shouldFallbackToFirst ? findFirstSelectable(rawItems) : null)
      const isSuperAdmin = Boolean(json.isSuperAdmin)
      if (!rawItems.length && !manage && !isSuperAdmin && tenantList.length === 0) {
        setState({ status: 'hidden' })
        if (fallbackSelected) {
          persistSelection(resolvedTenantId, fallbackSelected, { refresh: false })
        }
        if (options?.refreshAfter) {
          try { router.refresh() } catch {}
        }
        return
      }
      setState({
        status: 'ready',
        nodes: rawItems as OrganizationMenuNode[],
        selectedId: fallbackSelected,
        canManage: manage,
        tenantId: resolvedTenantId,
        tenants: tenantList,
        isSuperAdmin,
      })
      const currentTenantCookie = tenantCookieRef.current
      if (resolvedTenantId !== null) {
        if (!currentTenantCookie.hasCookie || currentTenantCookie.value !== resolvedTenantId) {
          persistTenant(resolvedTenantId, { refresh: false })
        }
      } else if (currentTenantCookie.hasCookie && currentTenantCookie.value !== '') {
        setTenantCookieState({ value: '', hasCookie: true, raw: '' })
      }
      const currentCookie = cookieStateRef.current
      if (fallbackSelected) {
        const tenantMatches = currentTenantCookie.hasCookie ? currentTenantCookie.value === (resolvedTenantId ?? '') : false
        if (
          !currentCookie.hasCookie ||
          currentCookie.value !== fallbackSelected ||
          currentCookie.raw !== fallbackSelected ||
          !tenantMatches
        ) {
          persistSelection(resolvedTenantId, fallbackSelected, { refresh: false })
        } else {
          emitOrganizationScopeChanged({ organizationId: fallbackSelected, tenantId: resolvedTenantId ?? null })
        }
      } else {
        if (
          !currentCookie.hasCookie ||
          currentCookie.raw !== ALL_ORGANIZATIONS_COOKIE_VALUE ||
          currentCookie.value !== '' ||
          (resolvedTenantId !== null && currentTenantCookie.value !== resolvedTenantId)
        ) {
          persistSelection(resolvedTenantId, null, { refresh: false })
        } else {
          emitOrganizationScopeChanged({ organizationId: null, tenantId: resolvedTenantId ?? null })
        }
      }
      if (options?.refreshAfter) {
        try { router.refresh() } catch {}
      }
    } catch {
      if (abortRef?.current) return
      setState({ status: 'error' })
    }
  }, [persistSelection, persistTenant, router, t])

  const handleTenantChange = React.useCallback((nextTenantId: string | null) => {
    const normalized = typeof nextTenantId === 'string' && nextTenantId.trim().length > 0 ? nextTenantId.trim() : null
    const currentTenant = state.status === 'ready' ? state.tenantId : (tenantValue || null)
    if ((currentTenant ?? null) === (normalized ?? null)) return
    persistTenant(normalized, { refresh: false })
    load({ tenantId: normalized ?? undefined, refreshAfter: true })
  }, [load, persistTenant, state, tenantValue])

  React.useEffect(() => {
    const abortRef = { current: false }
    load({ abortRef })
    return () => { abortRef.current = true }
  }, [load])

  const nodes = React.useMemo<OrganizationTreeNode[]>(() => {
    if (state.status !== 'ready') return []
    const items = state.nodes
    const map = (node: OrganizationMenuNode, parents: string[]): OrganizationTreeNode => {
      const nextPath = [...parents, node.name]
      return {
        id: node.id,
        name: node.name,
        depth: node.depth,
        pathLabel: nextPath.join(' / '),
        selectable: node.selectable,
        children: node.children.map((child) => map(child, nextPath)),
      }
    }
    return items.map((node) => map(node, []))
  }, [state])

  const hasOptions = nodes.length > 0 && state.status === 'ready'
  const tenantSelectOptions = state.status === 'ready' ? state.tenants : []
  const tenantSelectValue = state.status === 'ready'
    ? state.tenantId ?? ''
    : tenantValue
  const showTenantSelect = state.status === 'ready' && state.isSuperAdmin && tenantSelectOptions.length > 0

  if (state.status === 'hidden') {
    return null
  }

  if (compact) {
    return (
      <div className="flex flex-col gap-2 w-full text-sm">
        {showTenantSelect ? (
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground" htmlFor="tenant-switcher-compact">
              {t('organizationSwitcher.tenantLabel', 'Tenant')}
            </label>
            <TenantSelect
              id="tenant-switcher-compact"
              value={tenantSelectValue}
              onChange={handleTenantChange}
              tenants={tenantSelectOptions}
              fetchOnMount={false}
              includeEmptyOption={false}
              className="h-10 w-full rounded border px-2 text-sm"
              aria-label={t('organizationSwitcher.tenantLabel', 'Tenant')}
            />
          </div>
        ) : null}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground" htmlFor="org-switcher-compact">{t('organizationSwitcher.label')}</label>
          {state.status === 'loading' ? (
            <span className="text-xs text-muted-foreground">{t('organizationSwitcher.loading')}</span>
          ) : state.status === 'error' ? (
            <span className="text-xs text-destructive">{t('organizationSwitcher.error')}</span>
          ) : hasOptions ? (
            <OrganizationSelect
              id="org-switcher-compact"
              value={value || null}
              onChange={handleChange}
              nodes={nodes}
              fetchOnMount={false}
              includeAllOption
              aria-label={t('organizationSwitcher.label')}
              className="h-10 w-full rounded border px-2 text-sm"
            />
          ) : (
            <span className="text-xs text-muted-foreground">{t('organizationSwitcher.empty')}</span>
          )}
        </div>
        {canManage ? (
          <Link href="/backend/directory/organizations" className="text-xs text-muted-foreground hover:text-foreground">
            {t('organizationSwitcher.manage')}
          </Link>
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {showTenantSelect ? (
        <>
          <TenantSelect
            id="tenant-switcher"
            value={tenantSelectValue}
            onChange={handleTenantChange}
            tenants={tenantSelectOptions}
            fetchOnMount={false}
            includeEmptyOption={false}
            className="h-9 rounded border px-2 text-sm"
            aria-label={t('organizationSwitcher.tenantLabel', 'Tenant')}
          />
        </>
      ) : null}
      {state.status === 'loading' ? (
        <span className="text-xs text-muted-foreground">{t('organizationSwitcher.loading')}</span>
      ) : state.status === 'error' ? (
        <span className="text-xs text-destructive">{t('organizationSwitcher.error')}</span>
      ) : hasOptions ? (
        <OrganizationSelect
          id="org-switcher"
          value={value || null}
          onChange={handleChange}
          nodes={nodes}
          fetchOnMount={false}
          includeAllOption
          aria-label={t('organizationSwitcher.label')}
          className="h-9 rounded border px-2 text-sm"
        />
      ) : (
        <span className="text-xs text-muted-foreground">{t('organizationSwitcher.empty')}</span>
      )}
    </div>
  )
}
