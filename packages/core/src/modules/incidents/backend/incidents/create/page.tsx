"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import {
  CrudForm,
  type CrudCustomFieldRenderProps,
  type CrudField,
  type CrudFieldOption,
} from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { resolveCatalogLabel } from '../../../lib/catalogLabels'
import { E } from '#generated/entities.ids.generated'
import { UserSelect } from '../components/UserSelect'
import { TriageAssist, type IncidentTriageSuggestionKeys } from './TriageAssist'

type IncidentPriority = 'low' | 'medium' | 'high' | 'critical'

const INCIDENT_PRIORITIES: IncidentPriority[] = ['low', 'medium', 'high', 'critical']

type CatalogItem = {
  id: string
  key?: string | null
  label?: string | null
  is_active?: boolean | null
}

type PagedResponse<T> = {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

type IncidentCreateFormValues = {
  title?: string
  severityId?: string
  incidentTypeId?: string
  priority?: IncidentPriority | ''
  description?: string
  ownerUserId?: string
  customerImpactSummary?: string
}

type IncidentCreatePayload = {
  title: string
  severityId: string
  incidentTypeId?: string | null
  priority?: string | null
  description?: string | null
  ownerUserId?: string | null
  customerImpactSummary?: string | null
}

type CreateIncidentResponse = {
  id?: string | null
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const emptyCatalogResponse = (): PagedResponse<CatalogItem> => ({
  items: [],
  total: 0,
  page: 1,
  pageSize: 100,
  totalPages: 0,
})

function normalizeOptionalText(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed.length ? trimmed : null
}

async function loadCatalogOptions(
  path: string,
  kind: 'severity' | 'type',
  t: ReturnType<typeof useT>,
): Promise<CrudFieldOption[]> {
  const items = await loadCatalogItems(path)
  return items
    .filter((item) => item.id)
    .map((item) => ({ value: item.id, label: resolveCatalogLabel(t, kind, item.key, item.label ?? item.id) }))
}

async function loadCatalogItems(path: string): Promise<CatalogItem[]> {
  const result = await apiCall<PagedResponse<CatalogItem>>(
    `${path}?page=1&pageSize=100&isActive=true`,
    undefined,
    { fallback: emptyCatalogResponse() },
  )
  if (!result.ok || !result.result) return []
  return result.result.items.filter((item) => item.id)
}

function priorityLabel(t: ReturnType<typeof useT>, priority: IncidentPriority): string {
  if (priority === 'low') return t('incidents.incident.priority.low')
  if (priority === 'medium') return t('incidents.incident.priority.medium')
  if (priority === 'high') return t('incidents.incident.priority.high')
  return t('incidents.incident.priority.critical')
}

function isIncidentPriority(value: string | null | undefined): value is IncidentPriority {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'critical'
}

function buildPayload(values: IncidentCreateFormValues, t: ReturnType<typeof useT>): IncidentCreatePayload {
  const title = normalizeOptionalText(values.title)
  if (!title) {
    const message = t('incidents.incident.form.errors.titleRequired')
    throw createCrudFormError(message, { title: message })
  }

  const severityId = normalizeOptionalText(values.severityId)
  if (!severityId) {
    const message = t('incidents.incident.form.errors.severityRequired')
    throw createCrudFormError(message, { severityId: message })
  }

  const ownerUserId = normalizeOptionalText(values.ownerUserId)
  if (ownerUserId && !UUID_PATTERN.test(ownerUserId)) {
    const message = t('incidents.incident.form.errors.ownerUuid')
    throw createCrudFormError(message, { ownerUserId: message })
  }

  return {
    title,
    severityId,
    incidentTypeId: normalizeOptionalText(values.incidentTypeId),
    priority: normalizeOptionalText(values.priority),
    description: normalizeOptionalText(values.description),
    ownerUserId,
    customerImpactSummary: normalizeOptionalText(values.customerImpactSummary),
  }
}

function formText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function catalogIdForKey(items: readonly CatalogItem[], key: string | null | undefined): string | null {
  const normalized = key?.trim()
  if (!normalized) return null
  return items.find((item) => item.key?.trim() === normalized)?.id ?? null
}

function IncidentTriageAssistField({
  values,
  setFormValue,
  disabled,
}: CrudCustomFieldRenderProps) {
  const handleApplySuggestion = React.useCallback(async (suggestion: IncidentTriageSuggestionKeys) => {
    if (!setFormValue) return
    const [severities, types] = await Promise.all([
      loadCatalogItems('/api/incidents/severities').catch(() => []),
      loadCatalogItems('/api/incidents/types').catch(() => []),
    ])
    const severityId = catalogIdForKey(severities, suggestion.severityKey)
    const typeId = catalogIdForKey(types, suggestion.typeKey)
    const priority = normalizeOptionalText(suggestion.priorityKey ?? undefined)
    if (severityId) setFormValue('severityId', severityId)
    if (typeId) setFormValue('incidentTypeId', typeId)
    if (isIncidentPriority(priority)) setFormValue('priority', priority)
  }, [setFormValue])

  return (
    <TriageAssist
      title={formText(values?.title)}
      description={formText(values?.description)}
      disabled={disabled}
      onApplySuggestion={handleApplySuggestion}
    />
  )
}

export default function CreateIncidentPage() {
  const t = useT()
  const router = useRouter()

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'title',
      type: 'text',
      label: t('incidents.incident.form.fields.title'),
      required: true,
      layout: 'full',
      maxLength: 200,
    },
    {
      id: 'severityId',
      type: 'select',
      label: t('incidents.incident.form.fields.severity'),
      required: true,
      loadOptions: () => loadCatalogOptions('/api/incidents/severities', 'severity', t),
      layout: 'half',
    },
    {
      id: 'incidentTypeId',
      type: 'select',
      label: t('incidents.incident.form.fields.type'),
      loadOptions: () => loadCatalogOptions('/api/incidents/types', 'type', t),
      layout: 'half',
    },
    {
      id: 'priority',
      type: 'select',
      label: t('incidents.incident.form.fields.priority'),
      options: INCIDENT_PRIORITIES.map((priority) => ({ value: priority, label: priorityLabel(t, priority) })),
      layout: 'half',
    },
    {
      id: 'ownerUserId',
      type: 'custom',
      label: t('incidents.incident.form.fields.owner'),
      layout: 'half',
      component: ({ id, value, setValue, disabled }) => (
        <UserSelect
          id={id}
          value={typeof value === 'string' ? value : null}
          onChange={(next) => setValue(next ?? undefined)}
          nullable
          disabled={disabled}
        />
      ),
    },
    {
      id: 'description',
      type: 'textarea',
      label: t('incidents.incident.form.fields.description'),
      rows: 5,
      layout: 'full',
      maxLength: 8000,
      showCount: true,
    },
    {
      id: 'triageAssist',
      type: 'custom',
      label: '',
      layout: 'full',
      component: (props) => <IncidentTriageAssistField {...props} />,
    },
    {
      id: 'customerImpactSummary',
      type: 'textarea',
      label: t('incidents.incident.form.fields.customerImpactSummary'),
      rows: 4,
      layout: 'full',
      maxLength: 8000,
      showCount: true,
    },
  ], [t])

  return (
    <Page>
      <PageBody>
        <CrudForm<IncidentCreateFormValues>
          title={t('incidents.incident.create.title')}
          backHref="/backend/incidents"
          fields={fields}
          initialValues={{ priority: 'medium' }}
          entityIds={[E.incidents.incident]}
          submitLabel={t('incidents.incident.form.actions.submit')}
          cancelHref="/backend/incidents"
          onSubmit={async (values) => {
            const payload = buildPayload(values, t)
            const { result } = await createCrud<CreateIncidentResponse>('incidents', payload)
            flash(t('incidents.incident.form.success'), 'success')
            const createdId = typeof result?.id === 'string' ? result.id : null
            if (createdId) {
              router.push(`/backend/incidents/${encodeURIComponent(createdId)}`)
            } else {
              router.push('/backend/incidents')
            }
          }}
        />
      </PageBody>
    </Page>
  )
}
