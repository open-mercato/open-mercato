"use client"

import * as React from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import type { PluggableList } from 'unified'
import { Pencil, X } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@open-mercato/ui/primitives/button'
import { DataLoader } from '@open-mercato/ui/primitives/DataLoader'
import type { CrudField } from '@open-mercato/ui/backend/CrudForm'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { fetchCustomFieldFormFieldsWithDefinitions } from '@open-mercato/ui/backend/utils/customFieldForms'
import type { CustomFieldDefDto } from '@open-mercato/ui/backend/utils/customFieldDefs'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import {
  DictionaryValue,
  type DictionaryMap,
} from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'
import { ensureDictionaryEntries } from '@open-mercato/core/modules/dictionaries/components/hooks/useDictionaryEntries'
import { getEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { cn } from '@open-mercato/shared/lib/utils'
import { ComponentReplacementHandles } from '@open-mercato/shared/modules/widgets/component-registry'
import { useRegisteredComponent } from '../injection/useRegisteredComponent'

type MarkdownPreviewProps = { children: string; className?: string; remarkPlugins?: PluggableList }

const isTestEnv = typeof process !== 'undefined' && process.env.NODE_ENV === 'test'

const MarkdownPreview: React.ComponentType<MarkdownPreviewProps> = isTestEnv
  ? ({ children, className }) => <div className={className}>{children}</div>
  : (dynamic(() => import('react-markdown').then((mod) => mod.default as React.ComponentType<MarkdownPreviewProps>), {
      ssr: false,
      loading: () => null,
    }) as unknown as React.ComponentType<MarkdownPreviewProps>)

let markdownPluginsPromise: Promise<PluggableList> | null = null

async function loadMarkdownPlugins(): Promise<PluggableList> {
  if (isTestEnv) return []
  if (!markdownPluginsPromise) {
    markdownPluginsPromise = import('remark-gfm')
      .then((mod) => [mod.default ?? mod] as PluggableList)
      .catch(() => [])
  }
  return markdownPluginsPromise
}

const MARKDOWN_FIELD_TYPES = new Set<CrudField['type']>(['text', 'textarea', 'richtext'])
const MARKDOWN_CLASSNAME =
  'text-sm text-foreground break-words [&>*]:mb-2 [&>*:last-child]:mb-0 [&_ul]:ml-4 [&_ul]:list-disc [&_ol]:ml-4 [&_ol]:list-decimal [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:text-xs'

function renderMarkdownValue(content: string, remarkPlugins: PluggableList) {
  return (
    <MarkdownPreview remarkPlugins={remarkPlugins} className={MARKDOWN_CLASSNAME}>
      {content}
    </MarkdownPreview>
  )
}

function extractDictionaryValue(entry: unknown): string | null {
  if (typeof entry === 'string') {
    const trimmed = entry.trim()
    return trimmed.length ? trimmed : null
  }
  if (!entry || typeof entry !== 'object') return null
  const record = entry as Record<string, unknown>
  const candidate = record.value ?? record.name ?? record.id ?? record.key ?? record.label
  if (typeof candidate === 'string') {
    const trimmed = candidate.trim()
    return trimmed.length ? trimmed : null
  }
  return null
}

type ResolvedValueDisplay = {
  label: string
  href?: string
}

type RelationOptionsMetadata = {
  entityId: string
  labelField?: string
}

type EntityRecordsResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
  page?: number
  pageSize?: number
  totalPages?: number
}

function normalizeTextValue(input: unknown): string | null {
  if (typeof input === 'string') {
    const trimmed = input.trim()
    return trimmed.length ? trimmed : null
  }
  if (typeof input === 'number' || typeof input === 'boolean') {
    return String(input)
  }
  return null
}

function extractOptionLookupKey(entry: unknown): string | null {
  if (typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean') {
    return normalizeTextValue(entry)
  }
  if (!entry || typeof entry !== 'object') return null
  const record = entry as Record<string, unknown>
  return (
    normalizeTextValue(record.value)
    ?? normalizeTextValue(record.id)
    ?? normalizeTextValue(record.key)
    ?? normalizeTextValue(record.name)
    ?? null
  )
}

function extractInlineOptionLabel(entry: unknown): string | null {
  if (!entry || typeof entry !== 'object') return null
  const record = entry as Record<string, unknown>
  return (
    normalizeTextValue(record.label)
    ?? normalizeTextValue(record.name)
    ?? null
  )
}

function collectRelationValueIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .map((entry) => extractOptionLookupKey(entry))
          .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0),
      ),
    )
  }
  const single = extractOptionLookupKey(value)
  return single ? [single] : []
}

function camelToSnake(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase()
}

function snakeToCamel(value: string): string {
  return value.replace(/[_-](\w)/g, (_, char: string) => char.toUpperCase())
}

function readRecordValue(record: Record<string, unknown>, field: string): string | null {
  if (!field) return null
  const direct = normalizeTextValue(record[field])
  if (direct) return direct
  const snake = camelToSnake(field)
  const snakeValue = normalizeTextValue(record[snake])
  if (snakeValue) return snakeValue
  const camel = snakeToCamel(field)
  return normalizeTextValue(record[camel])
}

function buildRelationLabel(record: Record<string, unknown>, labelField?: string): string | null {
  if (labelField) {
    const explicit = readRecordValue(record, labelField)
    if (explicit) return explicit
  }

  const labelCandidates = [
    'label',
    'title',
    'name',
    'display_name',
    'displayName',
    'subject',
    'sku',
    'handle',
    'order_number',
    'quote_number',
    'invoice_number',
    'email',
    'company_name',
    'legal_name',
    'brand_name',
  ]

  for (const candidate of labelCandidates) {
    const value = readRecordValue(record, candidate)
    if (value) return value
  }

  const fullName = [readRecordValue(record, 'first_name'), readRecordValue(record, 'last_name')]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(' ')
    .trim()

  return fullName.length ? fullName : null
}

function parseRelationOptionsMetadata(optionsUrl?: string): RelationOptionsMetadata | null {
  if (!optionsUrl) return null
  try {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost'
    const url = new URL(optionsUrl, origin)
    if (!url.pathname.endsWith('/api/entities/relations/options')) return null
    const entityId = url.searchParams.get('entityId')?.trim()
    if (!entityId) return null
    const labelField = url.searchParams.get('labelField')?.trim() || undefined
    return { entityId, labelField }
  } catch {
    return null
  }
}

function buildRelationHref(entityId: string, recordId: string, record?: Record<string, unknown>): string | undefined {
  const trimmedEntityId = entityId.trim()
  const trimmedRecordId = recordId.trim()
  if (!trimmedEntityId || !trimmedRecordId) return undefined

  const knownEntityIds = getEntityIds(false)
  const customers = knownEntityIds.customers ?? {}
  const catalog = knownEntityIds.catalog ?? {}
  const sales = knownEntityIds.sales ?? {}
  const staff = knownEntityIds.staff ?? {}
  const resources = knownEntityIds.resources ?? {}
  const knownEntityIdSet = new Set(
    Object.values(knownEntityIds).flatMap((group) => Object.values(group ?? {})),
  )
  const canUseCustomEntityFallback =
    knownEntityIdSet.size > 0
      ? !knownEntityIdSet.has(trimmedEntityId)
      : trimmedEntityId.startsWith('virtual:')

  if (trimmedEntityId === customers.customer_entity) {
    const kind = (readRecordValue(record ?? {}, 'kind') ?? '').toLowerCase()
    if (kind === 'person') return `/backend/customers/people-v2/${encodeURIComponent(trimmedRecordId)}`
    if (kind === 'company') return `/backend/customers/companies-v2/${encodeURIComponent(trimmedRecordId)}`
    return undefined
  }
  if (trimmedEntityId === customers.customer_person_profile) {
    const linkedId = readRecordValue(record ?? {}, 'entity_id') ?? trimmedRecordId
    return `/backend/customers/people-v2/${encodeURIComponent(linkedId)}`
  }
  if (trimmedEntityId === customers.customer_company_profile) {
    const linkedId = readRecordValue(record ?? {}, 'entity_id') ?? trimmedRecordId
    return `/backend/customers/companies-v2/${encodeURIComponent(linkedId)}`
  }
  if (trimmedEntityId === customers.customer_deal) {
    return `/backend/customers/deals/${encodeURIComponent(trimmedRecordId)}`
  }
  if (trimmedEntityId === catalog.catalog_product) {
    return `/backend/catalog/products/${encodeURIComponent(trimmedRecordId)}`
  }
  if (trimmedEntityId === catalog.catalog_category) {
    return `/backend/catalog/categories/${encodeURIComponent(trimmedRecordId)}/edit`
  }
  if (trimmedEntityId === catalog.catalog_product_variant) {
    const productId = readRecordValue(record ?? {}, 'product_id')
    if (!productId) return undefined
    return `/backend/catalog/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(trimmedRecordId)}`
  }
  if (trimmedEntityId === sales.sales_quote) {
    return `/backend/sales/quotes/${encodeURIComponent(trimmedRecordId)}`
  }
  if (trimmedEntityId === sales.sales_order) {
    return `/backend/sales/orders/${encodeURIComponent(trimmedRecordId)}`
  }
  if (trimmedEntityId === sales.sales_channel) {
    return `/backend/sales/channels/${encodeURIComponent(trimmedRecordId)}/edit`
  }
  if (trimmedEntityId === staff.staff_team_member) {
    return `/backend/staff/team-members/${encodeURIComponent(trimmedRecordId)}`
  }
  if (trimmedEntityId === staff.staff_team_role) {
    return `/backend/staff/team-roles/${encodeURIComponent(trimmedRecordId)}/edit`
  }
  if (trimmedEntityId === staff.staff_team) {
    return `/backend/staff/teams/${encodeURIComponent(trimmedRecordId)}/edit`
  }
  if (trimmedEntityId === staff.staff_leave_request) {
    return `/backend/staff/leave-requests/${encodeURIComponent(trimmedRecordId)}`
  }
  if (trimmedEntityId === resources.resources_resource) {
    return `/backend/resources/resources/${encodeURIComponent(trimmedRecordId)}`
  }

  if (canUseCustomEntityFallback) {
    return `/backend/entities/user/${encodeURIComponent(trimmedEntityId)}/records/${encodeURIComponent(trimmedRecordId)}`
  }

  return undefined
}

