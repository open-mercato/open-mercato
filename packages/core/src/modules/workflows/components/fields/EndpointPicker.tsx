'use client'

import * as React from 'react'
import { Globe } from 'lucide-react'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { LedgerEntry } from '../../lib/context-ledger'
import {
  composeEndpointValue,
  findMatchingEndpoint,
  splitEndpointValue,
} from '../../lib/endpoint-path'
import { VariablePickerButton } from './VariablePickerButton'

/**
 * Endpoint picker for CALL_API activities (issue #4235, spec section 5.3).
 *
 * A free-text endpoint input (first-class fallback, pill-capable) plus a
 * Browse popover over the `/api/workflows/endpoints` catalog: searchable,
 * grouped by tag, each row showing method + path + summary. Picking an
 * endpoint fills the activity config's `endpoint` and `method`. When the
 * current endpoint value matches a cataloged template, its path/query
 * parameters render as typed rows that recompose the endpoint string, and the
 * declared request-body schema surfaces as a field hint. Catalog lookup
 * failure degrades to plain free text with a hint.
 */

export interface EndpointPickerParam {
  name: string
  in: 'path' | 'query' | 'header'
  required: boolean
  type: string
}

export interface EndpointPickerItem {
  path: string
  method: string
  summary: string
  tag: string
  params: EndpointPickerParam[]
  hasRequestSchema: boolean
  requestSchema?: Record<string, unknown>
  responseSchema?: Record<string, unknown>
}

type WorkflowEndpointListResponse = {
  items?: EndpointPickerItem[]
}

export interface EndpointPickerProps {
  id: string
  endpoint: string
  method: string
  onApply: (patch: Record<string, unknown>) => void
  ledgerEntries?: LedgerEntry[]
  disabled?: boolean
}

interface BodyFieldHint {
  name: string
  type: string
  required: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function requestBodyFieldHints(requestSchema: Record<string, unknown> | undefined): BodyFieldHint[] {
  if (!isRecord(requestSchema)) return []
  const properties = requestSchema.properties
  if (!isRecord(properties)) return []
  const required = Array.isArray(requestSchema.required) ? requestSchema.required : []
  const hints: BodyFieldHint[] = []
  for (const [name, propertySchema] of Object.entries(properties)) {
    hints.push({
      name,
      type: isRecord(propertySchema) && typeof propertySchema.type === 'string' ? propertySchema.type : 'unknown',
      required: required.includes(name),
    })
  }
  return hints
}

function groupByTag(items: EndpointPickerItem[]): Array<{ tag: string; items: EndpointPickerItem[] }> {
  const byTag = new Map<string, EndpointPickerItem[]>()
  for (const item of items) {
    const list = byTag.get(item.tag) ?? []
    list.push(item)
    byTag.set(item.tag, list)
  }
  return Array.from(byTag.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([tag, tagItems]) => ({ tag, items: tagItems }))
}

function orderParams(params: EndpointPickerParam[]): EndpointPickerParam[] {
  return params
    .filter((param) => param.in === 'path' || param.in === 'query')
    .sort((left, right) => {
      if (left.required !== right.required) return left.required ? -1 : 1
      return left.name.localeCompare(right.name)
    })
}

export function EndpointPicker({ id, endpoint, method, onApply, ledgerEntries, disabled }: EndpointPickerProps) {
  const t = useT()
  const [items, setItems] = React.useState<EndpointPickerItem[] | null>(null)
  const [lookupFailed, setLookupFailed] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const loadStartedRef = React.useRef(false)

  const loadCatalog = React.useCallback(async () => {
    if (loadStartedRef.current) return
    loadStartedRef.current = true
    try {
      const call = await apiCall<WorkflowEndpointListResponse>(
        '/api/workflows/endpoints',
        undefined,
        { fallback: { items: [] } },
      )
      if (!call.ok || !Array.isArray(call.result?.items)) {
        setLookupFailed(true)
        setItems([])
        return
      }
      setLookupFailed(false)
      setItems(call.result.items)
    } catch {
      setLookupFailed(true)
      setItems([])
    }
  }, [])

  React.useEffect(() => {
    if (endpoint.trim().length > 0) void loadCatalog()
  }, [endpoint, loadCatalog])

  const effectiveMethod = method.trim().length > 0 ? method : 'GET'
  const selected = React.useMemo(() => {
    if (!items || items.length === 0) return null
    return findMatchingEndpoint(endpoint, effectiveMethod, items)
  }, [items, endpoint, effectiveMethod])

  const queryValues = React.useMemo(() => splitEndpointValue(endpoint).query, [endpoint])

  const query = search.trim().toLowerCase()
  const visibleItems = React.useMemo(() => {
    const all = items ?? []
    if (!query) return all
    return all.filter((item) =>
      [item.path, item.summary, item.tag, item.method].some((field) => field.toLowerCase().includes(query)),
    )
  }, [items, query])
  const groups = React.useMemo(() => groupByTag(visibleItems), [visibleItems])

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (nextOpen) void loadCatalog()
    if (!nextOpen) setSearch('')
  }

