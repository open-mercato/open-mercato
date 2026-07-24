"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Copy, Download } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { deleteCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { ErrorMessage, LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { ColumnDef } from '@tanstack/react-table'
import {
  OrderSelectField,
  ReferencedStatementsField,
  actorRoleOptions,
  activityTypeOptions,
  commodityOptions,
  statusBadgeVariant,
  type CompanySnapshot,
  type OrderSnapshot,
  type ReferencedStatementValue,
} from '../../../../components/formConfig'
import { StatementLifecycleBar } from '../../../../components/StatementLifecycleBar'
import { StatementRiskSection, type StatementLatestRisk } from '../../../../components/StatementRiskSection'
import { PlotMapPreview } from '../../../../components/PlotMapPreview'
import type {
  EudrActivityType,
  EudrActorRole,
  EudrCommodity,
  EudrStatementStatus,
  EudrSubmissionStatus,
} from '../../../../data/validators'
import { hasMissingSpecies } from '../../../../lib/species'

type StatementRecord = {
  id: string
  title: string
  commodity: EudrCommodity
  referenceNumber: string | null
  verificationNumber: string | null
  status: EudrStatementStatus
  activityType: EudrActivityType | null
  actorRole: EudrActorRole | null
  referencedStatements: ReferencedStatementValue[]
  quantityKg: number | string | null
  supplementaryUnit: string | null
  supplementaryQuantity: number | string | null
  orderId: string | null
  submittedAt: string | null
  referenceIssuedAt: string | null
  orderSnapshot: OrderSnapshot | null
  notes: string | null
  latestRisk: StatementLatestRisk
  createdAt: string
  updatedAt: string
}

type StatementDetailResponse = {
  items?: StatementRecord[]
}

type StatementFormValues = {
  id: string
  title: string
  commodity: string
  referenceNumber: string
  verificationNumber: string
  activityType: string
  actorRole: string
  referencedStatements: ReferencedStatementValue[]
  quantityKg: string
  supplementaryUnit: string
  supplementaryQuantity: string
  orderId: string
  orderSnapshot: OrderSnapshot | null
  notes: string
  updatedAt: string
} & Record<string, unknown>

type LinkedSubmissionRow = {
  id: string
  supplierEntityId: string
  supplierSnapshot: CompanySnapshot | null
  commodity: EudrCommodity
  productMappingId: string | null
  status: EudrSubmissionStatus
  completenessScore: number
  plotIds?: string[]
}

type LinkedSubmissionsResponse = {
  items?: LinkedSubmissionRow[]
}

type ProductMappingRow = {
  commodity: EudrCommodity
  speciesScientificName?: string | null
  speciesCommonName?: string | null
}

type ProductMappingsResponse = {
  items?: ProductMappingRow[]
}

type PlotRow = {
  id: string
  geometry: unknown
}

type PlotsResponse = {
  items?: PlotRow[]
}

function optionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function optionalNumber(value: unknown, translate: ReturnType<typeof useT>): number | null {
  const text = optionalText(value)
  if (!text) return null
  const parsedNumber = Number(text)
  if (!Number.isFinite(parsedNumber)) {
    const message = translate('eudr.statements.form.quantityKgInvalid')
    throw createCrudFormError(message, { quantityKg: message })
  }
  return parsedNumber
}

function optionalSupplementaryNumber(value: unknown, translate: ReturnType<typeof useT>): number | null {
  const text = optionalText(value)
  if (!text) return null
  const parsedNumber = Number(text)
  if (!Number.isFinite(parsedNumber)) {
    const message = translate('eudr.statements.form.supplementaryQuantityInvalid')
    throw createCrudFormError(message, { supplementaryQuantity: message })
  }
  return parsedNumber
}

function isOrderSnapshot(value: unknown): value is OrderSnapshot {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeReferencedStatements(value: unknown): ReferencedStatementValue[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return null
      const record = entry as Record<string, unknown>
      const referenceNumber = optionalText(record.referenceNumber)
      if (!referenceNumber) return null
      const verificationNumber = optionalText(record.verificationNumber)
      return verificationNumber ? { referenceNumber, verificationNumber } : { referenceNumber }
    })
    .filter((entry): entry is ReferencedStatementValue => entry !== null)
}