async function fetchRelationRecordDisplays(
  relation: RelationOptionsMetadata,
  recordIds: string[],
): Promise<Record<string, ResolvedValueDisplay>> {
  const displays: Record<string, ResolvedValueDisplay> = {}
  if (!recordIds.length) return displays

  const uniqueIds = Array.from(new Set(recordIds.map((entry) => entry.trim()).filter((entry) => entry.length > 0)))
  const chunks: string[][] = []
  for (let index = 0; index < uniqueIds.length; index += 100) {
    chunks.push(uniqueIds.slice(index, index + 100))
  }

  for (const chunk of chunks) {
    const params = new URLSearchParams({
      entityId: relation.entityId,
      id: chunk.join(','),
      page: '1',
      pageSize: String(chunk.length),
      sortField: 'id',
      sortDir: 'asc',
    })
    const response = await readApiResultOrThrow<EntityRecordsResponse>(
      `/api/entities/records?${params.toString()}`,
      undefined,
      {
        errorMessage: 'Failed to resolve relation values',
        fallback: { items: [] },
      },
    )
    const items = Array.isArray(response?.items) ? response.items : []
    items.forEach((record) => {
      const recordId = readRecordValue(record, 'id')
      if (!recordId) return
      const label = buildRelationLabel(record, relation.labelField) ?? recordId
      displays[recordId] = {
        label,
        href: buildRelationHref(relation.entityId, recordId, record),
      }
    })
  }

  return displays
}

export type CustomDataLabels = {
  loading: string
  emptyValue: string
  noFields: string
  defineFields?: string
  saveShortcut: string
  edit?: string
  cancel?: string
}

export type CustomDataSectionProps = {
  entityId?: string
  entityIds?: string[]
  values: Record<string, unknown>
  onSubmit: (values: Record<string, unknown>) => Promise<void>
  title: string
  scopeVersion?: string | number | null
  loadFields?: (
    entityIds: string[],
  ) => Promise<{ fields: CrudField[]; definitions: CustomFieldDefDto[] }>
  labels: CustomDataLabels
  definitionHref?: string
}

