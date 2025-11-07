"use client"
import * as React from 'react'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { formatOrganizationTreeLabel } from '../lib/tree'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type OrganizationTreeNode = {
  id: string
  name: string
  depth?: number
  pathLabel?: string
  selectable?: boolean
  isActive?: boolean
  children?: OrganizationTreeNode[]
}

export type OrganizationSelectProps = {
  value?: string | null
  onChange?: (value: string | null) => void
  disabled?: boolean
  required?: boolean
  className?: string
  id?: string
  name?: string
  nodes?: OrganizationTreeNode[] | null
  includeInactiveIds?: Iterable<string | null | undefined> | null
  includeAllOption?: boolean
  allOptionLabel?: string
  includeEmptyOption?: boolean
  emptyOptionLabel?: string
  fetchOnMount?: boolean
  tenantId?: string | null
  status?: 'all' | 'active' | 'inactive'
  labelKey?: 'name' | 'pathLabel'
}

type InternalOption = {
  value: string
  label: string
  disabled: boolean
}

type FetchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'success'; nodes: OrganizationTreeNode[] }

async function fetchTree(params: { tenantId?: string | null; status?: 'all' | 'active' | 'inactive' }, errorMessage: string) {
  const search = new URLSearchParams()
  search.set('view', 'tree')
  if (params.tenantId) search.set('tenantId', params.tenantId)
  if (params.status) search.set('status', params.status)
  const json = await readApiResultOrThrow<{ items?: unknown[] }>(
    `/api/directory/organizations?${search.toString()}`,
    undefined,
    { errorMessage, allowNullResult: true },
  )
  return Array.isArray(json.items) ? (json.items as OrganizationTreeNode[]) : []
}

function normalizeNodes(nodes: OrganizationTreeNode[] | null | undefined): OrganizationTreeNode[] {
  if (!Array.isArray(nodes)) return []
  return nodes
}

function buildOptions(
  nodes: OrganizationTreeNode[],
  includeInactiveSet: Set<string>,
  labelKey: 'name' | 'pathLabel',
  inactiveSuffix: string,
): InternalOption[] {
  const acc: InternalOption[] = []
  const walk = (list: OrganizationTreeNode[], depth: number) => {
    for (const node of list) {
      if (!node || typeof node.id !== 'string') continue
      const children = Array.isArray(node.children) ? node.children : []
      const isInactive = node.isActive === false
      const allowed = !isInactive || includeInactiveSet.has(node.id)
      const nodeDepth = typeof node.depth === 'number' ? node.depth : depth
      if (allowed) {
        const display =
          labelKey === 'pathLabel'
            ? (node.pathLabel || node.name || node.id)
            : (node.name || node.pathLabel || node.id)
        const baseLabel = formatOrganizationTreeLabel(display, nodeDepth)
        const label = `${baseLabel}${isInactive ? inactiveSuffix : ''}`
        acc.push({
          value: node.id,
          label,
          disabled: node.selectable === false,
        })
        walk(children, nodeDepth + 1)
      } else {
        // Skip rendering inactive nodes but still walk children to include allowed descendants
        walk(children, nodeDepth + 1)
      }
    }
  }
  walk(nodes, 0)
  return acc
}

export const OrganizationSelect = React.forwardRef<HTMLSelectElement, OrganizationSelectProps>(function OrganizationSelect(
  {
    value,
    onChange,
    disabled = false,
    required = false,
    className,
    id,
    name,
    nodes: providedNodes,
    includeInactiveIds = null,
    includeAllOption = false,
    allOptionLabel,
    includeEmptyOption = false,
    emptyOptionLabel,
    fetchOnMount = true,
    tenantId = null,
    status = 'all',
    labelKey = 'name',
  },
  ref,
) {
  const t = useT()
  const [fetchState, setFetchState] = React.useState<FetchState>(() => {
    if (providedNodes) {
      return { status: 'success', nodes: normalizeNodes(providedNodes) }
    }
    return { status: fetchOnMount ? 'loading' : 'idle' }
  })

  React.useEffect(() => {
    const errorMessage = t('organizationSelect.error', 'Failed to load organizations')
    if (providedNodes) {
      setFetchState({ status: 'success', nodes: normalizeNodes(providedNodes) })
      return
    }
    if (!fetchOnMount) {
      setFetchState({ status: 'idle' })
      return
    }
    let cancelled = false
    setFetchState({ status: 'loading' })
    fetchTree({ tenantId, status }, errorMessage)
      .then((nodes) => {
        if (!cancelled) setFetchState({ status: 'success', nodes })
      })
      .catch(() => {
        if (!cancelled) setFetchState({ status: 'error' })
      })
    return () => { cancelled = true }
  }, [providedNodes, fetchOnMount, tenantId, status, t])

  const nodes = React.useMemo(() => {
    if (providedNodes) {
      return normalizeNodes(providedNodes)
    }
    if (fetchState.status === 'success') return fetchState.nodes
    return []
  }, [providedNodes, fetchState])

  const isLoading = !providedNodes && fetchState.status === 'loading'
  const isError = !providedNodes && fetchState.status === 'error'

  const includeInactiveSet = React.useMemo(() => {
    const set = new Set<string>()
    if (!includeInactiveIds) return set
    for (const raw of includeInactiveIds) {
      if (!raw) continue
      const idValue = String(raw).trim()
      if (idValue) set.add(idValue)
    }
    return set
  }, [includeInactiveIds])

  const inactiveSuffix = React.useMemo(() => ` (${t('organizationSelect.inactive')})`, [t])

  const options = React.useMemo(
    () => buildOptions(nodes, includeInactiveSet, labelKey, inactiveSuffix),
    [nodes, includeInactiveSet, labelKey, inactiveSuffix],
  )

  const handleChange = React.useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    const next = event.target.value
    if (!onChange) return
    onChange(next ? next : null)
  }, [onChange])

  const selectValue = value ?? ''

  const shouldShowStatusOption = options.length === 0 && !includeAllOption && !includeEmptyOption

  const resolvedAllOptionLabel = includeAllOption ? (allOptionLabel ?? t('organizationSelect.all')) : null
  const resolvedEmptyOptionLabel = includeEmptyOption && !includeAllOption ? (emptyOptionLabel ?? t('organizationSelect.empty')) : null
  const loadingLabel = t('organizationSelect.loading')
  const errorLabel = t('organizationSelect.error')

  return (
    <select
      ref={ref}
      id={id}
      name={name}
      value={selectValue}
      onChange={handleChange}
      disabled={disabled || isLoading || isError}
      required={required}
      className={className ?? 'h-9 rounded border px-2 text-sm'}
    >
      {resolvedAllOptionLabel ? <option value="">{resolvedAllOptionLabel}</option> : null}
      {resolvedEmptyOptionLabel ? <option value="">{resolvedEmptyOptionLabel}</option> : null}
      {shouldShowStatusOption && isLoading ? <option value="" disabled>{loadingLabel}</option> : null}
      {shouldShowStatusOption && isError ? <option value="" disabled>{errorLabel}</option> : null}
      {!isLoading && !isError ? options.map((opt) => (
        <option key={opt.value} value={opt.value} disabled={opt.disabled}>
          {opt.label}
        </option>
      )) : null}
    </select>
  )
})
