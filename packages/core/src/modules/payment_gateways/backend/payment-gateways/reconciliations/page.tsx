'use client'

import * as React from 'react'
import Link from 'next/link'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { LegacyColumnDef } from '@tanstack/react-table/legacy'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import type { ReconciliationRecord } from '../../../data/validators'

type Row = { id: string; transactionId: string; paymentId: string; providerKey: string; providerSessionId: string | null; gatewayPaymentId: string | null; parentDeleted: boolean; updatedAt: string; reconciliation: ReconciliationRecord }
type ResponseBody = { items: Row[]; total: number; totalPages: number }

export default function ReconciliationsPage() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [page, setPage] = React.useState(1)
  const [status, setStatus] = React.useState<'required' | 'resolved'>('required')
  const [rows, setRows] = React.useState<Row[]>([])
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState(false)
  const [selected, setSelected] = React.useState<Row | null>(null)
  const loadSequence = React.useRef(0)
  const load = React.useCallback(async () => {
    const sequence = ++loadSequence.current
    setLoading(true)
    setSelected(null)
    try {
      const response = await apiCall<ResponseBody>(`/api/payment_gateways/reconciliations?page=${page}&status=${status}`)
      if (sequence !== loadSequence.current) return
      setError(!response.ok)
      setRows(response.ok ? response.result?.items ?? [] : [])
      setTotal(response.result?.total ?? 0)
      setTotalPages(response.result?.totalPages ?? 1)
    } catch (error) {
      if (sequence !== loadSequence.current) return
      setError(true)
      setRows([])
      getTelemetryRuntime()?.reportError(error, { module: 'payment_gateways', code: 'payment_gateways.reconciliation_list_failed' })
    } finally {
      if (sequence === loadSequence.current) setLoading(false)
    }
  }, [page, status])
  React.useEffect(() => { void load(); return () => { loadSequence.current += 1 } }, [load, scopeVersion])
  const columns = React.useMemo<LegacyColumnDef<Row>[]>(() => [
    { accessorKey: 'id', header: t('payment_gateways.reconciliation.operation'), meta: { truncate: true, maxWidth: '16rem' } },
    { accessorKey: 'providerKey', header: t('payment_gateways.reconciliation.provider') },
    { accessorKey: 'transactionId', header: t('payment_gateways.reconciliation.transaction'), meta: { truncate: true, maxWidth: '16rem' } },
    { accessorKey: 'providerSessionId', header: t('payment_gateways.reconciliation.providerSession'), meta: { truncate: true, maxWidth: '16rem' } },
    { id: 'amount', header: t('payment_gateways.reconciliation.amount'), cell: ({ row }) => `${row.original.reconciliation.capturedAmountExact} ${row.original.reconciliation.currencyCode}` },
    { id: 'status', header: t('payment_gateways.reconciliation.status'), cell: ({ row }) => t(`payment_gateways.reconciliation.${row.original.reconciliation.status}`) },
  ], [t])
  const fields = React.useMemo<CrudField[]>(() => [
    { id: 'refundReference', type: 'text', required: true, label: t('payment_gateways.reconciliation.refundReference') },
    { id: 'refundedAmountExact', type: 'text', required: true, label: t('payment_gateways.reconciliation.amount') },
    { id: 'currencyCode', type: 'text', required: true, label: t('payment_gateways.reconciliation.currency') },
    { id: 'confirmedAt', type: 'text', required: true, label: t('payment_gateways.reconciliation.confirmedAt') },
    { id: 'confirmed', type: 'checkbox', required: true, label: t('payment_gateways.reconciliation.attestation') },
  ], [t])
  return <Page><PageHeader title={t('payment_gateways.reconciliation.title')} /><PageBody>
    <p className="mb-4 text-sm text-muted-foreground">{t('payment_gateways.reconciliation.description')}</p>
    <div className="mb-4 flex gap-2">
      <Button variant="outline" onClick={() => { setPage(1); setStatus(status === 'required' ? 'resolved' : 'required') }}>{t(`payment_gateways.reconciliation.show${status === 'required' ? 'Resolved' : 'Required'}`)}</Button>
      <Button variant="outline" onClick={() => void load()}>{t('payment_gateways.reconciliation.refresh')}</Button>
      <Link href="/backend/payment-gateways">{t('payment_gateways.reconciliation.transactions')}</Link>
    </div>
    {loading ? <LoadingMessage label={t('payment_gateways.reconciliation.loading')} /> : error ? <ErrorMessage label={t('payment_gateways.reconciliation.loadError')} /> : <DataTable
      data={rows} columns={columns} entityId="payment_gateways:payment_operation"
      emptyState={t('payment_gateways.reconciliation.empty')}
      extensionTableId="payment_gateways.reconciliations" onRowClick={setSelected}
      pagination={{ page, pageSize: 20, total, totalPages, onPageChange: setPage }}
    />}
    {selected ? <section className="mt-6 rounded-lg border border-border p-4">
      <h2 className="mb-2 text-lg font-semibold">{selected.id}</h2>
      <p className="mb-4 text-sm">{selected.reconciliation.capturedAmountExact} {selected.reconciliation.currencyCode}</p>
      <dl className="mb-4 grid gap-2 text-sm">
        {[
          [t('payment_gateways.reconciliation.provider'), selected.providerKey],
          [t('payment_gateways.reconciliation.transaction'), selected.transactionId],
          [t('payment_gateways.reconciliation.payment'), selected.paymentId],
          [t('payment_gateways.reconciliation.providerSession'), selected.providerSessionId],
          [t('payment_gateways.reconciliation.providerPayment'), selected.gatewayPaymentId],
        ].map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="break-all font-mono">{value ?? t('common.none')}</dd></div>)}
      </dl>
      {selected.parentDeleted ? <p className="mb-4 text-sm text-status-warning-text">{t('payment_gateways.reconciliation.deletedParent')}</p> : <Link href={`/backend/payment-gateways?transactionId=${encodeURIComponent(selected.transactionId)}`}>{t('payment_gateways.reconciliation.inspectTransaction')}</Link>}
      {selected.reconciliation.status === 'resolved' ? <p>{t('payment_gateways.reconciliation.resolved')}: {selected.reconciliation.resolution?.refundReference} ({selected.reconciliation.resolution?.actorUserId})</p> : <CrudForm
        key={selected.id} title={t('payment_gateways.reconciliation.resolve')} fields={fields}
        initialValues={{ updatedAt: selected.updatedAt, refundedAmountExact: selected.reconciliation.capturedAmountExact,
          currencyCode: selected.reconciliation.currencyCode, confirmed: false }}
        submitLabel={t('payment_gateways.reconciliation.resolve')}
        cancelHref="/backend/payment-gateways/reconciliations"
        onSubmit={async (values) => {
          await withScopedApiRequestHeaders(buildOptimisticLockHeader(selected.updatedAt), () => createCrud(
            `payment_gateways/reconciliations/${selected.id}/resolve`, values,
            { errorMessage: t('payment_gateways.reconciliation.resolveError') },
          ))
          flash(t('payment_gateways.reconciliation.resolved'), 'success')
          await load()
        }}
      />}
    </section> : null}
  </PageBody></Page>
}