function formatFieldValue(
  field: CrudField,
  value: unknown,
  emptyLabel: string,
  dictionaryMap?: DictionaryMap,
  remarkPlugins: PluggableList = [],
  resolvedDisplays?: Record<string, ResolvedValueDisplay>,
): React.ReactNode {
  if (dictionaryMap) {
    if (value === undefined || value === null || value === '') {
      return <span className="text-muted-foreground">{emptyLabel}</span>
    }

    if (Array.isArray(value)) {
      const normalizedValues = value
        .map((entry) => extractDictionaryValue(entry))
        .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)

      if (!normalizedValues.length) {
        return <span className="text-muted-foreground">{emptyLabel}</span>
      }

      return (
        <div className="flex flex-wrap gap-1.5">
          {normalizedValues.map((entry, index) => (
            <DictionaryValue
              key={`${field.id}-${entry}-${index}`}
              value={entry}
              map={dictionaryMap}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-1 text-xs"
              iconWrapperClassName="inline-flex h-4 w-4 items-center justify-center rounded-full border border-border bg-background"
              iconClassName="h-3 w-3"
              colorClassName="h-2.5 w-2.5 rounded-full"
            />
          ))}
        </div>
      )
    }

    const resolved = extractDictionaryValue(value)
    if (!resolved) {
      return <span className="text-muted-foreground">{emptyLabel}</span>
    }

    return (
      <DictionaryValue
        value={resolved}
        map={dictionaryMap}
        className="inline-flex items-center gap-2 text-sm"
        fallback={<span className="text-muted-foreground">{emptyLabel}</span>}
        iconWrapperClassName="inline-flex h-6 w-6 items-center justify-center rounded border border-border bg-card"
        iconClassName="h-4 w-4"
        colorClassName="h-3 w-3 rounded-full"
      />
    )
  }

  const optionMap =
    'options' in field && Array.isArray(field.options)
      ? field.options.reduce<Map<string, string>>((acc, option) => {
          acc.set(option.value, option.label)
          return acc
        }, new Map())
      : null

  const resolveOptionDisplay = (entry: unknown): ResolvedValueDisplay | null => {
    const lookupKey = extractOptionLookupKey(entry)
    if (lookupKey && resolvedDisplays?.[lookupKey]) {
      return resolvedDisplays[lookupKey]
    }
    const inlineLabel = extractInlineOptionLabel(entry)
    if (lookupKey) {
      return {
        label: inlineLabel ?? optionMap?.get(lookupKey) ?? lookupKey,
      }
    }
    if (inlineLabel) {
      return { label: inlineLabel }
    }
    return null
  }

  const renderResolvedDisplay = (display: ResolvedValueDisplay) => {
    if (!display.href) return display.label
    return (
      <Link
        href={display.href}
        className="font-medium text-primary underline-offset-2 hover:underline focus-visible:underline"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        {display.label}
      </Link>
    )
  }

  if (value === undefined || value === null || value === '') {
    return <span className="text-muted-foreground">{emptyLabel}</span>
  }

  if (Array.isArray(value)) {
    if (!value.length) return <span className="text-muted-foreground">{emptyLabel}</span>
    return value.map((entry, index) => (
      <span
        key={`${field.id}-${index}`}
        className="mr-1 inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs"
      >
        {(() => {
          const display = resolveOptionDisplay(entry)
          if (!display) return emptyLabel
          return renderResolvedDisplay(display)
        })()}
      </span>
    ))
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No'
  }

  const resolvedDisplay = resolveOptionDisplay(value)
  if (resolvedDisplay) {
    return renderResolvedDisplay(resolvedDisplay)
  }

  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }

  const resolved = optionMap?.get(String(value)) ?? String(value)
  if (typeof value === 'string' && MARKDOWN_FIELD_TYPES.has(field.type)) {
    if (!resolved.trim().length) {
      return <span className="text-muted-foreground">{emptyLabel}</span>
    }
    return renderMarkdownValue(value, remarkPlugins)
  }
  if (!resolved.length) return <span className="text-muted-foreground">{emptyLabel}</span>
  return resolved
}