  const handlePick = (item: EndpointPickerItem) => {
    onApply({ endpoint: item.path, method: item.method })
    handleOpenChange(false)
  }

  const setParamValue = (param: EndpointPickerParam, nextValue: string) => {
    if (!selected) return
    const pathParams = { ...selected.match.pathParams }
    const nextQuery = { ...queryValues }
    if (param.in === 'path') {
      pathParams[param.name] = nextValue
    } else if (nextValue.length > 0) {
      nextQuery[param.name] = nextValue
    } else {
      delete nextQuery[param.name]
    }
    onApply({ endpoint: composeEndpointValue(selected.item.path, pathParams, nextQuery) })
  }

  const paramValueOf = (param: EndpointPickerParam): string => {
    if (!selected) return ''
    if (param.in === 'path') return selected.match.pathParams[param.name] ?? ''
    return queryValues[param.name] ?? ''
  }

  const paramRows = selected ? orderParams(selected.item.params) : []
  const bodyHints = selected?.item.hasRequestSchema
    ? requestBodyFieldHints(selected.item.requestSchema)
    : []

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <Input
          id={id}
          type="text"
          value={endpoint}
          onChange={(event) => onApply({ endpoint: event.target.value })}
          placeholder={t('workflows.endpointPicker.placeholder')}
          className="flex-1 text-xs"
          disabled={disabled}
        />
        <VariablePickerButton
          targetId={id}
          value={endpoint}
          onValueChange={(nextValue) => onApply({ endpoint: nextValue })}
          ledgerEntries={ledgerEntries}
          disabled={disabled}
        />
        <Popover open={open} onOpenChange={handleOpenChange}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm" disabled={disabled}>
              <Globe className="size-3.5 mr-1" />
              {t('workflows.endpointPicker.browse')}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[28rem]" align="end">
            <div className="border-b border-border p-2">
              <Input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('workflows.endpointPicker.searchPlaceholder')}
                aria-label={t('workflows.endpointPicker.searchPlaceholder')}
                className="text-xs"
              />
            </div>
            <div className="max-h-80 overflow-y-auto p-1">
              {lookupFailed ? (
                <p className="p-3 text-xs text-muted-foreground">
                  {t('workflows.endpointPicker.lookupUnavailable')}
                </p>
              ) : groups.length === 0 ? (
                <p className="p-3 text-xs text-muted-foreground">
                  {t('workflows.endpointPicker.noResults')}
                </p>
              ) : (
                groups.map((group) => (
                  <div key={group.tag || '__untagged'}>
                    <p className="px-2 pb-1 pt-2 text-xs font-semibold text-muted-foreground">
                      {group.tag || t('workflows.endpointPicker.untagged')}
                    </p>
                    {group.items.map((item) => (
                      <Button
                        key={`${item.method} ${item.path}`}
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handlePick(item)}
                        className="h-auto w-full justify-start gap-2 px-2 py-1.5"
                      >
                        <Badge variant="secondary" className="shrink-0 text-xs">
                          {item.method}
                        </Badge>
                        <span className="min-w-0 truncate font-mono text-xs">{item.path}</span>
                        <span className="ml-auto min-w-0 truncate text-xs text-muted-foreground">
                          {item.summary}
                        </span>
                      </Button>
                    ))}
                  </div>
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>
      {lookupFailed && (
        <p className="text-xs text-muted-foreground">
          {t('workflows.endpointPicker.lookupUnavailable')}
        </p>
      )}
      {selected && (
        <p className="text-xs text-muted-foreground">{selected.item.summary}</p>
      )}
      {paramRows.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium">{t('workflows.endpointPicker.params')}</p>
          {paramRows.map((param) => {
            const paramFieldId = `${id}-param-${param.name}`
            return (
              <div key={`${param.in}-${param.name}`} className="flex items-center gap-2">
                <label htmlFor={paramFieldId} className="w-32 shrink-0 truncate font-mono text-xs">
                  {param.name}
                  {param.required ? ' *' : ''}
                </label>
                <Input
                  id={paramFieldId}
                  type="text"
                  inputMode={param.type === 'number' || param.type === 'integer' ? 'decimal' : undefined}
                  value={paramValueOf(param)}
                  onChange={(event) => setParamValue(param, event.target.value)}
                  className="flex-1 text-xs"
                  disabled={disabled}
                />
                <Badge variant="muted" className="shrink-0 text-xs">
                  {param.type}
                </Badge>
                <VariablePickerButton
                  targetId={paramFieldId}
                  value={paramValueOf(param)}
                  onValueChange={(nextValue) => setParamValue(param, nextValue)}
                  ledgerEntries={ledgerEntries}
                  disabled={disabled}
                />
              </div>
            )
          })}
        </div>
      )}
      {bodyHints.length > 0 && (
        <div>
          <p className="text-xs font-medium">{t('workflows.endpointPicker.bodyFields')}</p>
          <p className="text-xs text-muted-foreground">
            {bodyHints
              .map((hint) => `${hint.name}${hint.required ? '*' : ''} (${hint.type})`)
              .join(', ')}
          </p>
        </div>
      )}
    </div>
  )
}
