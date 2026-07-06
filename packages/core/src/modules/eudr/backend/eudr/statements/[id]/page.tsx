"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Download } from 'lucide-react'
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
import { commodityOptions, statementStatusOptions, statusBadgeVariant, type CompanySnapshot } from '../../../../components/formConfig'
import type { EudrCommodity, EudrStatementStatus, EudrSubmissionStatus } from '../../../../data/validators'

type StatementRecord = {
  id: string
  title: string
  commodity: EudrCommodity
  referenceNumber: string | null
  verificationNumber: string | null
  status: EudrStatementStatus
  quantityKg: number | string | null
  orderId: string | null
  notes: string | null
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
  status: string
  quantityKg: string
  orderId: string
  notes: string
  updatedAt: string
} & Record<string, unknown>

type LinkedSubmissionRow = {
  id: string
  supplierEntityId: string
  supplierSnapshot: CompanySnapshot | null
  commodity: EudrCommodity
  status: EudrSubmissionStatus
  completenessScore: number
}

type LinkedSubmissionsResponse = {
  items?: LinkedSubmissionRow[]
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

function getRouteId(params?: { id?: string }): string | null {
  const rawId = params?.id
  return typeof rawId === 'string' && rawId.trim().length ? rawId : null
}

function formatQuantityKg(value: number | string | null): string {
  if (value === null || value === undefined) return ''
  return String(value)
}

function supplierLabel(row: LinkedSubmissionRow): string {
  return row.supplierSnapshot?.displayName || row.supplierEntityId
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
  const [exporting, setExporting] = React.useState(false)

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
  }, [statementId, translate])

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

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'title',
      label: translate('eudr.statements.form.title'),
      type: 'text',
      required: true,
    },
    {
      id: 'commodity',
      label: translate('eudr.statements.form.commodity'),
      type: 'select',
      required: true,
      options: commodityOptions(translate),
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
      id: 'status',
      label: translate('eudr.statements.form.status'),
      type: 'select',
      options: statementStatusOptions(translate),
    },
    {
      id: 'quantityKg',
      label: translate('eudr.statements.form.quantityKg'),
      type: 'text',
    },
    {
      id: 'orderId',
      label: translate('eudr.statements.form.orderId'),
      type: 'text',
      description: translate('eudr.form.orderIdHint'),
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
      fields: ['title', 'commodity', 'status', 'referenceNumber', 'verificationNumber', 'quantityKg', 'orderId', 'notes'],
    },
  ], [translate])

  const submissionColumns = React.useMemo<ColumnDef<LinkedSubmissionRow>[]>(() => [
    {
      accessorKey: 'supplierEntityId',
      header: translate('eudr.statements.detail.columns.supplier'),
      cell: ({ row }) => supplierLabel(row.original),
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
      status: record.status,
      quantityKg: formatQuantityKg(record.quantityKg),
      orderId: record.orderId ?? '',
      notes: record.notes ?? '',
      updatedAt: record.updatedAt,
    }
  }, [record])

  const handleExport = React.useCallback(async () => {
    if (!statementId) return
    setExporting(true)
    try {
      const call = await apiCall<unknown>(`/api/eudr/statements/${encodeURIComponent(statementId)}/export`)
      if (!call.ok) throw new Error('[internal] eudr statement export failed')
      const blob = new Blob([JSON.stringify(call.result ?? {}, null, 2)], { type: 'application/json' })
      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = `eudr-dds-${statementId}.json`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(objectUrl)
    } catch {
      flash(translate('eudr.statements.detail.exportError'), 'error')
    } finally {
      setExporting(false)
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
        <CrudForm<StatementFormValues>
          title={translate('eudr.statements.edit.title')}
          backHref="/backend/eudr/statements"
          cancelHref="/backend/eudr/statements"
          deleteRedirect="/backend/eudr/statements"
          submitLabel={translate('eudr.statements.form.submitUpdate')}
          fields={fields}
          groups={groups}
          initialValues={initialValues}
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
              status: optionalText(values.status) ?? 'draft',
              quantityKg: optionalNumber(values.quantityKg, translate),
              orderId: optionalText(values.orderId),
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

        <section className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-semibold">{translate('eudr.statements.detail.submissions')}</h2>
            <Button type="button" variant="outline" onClick={() => void handleExport()} disabled={exporting}>
              <Download className="mr-2 h-4 w-4" aria-hidden />
              {translate('eudr.statements.detail.export')}
            </Button>
          </div>
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
      </PageBody>
    </Page>
  )
}
