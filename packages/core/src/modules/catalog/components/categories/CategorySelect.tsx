"use client"
import * as React from 'react'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@/lib/i18n/context'
import { formatCategoryTreeLabel, type CategoryTreeNode } from '../../lib/categoryTree'

export type CategorySelectProps = {
  value?: string | null
  onChange?: (value: string | null) => void
  disabled?: boolean
  required?: boolean
  className?: string
  id?: string
  name?: string
  nodes?: CategoryTreeNode[] | null
  includeEmptyOption?: boolean
  emptyOptionLabel?: string
  fetchOnMount?: boolean
  status?: 'all' | 'active' | 'inactive'
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
  | { status: 'success'; nodes: CategoryTreeNode[] }

async function fetchTree(status: 'all' | 'active' | 'inactive', errorMessage: string) {
  const search = new URLSearchParams()
  search.set('view', 'tree')
  if (status !== 'all') search.set('status', status)
  const response = await readApiResultOrThrow<{ items?: unknown[] }>(
    `/api/catalog/categories?${search.toString()}`,
    undefined,
    { errorMessage, allowNullResult: true },
  )
  const items = Array.isArray(response?.items) ? response.items : []
  return items as CategoryTreeNode[]
}

function normalizeNodes(nodes?: CategoryTreeNode[] | null): CategoryTreeNode[] {
  if (!Array.isArray(nodes)) return []
  return nodes
}

function buildOptions(nodes: CategoryTreeNode[], inactiveSuffix: string): InternalOption[] {
  const list: InternalOption[] = []
  const walk = (entries: CategoryTreeNode[], depth: number) => {
    for (const node of entries) {
      if (!node || typeof node.id !== 'string') continue
      const children = Array.isArray(node.children) ? node.children : []
      const nodeDepth = typeof node.depth === 'number' ? node.depth : depth
      const display = node.pathLabel?.length ? node.pathLabel : node.name
      const label = `${formatCategoryTreeLabel(display ?? node.id, nodeDepth)}${node.isActive === false ? inactiveSuffix : ''}`
      list.push({
        value: node.id,
        label,
        disabled: node.selectable === false,
      })
      if (children.length) {
        walk(children, nodeDepth + 1)
      }
    }
  }
  walk(nodes, 0)
  return list
}

export const CategorySelect = React.forwardRef<HTMLSelectElement, CategorySelectProps>(function CategorySelect(
  {
    value = null,
    onChange,
    disabled = false,
    required = false,
    className,
    id,
    name,
    nodes: providedNodes,
    includeEmptyOption = true,
    emptyOptionLabel,
    fetchOnMount = true,
    status = 'all',
  },
  ref,
) {
  const t = useT()
  const [fetchState, setFetchState] = React.useState<FetchState>(() => {
    if (providedNodes) return { status: 'success', nodes: normalizeNodes(providedNodes) }
    return { status: fetchOnMount ? 'loading' : 'idle' }
  })

  React.useEffect(() => {
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
    const errorMessage = t('catalog.categories.select.error', 'Failed to load categories')
    fetchTree(status, errorMessage)
      .then((nodes) => {
        if (!cancelled) setFetchState({ status: 'success', nodes })
      })
      .catch(() => {
        if (!cancelled) setFetchState({ status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [providedNodes, fetchOnMount, status, t])

  const nodes = React.useMemo(() => {
    if (providedNodes) return normalizeNodes(providedNodes)
    if (fetchState.status === 'success') return fetchState.nodes
    return []
  }, [providedNodes, fetchState])

  const inactiveSuffix = React.useMemo(() => ` (${t('catalog.categories.select.inactive', 'inactive')})`, [t])
  const options = React.useMemo(() => buildOptions(nodes, inactiveSuffix), [nodes, inactiveSuffix])

  const handleChange = React.useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      const next = event.target.value
      onChange?.(next ? next : null)
    },
    [onChange],
  )

  const selectValue = value ?? ''
  const showLoading = !providedNodes && fetchState.status === 'loading'
  const showError = !providedNodes && fetchState.status === 'error'
  const resolvedEmptyLabel = emptyOptionLabel ?? t('catalog.categories.select.empty', 'Root level')

  return (
    <select
      ref={ref}
      id={id}
      name={name}
      className={className}
      value={selectValue}
      onChange={handleChange}
      disabled={disabled || fetchState.status === 'loading'}
      required={required}
    >
      {includeEmptyOption ? (
        <option value="">{resolvedEmptyLabel}</option>
      ) : null}
      {showLoading ? (
        <option value="" disabled>
          {t('catalog.categories.select.loading', 'Loading categories…')}
        </option>
      ) : null}
      {showError ? (
        <option value="" disabled>
          {t('catalog.categories.select.error', 'Failed to load categories')}
        </option>
      ) : null}
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  )
})
