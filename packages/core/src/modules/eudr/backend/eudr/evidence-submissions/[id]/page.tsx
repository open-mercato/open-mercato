"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { CollapsibleSection } from '@open-mercato/ui/backend/SectionHeader'
import { deleteCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { ErrorMessage, LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { AttachmentInput } from '@open-mercato/core/modules/attachments/fields/attachment'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  CompanySelectField,
  CountrySelectField,
  MappingSelectField,
  PlotMultiSelectField,
  StatementSelectField,
  commodityOptions,
  parseGeolocationInput,
  submissionStatusOptions,
  type CompanySnapshot,
} from '../../../../components/formConfig'
import type { EudrCommodity, EudrSubmissionStatus } from '../../../../data/validators'

type EvidenceSubmissionRecord = {
  id: string
  supplierEntityId: string
  supplierSnapshot: CompanySnapshot | null
  commodity: EudrCommodity
  productMappingId: string | null
  statementId: string | null
  plotIds?: string[]
  originCountry: string | null
  geolocation: Record<string, unknown> | null
  quantityKg: number | string | null
  batchNumber: string | null
  harvestFrom: string | null
  harvestTo: string | null
  producerName: string | null
  attachmentIds: string[]
  status: EudrSubmissionStatus
  completenessScore: number
  missingFields: string[]
  warnings?: string[]
  notes: string | null
  createdAt: string
  updatedAt: string
}

type EvidenceSubmissionDetailResponse = {
  items?: EvidenceSubmissionRecord[]
}

type EvidenceSubmissionFormValues = {
  id: string
  supplierEntityId: string
  supplierSnapshot: CompanySnapshot | null
  commodity: string
  productMappingId: string
  statementId: string
  plotIds: string[]
  originCountry: string
  geolocation: string
  quantityKg: string
  batchNumber: string
  harvestFrom: string
  harvestTo: string
  producerName: string
  status: string
  notes: string
  updatedAt: string
} & Record<string, unknown>

function optionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function optionalUpperText(value: unknown): string | null {
  const text = optionalText(value)
  return text ? text.toUpperCase() : null
}

function optionalNumber(value: unknown, translate: ReturnType<typeof useT>): number | null {
  const text = optionalText(value)
  if (!text) return null
  const parsedNumber = Number(text)
  if (!Number.isFinite(parsedNumber)) {
    const message = translate('eudr.evidenceSubmissions.form.quantityKgInvalid')
    throw createCrudFormError(message, { quantityKg: message })
  }
  return parsedNumber
}

function isCompanySnapshot(value: unknown): value is CompanySnapshot {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
}

function getRouteId(params?: { id?: string }): string | null {
  const rawId = params?.id
  return typeof rawId === 'string' && rawId.trim().length ? rawId : null
}

function formatGeolocation(value: Record<string, unknown> | null): string {
  if (!value) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return ''
  }
}

function formatDateInput(value: string | null): string {
  if (!value) return ''
  return value.slice(0, 10)
}

function EvidenceAdvancedFields({
  values,
  setValue,
  translate,
}: {
  values: Record<string, unknown>
  setValue: (id: string, value: unknown) => void
  translate: ReturnType<typeof useT>
}) {
  return (
    <CollapsibleSection
      title={translate('eudr.evidenceSubmissions.form.legacyGeolocation')}
      defaultCollapsed
      contentClassName="space-y-4"
    >
      <div className="space-y-2" data-crud-field-id="geolocation">
        <label className="text-sm font-medium" htmlFor="eudr-evidence-geolocation">
          {translate('eudr.evidenceSubmissions.form.geolocation')}
        </label>
        <Textarea
          id="eudr-evidence-geolocation"
          rows={8}
          value={typeof values.geolocation === 'string' ? values.geolocation : ''}
          onChange={(event) => setValue('geolocation', event.target.value)}
        />
      </div>
    </CollapsibleSection>
  )
}

