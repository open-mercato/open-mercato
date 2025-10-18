"use client"
import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { emitOrganizationScopeChanged } from '@/lib/frontend/organizationEvents'
import { OrganizationSelect, type OrganizationTreeNode } from '@open-mercato/core/modules/directory/components/OrganizationSelect'
import { useT } from '@/lib/i18n/context'

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
  | { status: 'ready'; nodes: OrganizationMenuNode[]; selectedId: string | null; canManage: boolean }

function readSelectedOrganizationCookie(): string {
  if (typeof document === 'undefined') return ''
  const cookies = document.cookie.split(';')
  for (const entry of cookies) {
    const trimmed = entry.trim()
    if (trimmed.startsWith('om_selected_org=')) {
      const raw = trimmed.slice('om_selected_org='.length)
      try {
        const decoded = decodeURIComponent(raw)
        return decoded || ''
      } catch {
        return raw || ''
      }
    }
  }
  return ''
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

export default function OrganizationSwitcher() {
  const router = useRouter()
  const t = useT()
  const [state, setState] = React.useState<SwitcherState>({ status: 'loading' })
  const [value, setValue] = React.useState<string>(() => readSelectedOrganizationCookie())

  const persistSelection = React.useCallback((next: string | null, options?: { refresh?: boolean }) => {
    const resolved = next ?? ''
    setValue(resolved)
    const maxAge = 60 * 60 * 24 * 30 // 30 days
    if (!resolved) {
      document.cookie = 'om_selected_org=; path=/; max-age=0; samesite=lax'
    } else {
      document.cookie = `om_selected_org=${encodeURIComponent(resolved)}; path=/; max-age=${maxAge}; samesite=lax`
    }
    emitOrganizationScopeChanged({ organizationId: resolved || null })
    if (options?.refresh !== false) {
      try { router.refresh() } catch {}
    }
  }, [router])

  const handleChange = React.useCallback((next: string | null) => {
    persistSelection(next, { refresh: true })
  }, [persistSelection])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await apiFetch('/api/directory/organization-switcher')
        if (cancelled) return
        if (res.status === 401 || res.status === 403) {
          setState({ status: 'hidden' })
          return
        }
        if (!res.ok) {
          setState({ status: 'error' })
          return
        }
        const json = await res.json().catch(() => ({}))
        const rawItems = Array.isArray(json.items) ? json.items : []
        const selected = typeof json.selectedId === 'string' ? json.selectedId : null
        const manage = Boolean(json.canManage)
        const fallbackSelected = selected ?? findFirstSelectable(rawItems)
        if (!rawItems.length && !manage) {
          setState({ status: 'hidden' })
          setValue(fallbackSelected ?? '')
          return
        }
        setState({ status: 'ready', nodes: rawItems as OrganizationMenuNode[], selectedId: fallbackSelected, canManage: manage })
        if (fallbackSelected) {
          persistSelection(fallbackSelected, { refresh: false })
        } else {
          setValue('')
        }
      } catch {
        if (!cancelled) setState({ status: 'error' })
      }
    }
    load()
    return () => { cancelled = true }
  }, [persistSelection])

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
  const canManage = state.status === 'ready' && state.canManage

  if (state.status === 'hidden') {
    return null
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <label className="hidden text-xs text-muted-foreground sm:inline" htmlFor="org-switcher">{t('organizationSwitcher.label')}</label>
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
      {canManage ? (
        <Link href="/backend/directory/organizations" className="text-xs text-muted-foreground hover:text-foreground">
          {t('organizationSwitcher.manage')}
        </Link>
      ) : null}
    </div>
  )
}