function getRouteId(params?: { id?: string }): string | null {
  const rawId = params?.id
  return typeof rawId === 'string' && rawId.trim().length ? rawId : null
}

function formatQuantityKg(value: number | string | null): string {
  if (value === null || value === undefined) return ''
  return String(value)
}

function formatOptionalNumber(value: number | string | null): string {
  if (value === null || value === undefined) return ''
  return String(value)
}

function supplierLabel(row: LinkedSubmissionRow, unavailableLabel: string): string {
  return row.supplierSnapshot?.displayName || unavailableLabel
}

export default function EditEudrStatementPage({ params }: { params?: { id?: string } }) {
  const translate = useT()
  const router = useRouter()
  const statementId = React.useMemo(() => getRouteId(params), [params])
  const [record, setRecord] = React.useState<StatementRecord | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [notFound, setNotFound] = React.useState(false)
  const [submissionRows, setSubmissionRows] = React.useState<LinkedSubmissionRow[]>([])
  const [submissionsLoading, setSubmissionsLoading] = React.useState(false)
  const [submissionsError, setSubmissionsError] = React.useState<string | null>(null)
  const [speciesMissing, setSpeciesMissing] = React.useState(false)
  const [plotFeatures, setPlotFeatures] = React.useState<unknown[]>([])
  const [plotsLoading, setPlotsLoading] = React.useState(false)
  const [exportingFormat, setExportingFormat] = React.useState<'json' | 'geojson' | null>(null)
  const [reloadToken, setReloadToken] = React.useState(0)

  React.useEffect(() => {
    let cancelled = false
    async function loadRecord() {
      if (!statementId) {
        setNotFound(true)
        setLoading(false)
        return
      }
      setLoading(true)
      setError(null)
      setNotFound(false)
      try {
        const call = await apiCall<StatementDetailResponse>(
          `/api/eudr/statements?id=${encodeURIComponent(statementId)}`,
          undefined,
          { fallback: { items: [] } },
        )
        if (!call.ok) {
          if (!cancelled) setError(translate('eudr.statements.form.loadError'))
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
        if (!cancelled) setError(translate('eudr.statements.form.loadError'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadRecord()
    return () => {
      cancelled = true
    }
  }, [reloadToken, statementId, translate])

  React.useEffect(() => {
    let cancelled = false
    async function loadSubmissions() {
      if (!statementId) return
      setSubmissionsLoading(true)
      setSubmissionsError(null)
      try {
        const call = await apiCall<LinkedSubmissionsResponse>(
          `/api/eudr/evidence-submissions?statementId=${encodeURIComponent(statementId)}&pageSize=100`,
          undefined,
          { fallback: { items: [] } },
        )
        if (!call.ok) {
          if (!cancelled) setSubmissionsError(translate('eudr.statements.detail.loadSubmissionsError'))
          return
        }
        if (!cancelled) setSubmissionRows(Array.isArray(call.result?.items) ? call.result.items : [])
      } catch {
        if (!cancelled) setSubmissionsError(translate('eudr.statements.detail.loadSubmissionsError'))
      } finally {
        if (!cancelled) setSubmissionsLoading(false)
      }
    }
    loadSubmissions()
    return () => {
      cancelled = true
    }
  }, [statementId, translate])

  React.useEffect(() => {
    const productMappingIds = Array.from(
      new Set(
        submissionRows
          .map((submission) => submission.productMappingId)
          .filter((mappingId): mappingId is string => typeof mappingId === 'string' && mappingId.length > 0),
      ),
    )
    if (!productMappingIds.length) {
      setSpeciesMissing(false)
      return
    }
    setSpeciesMissing(false)
    let cancelled = false
    async function loadProductMappings() {
      try {
        const call = await apiCall<ProductMappingsResponse>(
          `/api/eudr/product-mappings?ids=${encodeURIComponent(productMappingIds.join(','))}&pageSize=100`,
          {
            headers: {
              'x-om-forbidden-redirect': '0',
              'x-om-unauthorized-redirect': '0',
            },
          },
          { fallback: { items: [] } },
        )
        if (!cancelled) {
          const mappings = call.ok && Array.isArray(call.result?.items) ? call.result.items : []
          setSpeciesMissing(mappings.some((mapping) => hasMissingSpecies(mapping)))
        }
      } catch {
        if (!cancelled) setSpeciesMissing(false)
      }
    }
    void loadProductMappings()
    return () => {
      cancelled = true
    }
  }, [submissionRows])

  React.useEffect(() => {
    const plotIds = Array.from(
      new Set(
        submissionRows
          .flatMap((submission) => Array.isArray(submission.plotIds) ? submission.plotIds : [])
          .filter((plotId): plotId is string => typeof plotId === 'string' && plotId.trim().length > 0),
      ),
    )
    if (!plotIds.length) {
      setPlotFeatures([])
      setPlotsLoading(false)
      return
    }
    let cancelled = false
    async function loadPlots() {
      setPlotsLoading(true)
      try {
        const call = await apiCall<PlotsResponse>(
          `/api/eudr/plots?ids=${encodeURIComponent(plotIds.join(','))}&pageSize=100`,
          {
            headers: {
              'x-om-forbidden-redirect': '0',
              'x-om-unauthorized-redirect': '0',
            },
          },
          { fallback: { items: [] } },
        )
        if (!call.ok) {
          if (!cancelled) setPlotFeatures([])
          return
        }
        const features = (Array.isArray(call.result?.items) ? call.result.items : [])
          .map((plot) => plot.geometry)
          .filter((geometry) => geometry !== null && geometry !== undefined)
        if (!cancelled) setPlotFeatures(features)
      } catch {
        if (!cancelled) setPlotFeatures([])
      } finally {
        if (!cancelled) setPlotsLoading(false)
      }
    }
    loadPlots()
    return () => {
      cancelled = true
    }
  }, [submissionRows])

  const refreshRecord = React.useCallback(() => {
    setReloadToken((currentToken) => currentToken + 1)
  }, [])

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'title',
      label: translate('eudr.statements.form.title'),
      type: 'text',
      required: true,
    },
    {
      id: 'commodity',
      layout: 'half',
      label: translate('eudr.statements.form.commodity'),
      type: 'select',
      required: true,
      options: commodityOptions(translate),
    },
    {
      id: 'activityType',
      layout: 'half',
      label: translate('eudr.statements.form.activityType'),
      type: 'select',
      options: activityTypeOptions(translate),
    },
    {
      id: 'actorRole',
      layout: 'half',
      label: translate('eudr.statements.form.actorRole'),
      type: 'select',
      options: actorRoleOptions(translate),
    },
    {
      id: 'referenceNumber',
      label: translate('eudr.statements.form.referenceNumber'),
      type: 'text',
    },
    {
      id: 'verificationNumber',
      label: translate('eudr.statements.form.verificationNumber'),
      type: 'text',
    },
    {
      id: 'quantityKg',
      layout: 'half',
      label: translate('eudr.statements.form.quantityKg'),
      type: 'text',
    },
    {
      id: 'supplementaryUnit',
      layout: 'half',
      label: translate('eudr.statements.form.supplementaryUnit'),
      type: 'text',
    },
    {
      id: 'supplementaryQuantity',
      layout: 'half',
      label: translate('eudr.statements.form.supplementaryQuantity'),
      type: 'text',
    },
    {
      id: 'orderId',
      label: translate('eudr.statements.form.order'),
      type: 'custom',
      component: ({ id, value, setValue, setFormValue }) => (
        <OrderSelectField
          id={id}
          value={typeof value === 'string' ? value : null}
          onChange={(nextValue) => setValue(nextValue ?? '')}
          onSnapshot={(snapshot) => setFormValue?.('orderSnapshot', snapshot)}
          placeholder={translate('eudr.statements.form.orderPlaceholder')}
          emptyLabel={translate('eudr.common.empty')}
          loadError={translate('eudr.statements.form.orderLoadError')}
        />
      ),
    },
    {
      id: 'referencedStatements',
      label: translate('eudr.statements.form.referencedStatements'),
      type: 'custom',
      component: ({ id, value, setValue, disabled }) => (
        <ReferencedStatementsField
          id={id}
          value={value}
          onChange={(nextValue) => setValue(nextValue)}
          disabled={disabled}
        />
      ),
    },
    {
      id: 'notes',
      label: translate('eudr.statements.form.notes'),
      type: 'textarea',
    },
  ], [translate])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'details',
      title: translate('eudr.statements.form.details'),
      column: 1,
      fields: [
        'title',
        'commodity',
        'activityType',
        'actorRole',
      ],
    },
    {
      id: 'quantities',
      title: translate('eudr.statements.form.quantities'),
      column: 1,
      fields: [
        'quantityKg',
        'supplementaryUnit',
        'supplementaryQuantity',
      ],
    },
    {
      id: 'referenced',
      title: translate('eudr.statements.form.referencedStatements'),
      column: 1,
      fields: [
        'referencedStatements',
      ],
    },
    {
      id: 'registration',
      title: translate('eudr.statements.form.registration'),
      column: 2,
      fields: [
        'referenceNumber',
        'verificationNumber',
      ],
    },
    {
      id: 'order',
      title: translate('eudr.statements.form.order'),
      column: 2,
      fields: [
        'orderId',
      ],
    },
    {
      id: 'notes',
      title: translate('eudr.common.notes'),
      column: 2,
      fields: [
        'notes',
      ],
    },
  ], [translate])

  const submissionColumns = React.useMemo<ColumnDef<LinkedSubmissionRow>[]>(() => [
    {
      accessorKey: 'supplierEntityId',
      header: translate('eudr.statements.detail.columns.supplier'),
      cell: ({ row }) => supplierLabel(row.original, translate('eudr.common.recordUnavailable')),
    },
    {
      accessorKey: 'status',
      header: translate('eudr.statements.detail.columns.status'),
      cell: ({ row }) => (
        <StatusBadge variant={statusBadgeVariant(row.original.status)} dot>
          {translate(`eudr.submissionStatus.${row.original.status}`)}
        </StatusBadge>
      ),
    },
    {
      accessorKey: 'completenessScore',
      header: translate('eudr.statements.detail.columns.completeness'),
      cell: ({ row }) => `${row.original.completenessScore}%`,
    },
  ], [translate])

  const initialValues = React.useMemo<StatementFormValues | null>(() => {
    if (!record) return null
    return {
      id: record.id,
      title: record.title,
      commodity: record.commodity,
      referenceNumber: record.referenceNumber ?? '',
      verificationNumber: record.verificationNumber ?? '',
      activityType: record.activityType ?? '',
      actorRole: record.actorRole ?? '',
      referencedStatements: Array.isArray(record.referencedStatements) ? record.referencedStatements : [],
      quantityKg: formatQuantityKg(record.quantityKg),
      supplementaryUnit: record.supplementaryUnit ?? '',
      supplementaryQuantity: formatOptionalNumber(record.supplementaryQuantity),
      orderId: record.orderId ?? '',
      orderSnapshot: record.orderSnapshot,
      notes: record.notes ?? '',
      updatedAt: record.updatedAt,
    }
  }, [record])

  const handleExport = React.useCallback(async (format: 'json' | 'geojson') => {
    if (!statementId) return
    setExportingFormat(format)
    try {
      const suffix = format === 'geojson' ? '?format=geojson' : ''
      const call = await apiCall<unknown>(`/api/eudr/statements/${encodeURIComponent(statementId)}/export${suffix}`)
      if (!call.ok) throw new Error('[internal] eudr statement export failed')
      const blob = new Blob([JSON.stringify(call.result ?? {}, null, 2)], {
        type: format === 'geojson' ? 'application/geo+json' : 'application/json',
      })
      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = format === 'geojson' ? `eudr-dds-${statementId}.geojson` : `eudr-dds-${statementId}.json`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(objectUrl)
    } catch {
      flash(translate('eudr.statements.detail.exportError'), 'error')
    } finally {
      setExportingFormat(null)
    }
  }, [statementId, translate])

  if (loading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={translate('eudr.statements.form.loading')} />
        </PageBody>
      </Page>
    )
  }

  if (notFound) {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={translate('eudr.statements.form.notFound')}
            backHref="/backend/eudr/statements"
            backLabel={translate('eudr.statements.form.backToList')}
          />
        </PageBody>
      </Page>
    )
  }

  if (error || !record || !initialValues) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={error ?? translate('eudr.statements.form.loadError')} />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <StatementLifecycleBar
          statement={{
            id: record.id,
            status: record.status,
            referenceNumber: record.referenceNumber,
            verificationNumber: record.verificationNumber,
            referenceIssuedAt: record.referenceIssuedAt,
            submittedAt: record.submittedAt,
            updatedAt: record.updatedAt,
          }}
          speciesMissing={speciesMissing}
          onChanged={refreshRecord}
        />

        <CrudForm<StatementFormValues>
          title={translate('eudr.statements.edit.title')}
          backHref="/backend/eudr/statements"
          cancelHref="/backend/eudr/statements"
          deleteRedirect="/backend/eudr/statements"
          submitLabel={translate('eudr.statements.form.submitUpdate')}
          fields={fields}
          groups={groups}
          initialValues={initialValues}
          extraActions={(
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push(
                `/backend/eudr/statements/create?duplicateFrom=${encodeURIComponent(record.id)}`,
              )}
            >
              <Copy className="mr-2 h-4 w-4" aria-hidden />
              {translate('eudr.statements.duplicateAction')}
            </Button>
          )}
          onSubmit={async (values) => {
            const title = optionalText(values.title)
            if (!title) {
              const message = translate('eudr.statements.form.titleRequired')
              throw createCrudFormError(message, { title: message })
            }
            const commodity = optionalText(values.commodity)
            if (!commodity) {
              const message = translate('eudr.statements.form.commodityRequired')
              throw createCrudFormError(message, { commodity: message })
            }
            await updateCrud('eudr/statements', {
              id: record.id,
              title,
              commodity,
              referenceNumber: optionalText(values.referenceNumber),
              verificationNumber: optionalText(values.verificationNumber),
              activityType: optionalText(values.activityType),
              actorRole: optionalText(values.actorRole),
              referencedStatements: normalizeReferencedStatements(values.referencedStatements),
              quantityKg: optionalNumber(values.quantityKg, translate),
              supplementaryUnit: optionalText(values.supplementaryUnit),
              supplementaryQuantity: optionalSupplementaryNumber(values.supplementaryQuantity, translate),
              orderId: optionalText(values.orderId),
              orderSnapshot: isOrderSnapshot(values.orderSnapshot) ? values.orderSnapshot : null,
              notes: optionalText(values.notes),
            }, {
              errorMessage: translate('eudr.statements.form.updateError'),
            })
            flash(translate('eudr.statements.form.updateSuccess'), 'success')
            router.push('/backend/eudr/statements')
          }}
          onDelete={async () => {
            await deleteCrud('eudr/statements', record.id, {
              errorMessage: translate('eudr.statements.form.deleteError'),
            })
          }}
        />

        <StatementRiskSection
          statementId={record.id}
          latestRisk={record.latestRisk}
        />

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">{translate('eudr.statements.detail.submissions')}</h2>
          <DataTable<LinkedSubmissionRow>
            title={translate('eudr.statements.detail.submissionsTableTitle')}
            columns={submissionColumns}
            data={submissionRows}
            isLoading={submissionsLoading}
            error={submissionsError}
            emptyState={(
              <EmptyState
                size="sm"
                variant="subtle"
                title={translate('eudr.statements.detail.submissionsEmpty')}
              />
            )}
            perspective={{ tableId: 'eudr.statements.detail.submissions' }}
            disableRowClick
          />
        </section>

        {plotFeatures.length > 0 ? (
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">{translate('eudr.statements.detail.plotMap')}</h2>
              {plotsLoading ? (
                <span className="text-sm text-muted-foreground">{translate('eudr.statements.detail.plotMapLoading')}</span>
              ) : null}
            </div>
            <PlotMapPreview features={plotFeatures} />
          </section>
        ) : null}

        <section className="space-y-3 rounded-lg border border-border bg-card p-4">
          <h2 className="text-lg font-semibold">{translate('eudr.statements.detail.exports')}</h2>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleExport('json')}
              disabled={exportingFormat !== null}
            >
              <Download className="mr-2 h-4 w-4" aria-hidden />
              {translate('eudr.statements.detail.export')}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleExport('geojson')}
              disabled={exportingFormat !== null}
            >
              <Download className="mr-2 h-4 w-4" aria-hidden />
              {translate('eudr.statements.detail.exportGeoJson')}
            </Button>
          </div>
        </section>
      </PageBody>
    </Page>
  )
}