export default function EditEudrEvidenceSubmissionPage({ params }: { params?: { id?: string } }) {
  const translate = useT()
  const router = useRouter()
  const submissionId = React.useMemo(() => getRouteId(params), [params])
  const [record, setRecord] = React.useState<EvidenceSubmissionRecord | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [notFound, setNotFound] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    async function loadRecord() {
      if (!submissionId) {
        setNotFound(true)
        setLoading(false)
        return
      }
      setLoading(true)
      setError(null)
      setNotFound(false)
      try {
        const call = await apiCall<EvidenceSubmissionDetailResponse>(
          `/api/eudr/evidence-submissions?id=${encodeURIComponent(submissionId)}`,
          undefined,
          { fallback: { items: [] } },
        )
        if (!call.ok) {
          if (!cancelled) setError(translate('eudr.evidenceSubmissions.form.loadError'))
          return
        }
        const items = Array.isArray(call.result?.items) ? call.result.items : []
        if (cancelled) return
        if (items.length === 0) {
          setNotFound(true)
          setRecord(null)
          return
        }
        setRecord(items[0])
      } catch {
        if (!cancelled) setError(translate('eudr.evidenceSubmissions.form.loadError'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadRecord()
    return () => {
      cancelled = true
    }
  }, [submissionId, translate])

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'supplierEntityId',
      label: translate('eudr.evidenceSubmissions.form.supplier'),
      type: 'custom',
      required: true,
      component: ({ id, value, setValue, setFormValue }) => (
        <CompanySelectField
          id={id}
          value={typeof value === 'string' ? value : null}
          onChange={(nextValue) => setValue(nextValue ?? '')}
          onSnapshot={(snapshot) => setFormValue?.('supplierSnapshot', snapshot)}
          placeholder={translate('eudr.evidenceSubmissions.form.supplierPlaceholder')}
          loadError={translate('eudr.evidenceSubmissions.form.supplierLoadError')}
        />
      ),
    },
    {
      id: 'commodity',
      label: translate('eudr.evidenceSubmissions.form.commodity'),
      type: 'select',
      required: true,
      options: commodityOptions(translate),
    },
    {
      id: 'productMappingId',
      label: translate('eudr.evidenceSubmissions.form.productMapping'),
      type: 'custom',
      component: ({ id, value, setValue }) => (
        <MappingSelectField
          id={id}
          value={typeof value === 'string' ? value : null}
          onChange={(nextValue) => setValue(nextValue ?? '')}
          placeholder={translate('eudr.evidenceSubmissions.form.productMappingPlaceholder')}
          emptyLabel={translate('eudr.common.empty')}
          loadError={translate('eudr.evidenceSubmissions.form.productMappingLoadError')}
        />
      ),
    },
    {
      id: 'statementId',
      label: translate('eudr.evidenceSubmissions.form.statement'),
      type: 'custom',
      component: ({ id, value, setValue }) => (
        <StatementSelectField
          id={id}
          value={typeof value === 'string' ? value : null}
          onChange={(nextValue) => setValue(nextValue ?? '')}
          placeholder={translate('eudr.evidenceSubmissions.form.statementPlaceholder')}
          emptyLabel={translate('eudr.common.empty')}
          loadError={translate('eudr.evidenceSubmissions.form.statementLoadError')}
        />
      ),
    },
    {
      id: 'plotIds',
      label: translate('eudr.evidenceSubmissions.form.plots'),
      type: 'custom',
      component: ({ id, value, setValue, values }) => (
        <PlotMultiSelectField
          id={id}
          value={stringArray(value)}
          onChange={(nextValue) => setValue(nextValue)}
          supplierEntityId={typeof values?.supplierEntityId === 'string' ? values.supplierEntityId : null}
        />
      ),
    },
    {
      id: 'originCountry',
      label: translate('eudr.evidenceSubmissions.form.originCountry'),
      type: 'custom',
      description: translate('eudr.form.originCountryHint'),
      component: ({ id, value, setValue, disabled }) => (
        <CountrySelectField
          id={id}
          value={typeof value === 'string' ? value : null}
          onChange={(nextValue) => setValue(nextValue ?? '')}
          disabled={disabled}
          placeholder={translate('eudr.plots.form.originCountryPlaceholder')}
        />
      ),
    },
    {
      id: 'quantityKg',
      label: translate('eudr.evidenceSubmissions.form.quantityKg'),
      type: 'text',
    },
    {
      id: 'batchNumber',
      label: translate('eudr.evidenceSubmissions.form.batchNumber'),
      type: 'text',
    },
    {
      id: 'harvestFrom',
      label: translate('eudr.evidenceSubmissions.form.harvestFrom'),
      type: 'date',
    },
    {
      id: 'harvestTo',
      label: translate('eudr.evidenceSubmissions.form.harvestTo'),
      type: 'date',
    },
    {
      id: 'producerName',
      label: translate('eudr.evidenceSubmissions.form.producerName'),
      type: 'text',
    },
    {
      id: 'status',
      label: translate('eudr.evidenceSubmissions.form.status'),
      type: 'select',
      options: submissionStatusOptions(translate),
    },
    {
      id: 'notes',
      label: translate('eudr.evidenceSubmissions.form.notes'),
      type: 'textarea',
    },
  ], [translate])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'details',
      title: translate('eudr.evidenceSubmissions.form.details'),
      column: 1,
      fields: ['supplierEntityId', 'commodity', 'status', 'productMappingId', 'statementId', 'plotIds'],
    },
    {
      id: 'evidence',
      title: translate('eudr.evidenceSubmissions.form.evidence'),
      column: 1,
      fields: ['originCountry', 'quantityKg', 'batchNumber', 'harvestFrom', 'harvestTo', 'producerName'],
    },
    {
      id: 'advanced',
      column: 1,
      bare: true,
      component: ({ values, setValue }) => (
        <EvidenceAdvancedFields values={values} setValue={setValue} translate={translate} />
      ),
    },
    {
      id: 'notes',
      title: translate('eudr.evidenceSubmissions.form.notesGroup'),
      column: 1,
      fields: ['notes'],
    },
  ], [translate])

  const initialValues = React.useMemo<EvidenceSubmissionFormValues | null>(() => {
    if (!record) return null
    return {
      id: record.id,
      supplierEntityId: record.supplierEntityId,
      supplierSnapshot: record.supplierSnapshot,
      commodity: record.commodity,
      productMappingId: record.productMappingId ?? '',
      statementId: record.statementId ?? '',
      plotIds: Array.isArray(record.plotIds) ? record.plotIds : [],
      originCountry: record.originCountry ?? '',
      geolocation: formatGeolocation(record.geolocation),
      quantityKg: record.quantityKg === null || record.quantityKg === undefined ? '' : String(record.quantityKg),
      batchNumber: record.batchNumber ?? '',
      harvestFrom: formatDateInput(record.harvestFrom),
      harvestTo: formatDateInput(record.harvestTo),
      producerName: record.producerName ?? '',
      status: record.status,
      notes: record.notes ?? '',
      updatedAt: record.updatedAt,
    }
  }, [record])

  if (loading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={translate('eudr.evidenceSubmissions.form.loading')} />
        </PageBody>
      </Page>
    )
  }

  if (notFound) {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={translate('eudr.evidenceSubmissions.form.notFound')}
            backHref="/backend/eudr/evidence-submissions"
            backLabel={translate('eudr.evidenceSubmissions.form.backToList')}
          />
        </PageBody>
      </Page>
    )
  }

  if (error || !record || !initialValues) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={error ?? translate('eudr.evidenceSubmissions.form.loadError')} />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        {Array.isArray(record.warnings) && record.warnings.includes('harvest_before_cutoff') ? (
          <div
            role="status"
            className="rounded-md border border-status-warning-border bg-status-warning-bg px-3 py-2 text-sm text-status-warning-text"
          >
            {translate('eudr.warnings.harvestBeforeCutoff')}
          </div>
        ) : null}
        <CrudForm<EvidenceSubmissionFormValues>
          title={translate('eudr.evidenceSubmissions.edit.title')}
          backHref="/backend/eudr/evidence-submissions"
          cancelHref="/backend/eudr/evidence-submissions"
          deleteRedirect="/backend/eudr/evidence-submissions"
          submitLabel={translate('eudr.evidenceSubmissions.form.submitUpdate')}
          fields={fields}
          groups={groups}
          initialValues={initialValues}
          onSubmit={async (values) => {
            const supplierEntityId = optionalText(values.supplierEntityId)
            if (!supplierEntityId) {
              const message = translate('eudr.evidenceSubmissions.form.supplierRequired')
              throw createCrudFormError(message, { supplierEntityId: message })
            }
            const commodity = optionalText(values.commodity)
            if (!commodity) {
              const message = translate('eudr.evidenceSubmissions.form.commodityRequired')
              throw createCrudFormError(message, { commodity: message })
            }
            const payload: Record<string, unknown> = {
              id: record.id,
              supplierEntityId,
              supplierSnapshot: isCompanySnapshot(values.supplierSnapshot) ? values.supplierSnapshot : null,
              commodity,
              productMappingId: optionalText(values.productMappingId),
              statementId: optionalText(values.statementId),
              originCountry: optionalUpperText(values.originCountry),
              geolocation: parseGeolocationInput(typeof values.geolocation === 'string' ? values.geolocation : '', translate),
              quantityKg: optionalNumber(values.quantityKg, translate),
              batchNumber: optionalText(values.batchNumber),
              harvestFrom: optionalText(values.harvestFrom),
              harvestTo: optionalText(values.harvestTo),
              producerName: optionalText(values.producerName),
              status: optionalText(values.status) ?? 'draft',
              notes: optionalText(values.notes),
            }
            const nextPlotIds = stringArray(values.plotIds)
            if (nextPlotIds.length > 0 || Object.prototype.hasOwnProperty.call(record, 'plotIds')) {
              payload.plotIds = nextPlotIds
            }
            await updateCrud('eudr/evidence-submissions', payload, {
              errorMessage: translate('eudr.evidenceSubmissions.form.updateError'),
            })
            flash(translate('eudr.evidenceSubmissions.form.updateSuccess'), 'success')
            router.push('/backend/eudr/evidence-submissions')
          }}
          onDelete={async () => {
            await deleteCrud('eudr/evidence-submissions', record.id, {
              errorMessage: translate('eudr.evidenceSubmissions.form.deleteError'),
            })
          }}
        />
        <div className="rounded-lg border bg-card px-4 py-3 space-y-3">
          <h3 className="text-sm font-semibold">{translate('eudr.evidenceSubmissions.form.documents')}</h3>
          <AttachmentInput entityId="eudr:eudr_evidence_submission" recordId={record.id} />
        </div>
      </PageBody>
    </Page>
  )
}
