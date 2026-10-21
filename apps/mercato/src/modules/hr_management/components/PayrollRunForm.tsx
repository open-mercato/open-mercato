'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card, CardContent, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const LIST_HREF = '/backend/hr/payroll'

type MutationContext = { formId: string; resourceKind: string; resourceId: string; retryLastMutation: () => Promise<boolean> }

export default function PayrollRunForm() {
  const t = useT()
  const router = useRouter()
  const { runMutation, retryLastMutation } = useGuardedMutation<MutationContext>({
    contextId: 'hr.payroll-run:create',
    blockedMessage: t('hr_management.payroll.errors.save', 'Unable to create the payroll run.'),
  })
  const [periodStart, setPeriodStart] = React.useState('')
  const [periodEnd, setPeriodEnd] = React.useState('')
  const [paymentDate, setPaymentDate] = React.useState(new Date().toISOString().slice(0, 10))
  const [currencyCode, setCurrencyCode] = React.useState('SAR')
  const [notes, setNotes] = React.useState('')
  const [isSaving, setIsSaving] = React.useState(false)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (isSaving) return
    if (!periodStart || !periodEnd) {
      flash(t('hr_management.payroll.errors.periodRequired', 'Enter the period start and end dates.'), 'error')
      return
    }
    setIsSaving(true)
    const payload = { periodStart, periodEnd, paymentDate, currencyCode: currencyCode.trim().toUpperCase(), notes: notes.trim() || null }
    try {
      const call = await runMutation({
        operation: () => apiCallOrThrow<{ id: string }>('/api/hr_management/payroll-runs/create', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        }),
        context: {
          formId: 'hr.payroll-run:create',
          resourceKind: 'hr_management:hr_payroll_run',
          resourceId: 'new',
          retryLastMutation,
        },
        mutationPayload: payload,
      })
      if (call.result?.id) {
        flash(t('hr_management.payroll.messages.created', 'Payroll run created.'), 'success')
        router.push(`${LIST_HREF}/${call.result.id}`)
      }
    } catch {
      flash(t('hr_management.payroll.errors.save', 'Unable to create the payroll run.'), 'error')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <>
      <PageHeader title={t('hr_management.payroll.form.title', 'New payroll run')} />
      <PageBody>
        <form onSubmit={handleSubmit} className="grid max-w-2xl gap-6">
          <Card>
            <CardHeader><CardTitle>{t('hr_management.payroll.form.details', 'Period')}</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="period-start">{t('hr_management.payroll.form.periodStart', 'Period start')}</Label>
                <Input id="period-start" type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="period-end">{t('hr_management.payroll.form.periodEnd', 'Period end')}</Label>
                <Input id="period-end" type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="payment-date">{t('hr_management.payroll.form.paymentDate', 'Payment date')}</Label>
                <Input id="payment-date" type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="currency">{t('hr_management.payroll.form.currency', 'Currency')}</Label>
                <Input id="currency" value={currencyCode} onChange={(event) => setCurrencyCode(event.target.value)} />
              </div>
              <div className="grid gap-1.5 sm:col-span-2">
                <Label htmlFor="notes">{t('hr_management.payroll.form.notes', 'Notes')}</Label>
                <Input id="notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
              </div>
            </CardContent>
          </Card>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => router.push(LIST_HREF)}>
              {t('hr_management.payroll.form.cancel', 'Cancel')}
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? <Spinner size="sm" /> : null}
              {t('hr_management.payroll.form.submit', 'Create run')}
            </Button>
          </div>
        </form>
      </PageBody>
    </>
  )
}
