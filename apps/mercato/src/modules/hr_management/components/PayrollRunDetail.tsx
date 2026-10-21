'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card, CardContent, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { ErrorMessage, LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useEmployeeLabels } from './hrOptions'

const LIST_HREF = '/backend/hr/payroll'
const STATUS_FALLBACKS: Record<string, string> = {
  draft: 'Draft', calculated: 'Calculated', submitted: 'Submitted', approved: 'Approved', paid: 'Paid', closed: 'Closed',
}

type PayrollRun = {
  id: string
  period_start?: string | null
  period_end?: string | null
  payment_date?: string | null
  status: string
  currency_code: string
  gross_total?: string | null
  deduction_total?: string | null
  net_total?: string | null
  employee_count?: number | null
  notes?: string | null
}

type Payslip = {
  id: string
  employee_id: string
  gross_amount: string
  deduction_amount: string
  net_amount: string
  status: string
  unpaid_leave_days?: string | null
  absence_days?: string | null
}

type PayslipLine = {
  id: string
  kind: string
  code: string
  label: string
  amount: string
  source_entity_type: string | null
}

type MutationContext = { formId: string; resourceKind: string; resourceId: string; retryLastMutation: () => Promise<boolean> }

export default function PayrollRunDetail({ id }: { id: string }) {
  const t = useT()
  const { labels } = useEmployeeLabels()
  const { runMutation, retryLastMutation } = useGuardedMutation<MutationContext>({
    contextId: `hr.payroll-run:${id}`,
    blockedMessage: t('hr_management.payroll.errors.action', 'The payroll action could not be completed.'),
  })
  const [selectedPayslip, setSelectedPayslip] = React.useState<string | null>(null)
  const [lines, setLines] = React.useState<PayslipLine[]>([])
  const [isBusy, setIsBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const runQuery = useQuery({
    queryKey: ['hr-payroll-run', id],
    queryFn: () => fetchCrudList<PayrollRun>('hr_management/payroll-runs', { ids: id, pageSize: 1 }),
  })
  const run = runQuery.data?.items?.[0] ?? null
  const payslipsQuery = useQuery({
    queryKey: ['hr-payroll-payslips', id],
    queryFn: () => fetchCrudList<Payslip>('hr_management/payslips', { payrollRunId: id, pageSize: 100 }),
    enabled: Boolean(run),
  })
  const payslips = payslipsQuery.data?.items ?? []

  const loadLines = async (payslipId: string) => {
    setSelectedPayslip(payslipId)
    const call = await apiCall<{ items?: PayslipLine[] }>(`/api/hr_management/payslips/lines?id=${payslipId}`)
    setLines(call.ok ? (call.result?.items ?? []) : [])
  }

  const runAction = async (action: 'calculate' | 'submit' | 'close') => {
    if (!run || isBusy) return
    setIsBusy(true)
    setError(null)
    try {
      const call = await runMutation({
        operation: () => apiCallOrThrow(`/api/hr_management/payroll-runs/${action}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(action === 'calculate' ? { id, deductionCeilingShare: 0 } : { id }),
        }),
        context: {
          formId: `hr.payroll-run:${id}`,
          resourceKind: 'hr_management:hr_payroll_run',
          resourceId: id,
          retryLastMutation,
        },
        mutationPayload: { id },
      })
      if (call.result) {
        flash(t(`hr_management.payroll.messages.${action}`, 'Payroll run updated.'), 'success')
        await runQuery.refetch()
        await payslipsQuery.refetch()
      }
    } catch {
      setError(t('hr_management.payroll.errors.action', 'The payroll action could not be completed.'))
    } finally {
      setIsBusy(false)
    }
  }

  if (runQuery.isLoading) return <LoadingMessage label={t('hr_management.payroll.loading', 'Loading payroll run…')} />
  if (!run) return <RecordNotFoundState label={t('hr_management.payroll.error.notFound', 'Payroll run not found.')} backHref={LIST_HREF} backLabel={t('hr_management.payroll.actions.back', 'Back to payroll')} />

  return (
    <>
      <PageHeader
        title={`${(run.period_start ?? '').slice(0, 10)} — ${(run.period_end ?? '').slice(0, 10)}`}
        description={`${run.currency_code} · ${t('hr_management.payroll.detail.employees', '{count} employees', { count: run.employee_count ?? 0 })}`}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={run.status === 'closed' ? 'success' : run.status === 'draft' ? 'outline' : 'default'}>
              {t(`hr_management.payroll.status.${run.status}`, STATUS_FALLBACKS[run.status] ?? run.status)}
            </Badge>
            {run.status === 'draft' || run.status === 'calculated' ? (
              <Button type="button" onClick={() => void runAction('calculate')} disabled={isBusy}>
                {t('hr_management.payroll.actions.calculate', 'Calculate')}
              </Button>
            ) : null}
            {run.status === 'calculated' ? (
              <Button type="button" variant="outline" onClick={() => void runAction('submit')} disabled={isBusy}>
                {t('hr_management.payroll.actions.submit', 'Submit for approval')}
              </Button>
            ) : null}
            {run.status === 'calculated' || run.status === 'approved' ? (
              <Button type="button" onClick={() => void runAction('close')} disabled={isBusy}>
                {t('hr_management.payroll.actions.close', 'Close and pay')}
              </Button>
            ) : null}
            {run.status !== 'draft' ? (
              <Button asChild variant="outline">
                <a href={`/api/hr_management/payroll-runs/${id}/sif`}>{t('hr_management.payroll.actions.sif', 'Download SIF')}</a>
              </Button>
            ) : null}
          </div>
        )}
      />
      <PageBody>
        <Link className="text-sm text-muted-foreground underline" href={LIST_HREF}>
          {t('hr_management.payroll.actions.back', 'Back to payroll')}
        </Link>
        {error ? <ErrorMessage label={error} /> : null}
        <div className="grid gap-3 sm:grid-cols-4">
          <Summary label={t('hr_management.payroll.columns.gross', 'Gross')} value={run.gross_total ?? '0.00'} />
          <Summary label={t('hr_management.payroll.columns.deductions', 'Deductions')} value={run.deduction_total ?? '0.00'} />
          <Summary label={t('hr_management.payroll.columns.net', 'Net')} value={run.net_total ?? '0.00'} />
          <Summary label={t('hr_management.payroll.columns.employees', 'Employees')} value={String(run.employee_count ?? 0)} />
        </div>
        <Card>
          <CardHeader><CardTitle>{t('hr_management.payroll.detail.payslips', 'Payslips')}</CardTitle></CardHeader>
          <CardContent>
            {payslips.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('hr_management.payroll.detail.empty', 'Calculate the run to build payslips.')}</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-start text-xs text-muted-foreground">
                    <th className="py-2 pe-3">{t('hr_management.payroll.detail.employee', 'Employee')}</th>
                    <th className="py-2 pe-3 text-end">{t('hr_management.payroll.columns.gross', 'Gross')}</th>
                    <th className="py-2 pe-3 text-end">{t('hr_management.payroll.columns.deductions', 'Deductions')}</th>
                    <th className="py-2 pe-3 text-end">{t('hr_management.payroll.columns.net', 'Net')}</th>
                    <th className="py-2 text-end">{t('hr_management.payroll.detail.actions', 'Details')}</th>
                  </tr>
                </thead>
                <tbody>
                  {payslips.map((payslip) => (
                    <tr key={payslip.id} className="border-b border-border/60">
                      <td className="py-2 pe-3">{labels.get(payslip.employee_id) ?? payslip.employee_id.slice(0, 8)}</td>
                      <td className="py-2 pe-3 text-end">{payslip.gross_amount}</td>
                      <td className="py-2 pe-3 text-end">{payslip.deduction_amount}</td>
                      <td className="py-2 pe-3 text-end font-medium">{payslip.net_amount}</td>
                      <td className="py-2 text-end">
                        <Button type="button" variant="outline" size="sm" onClick={() => void loadLines(payslip.id)}>
                          {t('hr_management.payroll.detail.open', 'Open')}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
        {selectedPayslip ? (
          <Card>
            <CardHeader><CardTitle>{t('hr_management.payroll.detail.lines', 'Payslip lines')}</CardTitle></CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-start text-xs text-muted-foreground">
                    <th className="py-2 pe-3">{t('hr_management.payroll.detail.label', 'Line')}</th>
                    <th className="py-2 pe-3">{t('hr_management.payroll.detail.kind', 'Kind')}</th>
                    <th className="py-2 text-end">{t('hr_management.payroll.detail.amount', 'Amount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.id} className="border-b border-border/60">
                      <td className="py-2 pe-3">{line.label}</td>
                      <td className="py-2 pe-3">{line.kind === 'earning' ? t('hr_management.payroll.detail.earning', 'Earning') : t('hr_management.payroll.detail.deduction', 'Deduction')}</td>
                      <td className="py-2 text-end">{line.amount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        ) : null}
      </PageBody>
    </>
  )
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  )
}