function CustomDataSectionImpl({
  entityId,
  entityIds,
  values,
  onSubmit,
  title,
  scopeVersion: scopeVersionProp,
  loadFields,
  labels,
  definitionHref: explicitDefinitionHref,
}: CustomDataSectionProps) {
  const queryClient = useQueryClient()
  const defaultScopeVersion = useOrganizationScopeVersion()
  const scopeVersion = scopeVersionProp ?? defaultScopeVersion
  const resolvedScopeVersion = React.useMemo(
    () => (typeof scopeVersion === 'number' ? scopeVersion : Number(scopeVersion) || 0),
    [scopeVersion],
  )
  const [dictionaryMapsByField, setDictionaryMapsByField] = React.useState<Record<string, DictionaryMap>>({})
  const [resolvedDisplaysByField, setResolvedDisplaysByField] = React.useState<Record<string, Record<string, ResolvedValueDisplay>>>({})
  const [editing, setEditing] = React.useState(false)
  const sectionRef = React.useRef<HTMLDivElement | null>(null)
  const [markdownPlugins, setMarkdownPlugins] = React.useState<PluggableList>([])
  React.useEffect(() => {
    if (isTestEnv) return
    let mounted = true
    void loadMarkdownPlugins().then((plugins) => {
      if (!mounted) return
      setMarkdownPlugins(plugins)
    })
    return () => {
      mounted = false
    }
  }, [])
  const resolvedEntityIds = React.useMemo(() => {
    if (Array.isArray(entityIds) && entityIds.length) {
      const dedup = new Set<string>()
      const list: string[] = []
      entityIds.forEach((id) => {
        const trimmed = typeof id === 'string' ? id.trim() : ''
        if (!trimmed || dedup.has(trimmed)) return
        dedup.add(trimmed)
        list.push(trimmed)
      })
      return list
    }
    if (typeof entityId === 'string' && entityId.trim().length > 0) {
      return [entityId.trim()]
    }
    return []
  }, [entityId, entityIds])
  const primaryEntityId = resolvedEntityIds.length ? resolvedEntityIds[0] : undefined
  const customFieldFormsQuery = useQuery({
    queryKey: ['customFieldForms', resolvedScopeVersion, ...resolvedEntityIds],
    enabled: resolvedEntityIds.length > 0,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    queryFn: async () => {
      const loader = loadFields ?? fetchCustomFieldFormFieldsWithDefinitions
      return loader(resolvedEntityIds)
    },
  })
  const fields = React.useMemo(() => customFieldFormsQuery.data?.fields ?? [], [customFieldFormsQuery.data])
  const definitions = React.useMemo(
    () => customFieldFormsQuery.data?.definitions ?? [],
    [customFieldFormsQuery.data],
  )
  const [dictionaryLoading, setDictionaryLoading] = React.useState(false)
  const [relationLoading, setRelationLoading] = React.useState(false)
  const loading = customFieldFormsQuery.isLoading || dictionaryLoading || relationLoading
  const hasFields = fields.length > 0
  const definitionHref = explicitDefinitionHref ?? (primaryEntityId
    ? `/backend/entities/system/${encodeURIComponent(primaryEntityId)}`
    : undefined)

  React.useEffect(() => {
    if (!hasFields && editing) {
      setEditing(false)
    }
  }, [editing, hasFields])

  const submitActiveForm = React.useCallback(() => {
    const node = sectionRef.current?.querySelector('form')
    if (!node) return
    const form = node as HTMLFormElement
    if (typeof form.requestSubmit === 'function') {
      form.requestSubmit()
      return
    }
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  }, [])

  const handleEditingKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!editing) return
      if (event.key === 'Escape') {
        event.preventDefault()
        setEditing(false)
        return
      }
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        submitActiveForm()
      }
    },
    [editing, submitActiveForm],
  )

  const handleActivate = React.useCallback(() => {
    if (loading || editing || !hasFields) return
    setEditing(true)
  }, [editing, hasFields, loading])

  const handleReadOnlyKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (loading || editing || !hasFields) return
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        setEditing(true)
      }
    },
    [editing, hasFields, loading],
  )

  React.useEffect(() => {
    if (!resolvedEntityIds.length || !definitions.length) {
      setDictionaryLoading((prev) => (prev ? false : prev))
      setDictionaryMapsByField((prev) => (Object.keys(prev).length ? {} : prev))
      return
    }

    let cancelled = false
    const load = async () => {
      setDictionaryLoading(true)
      try {
        const dictionaryDefs = definitions
          .map((def) => {
            const rawId = typeof def.dictionaryId === 'string' ? def.dictionaryId.trim() : ''
            if (!rawId) return null
            return { keyLower: def.key.toLowerCase(), dictionaryId: rawId }
          })
          .filter((entry): entry is { keyLower: string; dictionaryId: string } => !!entry)

        if (!dictionaryDefs.length) {
          if (!cancelled) {
            setDictionaryMapsByField((prev) => (Object.keys(prev).length ? {} : prev))
          }
          return
        }

        const uniqueDictionaryIds = Array.from(new Set(dictionaryDefs.map((entry) => entry.dictionaryId)))
        const mapsByDictionaryId: Record<string, DictionaryMap> = {}

        await Promise.all(
          uniqueDictionaryIds.map(async (dictionaryId) => {
            try {
              const data = await ensureDictionaryEntries(queryClient, dictionaryId, resolvedScopeVersion)
              mapsByDictionaryId[dictionaryId] = data.map
            } catch {
              mapsByDictionaryId[dictionaryId] = {}
            }
          }),
        )

        const dictionaryByKey = dictionaryDefs.reduce<Map<string, string>>((acc, entry) => {
          acc.set(entry.keyLower, entry.dictionaryId)
          return acc
        }, new Map())

        const nextMaps: Record<string, DictionaryMap> = {}
        fields.forEach((field) => {
          const id = typeof field.id === 'string' ? field.id : ''
          if (!id) return
          const normalizedKey = id.startsWith('cf_') ? id.slice(3) : id
          const keyLower = normalizedKey.toLowerCase()
          if (!keyLower) return
          const dictionaryId = dictionaryByKey.get(keyLower)
          if (!dictionaryId) return
          nextMaps[id] = mapsByDictionaryId[dictionaryId] ?? {}
        })

        if (!cancelled) {
          setDictionaryMapsByField((prev) => {
            const prevKeys = Object.keys(prev)
            const nextKeys = Object.keys(nextMaps)
            if (
              prevKeys.length === nextKeys.length &&
              prevKeys.every((key) => prev[key] === nextMaps[key])
            ) {
              return prev
            }
            return nextMaps
          })
        }
      } catch {
        if (!cancelled) {
          setDictionaryMapsByField((prev) => (Object.keys(prev).length ? {} : prev))
        }
      } finally {
        if (!cancelled) {
          setDictionaryLoading(false)
        }
      }
    }

    load().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [definitions, fields, queryClient, resolvedEntityIds, resolvedScopeVersion])

  React.useEffect(() => {
    if (!definitions.length || !fields.length) {
      setRelationLoading((prev) => (prev ? false : prev))
      setResolvedDisplaysByField((prev) => (Object.keys(prev).length ? {} : prev))
      return
    }

    const definitionsByKey = definitions.reduce<Map<string, CustomFieldDefDto>>((acc, definition) => {
      acc.set(definition.key.toLowerCase(), definition)
      return acc
    }, new Map())

    const relationFields = fields
      .map((field) => {
        const normalizedKey = field.id.startsWith('cf_') ? field.id.slice(3) : field.id
        const definition = definitionsByKey.get(normalizedKey.toLowerCase())
        if (!definition || definition.kind !== 'relation') return null
        const relationIds = collectRelationValueIds(values?.[field.id])
        if (!relationIds.length) return null
        return { field, definition, relationIds }
      })
      .filter((entry): entry is { field: CrudField; definition: CustomFieldDefDto; relationIds: string[] } => !!entry)

    if (!relationFields.length) {
      setRelationLoading((prev) => (prev ? false : prev))
      setResolvedDisplaysByField((prev) => (Object.keys(prev).length ? {} : prev))
      return
    }

    let cancelled = false

    const load = async () => {
      setRelationLoading(true)
      try {
        const nextDisplays: Record<string, Record<string, ResolvedValueDisplay>> = {}

        await Promise.all(
          relationFields.map(async ({ field, definition, relationIds }) => {
            const displays: Record<string, ResolvedValueDisplay> = {}

            if ('options' in field && Array.isArray(field.options)) {
              field.options.forEach((option) => {
                displays[option.value] = { label: option.label }
              })
            }

            if ('loadOptions' in field && typeof field.loadOptions === 'function') {
              try {
                const remoteOptions = await field.loadOptions()
                remoteOptions.forEach((option) => {
                  const href = (() => {
                    const relation = parseRelationOptionsMetadata(definition.optionsUrl)
                    return relation ? buildRelationHref(relation.entityId, option.value) : undefined
                  })()
                  displays[option.value] = { label: option.label, href }
                })
              } catch {
                // keep static labels only
              }
            }

            const unresolvedIds = relationIds.filter((relationId) => !displays[relationId])
            const relation = parseRelationOptionsMetadata(definition.optionsUrl)
            if (relation && unresolvedIds.length) {
              try {
                const fetchedDisplays = await fetchRelationRecordDisplays(relation, unresolvedIds)
                Object.assign(displays, fetchedDisplays)
              } catch {
                unresolvedIds.forEach((relationId) => {
                  if (!displays[relationId]) {
                    displays[relationId] = {
                      label: relationId,
                      href: buildRelationHref(relation.entityId, relationId),
                    }
                  }
                })
              }
            }

            if (Object.keys(displays).length > 0) {
              nextDisplays[field.id] = displays
            }
          }),
        )

        if (!cancelled) {
          setResolvedDisplaysByField((prev) => {
            const previousKeys = Object.keys(prev)
            const nextKeys = Object.keys(nextDisplays)
            if (
              previousKeys.length === nextKeys.length &&
              previousKeys.every((key) => JSON.stringify(prev[key]) === JSON.stringify(nextDisplays[key]))
            ) {
              return prev
            }
            return nextDisplays
          })
        }
      } finally {
        if (!cancelled) {
          setRelationLoading(false)
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [definitions, fields, values])

  const handleSubmit = React.useCallback(
    async (input: Record<string, unknown>) => {
      await onSubmit(input)
      setEditing(false)
    },
    [onSubmit],
  )

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between group">
        <h2 className="text-sm font-semibold">{title}</h2>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => {
            if (!hasFields || loading) return
            setEditing((prev) => !prev)
          }}
          disabled={loading || !hasFields}
          className={
            editing
              ? 'opacity-100 transition-opacity duration-150'
              : 'opacity-100 md:opacity-0 transition-opacity duration-150 md:group-hover:opacity-100 focus-visible:opacity-100'
          }
        >
          {editing ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
          <span className="sr-only">{editing ? labels.cancel ?? 'Cancel' : labels.edit ?? 'Edit'}</span>
        </Button>
      </div>
      <DataLoader
        isLoading={loading}
        loadingMessage={labels.loading}
        spinnerSize="md"
        className="min-h-[120px]"
      >
        {editing ? (
          <div
            ref={sectionRef}
            className="rounded-lg border bg-card p-3 sm:p-4"
            onKeyDown={handleEditingKeyDown}
          >
            <CrudForm<Record<string, unknown>>
              embedded
              entityId={primaryEntityId}
              entityIds={resolvedEntityIds}
              fields={fields}
              initialValues={values}
              onSubmit={handleSubmit}
              submitLabel={labels.saveShortcut}
              isLoading={loading}
            />
          </div>
        ) : (
          <div
            className={cn(
              'rounded-lg border bg-muted/20 p-3 sm:p-4 space-y-2 sm:space-y-3 transition hover:border-border/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
              hasFields && !loading ? 'cursor-pointer' : 'cursor-default',
            )}
            role={hasFields && !loading ? 'button' : undefined}
            tabIndex={hasFields && !loading ? 0 : -1}
            onClick={hasFields && !loading ? handleActivate : undefined}
            onKeyDown={hasFields && !loading ? handleReadOnlyKeyDown : undefined}
          >
            {!hasFields ? (
              <p className="text-sm text-muted-foreground">
                {labels.noFields}{' '}
                {definitionHref && labels.defineFields ? (
                  <Link
                    href={definitionHref}
                    className="font-medium text-primary underline-offset-2 hover:underline focus-visible:underline"
                  >
                    {labels.defineFields}
                  </Link>
                ) : null}
              </p>
            ) : (
              fields.map((field) => (
                <div key={field.id} className="space-y-1">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    {field.label}
                  </p>
                  <div className="text-sm break-words">
                    {formatFieldValue(
                      field,
                      values?.[field.id],
                      labels.emptyValue,
                      dictionaryMapsByField[field.id],
                      markdownPlugins,
                      resolvedDisplaysByField[field.id],
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </DataLoader>
    </div>
  )
}

export function CustomDataSection(props: CustomDataSectionProps) {
  const handle = ComponentReplacementHandles.section('ui.detail', 'CustomDataSection')
  const Resolved = useRegisteredComponent<CustomDataSectionProps>(
    handle,
    CustomDataSectionImpl as React.ComponentType<CustomDataSectionProps>,
  )

  return (
    <div data-component-handle={handle}>
      <Resolved {...props} />
    </div>
  )
}

export default CustomDataSection
