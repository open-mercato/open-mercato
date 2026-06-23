"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'

export type LeadQualificationDialogProps = {
  leadId: string
  leadUpdatedAt: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onConverted: () => void
  hasContactName: boolean
  hasCompanyName: boolean
}

type ConvertResponse = {
  id: string
  status: string
  createdDealId: string | null
  createdPersonEntityId: string | null
  createdCompanyEntityId: string | null
}

type ConvertErrorResponse = {
  error?: string
}

export function LeadQualificationDialog({
  leadId,
  leadUpdatedAt,
  open,
  onOpenChange,
  onConverted,
  hasContactName,
  hasCompanyName,
}: LeadQualificationDialogProps) {
  const t = useT()
  const [createDeal, setCreateDeal] = React.useState(false)
  const [createPerson, setCreatePerson] = React.useState(false)
  const [createCompany, setCreateCompany] = React.useState(false)
  const [isConverting, setIsConverting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const dialogRef = React.useRef<HTMLDivElement | null>(null)

  const { runMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: `lead-qualify-${leadId}`,
  })

  const resetState = React.useCallback(() => {
    setCreateDeal(false)
    setCreatePerson(false)
    setCreateCompany(false)
    setError(null)
  }, [])

  React.useEffect(() => {
    if (open) {
      resetState()
    }
  }, [open, resetState])

  const canSubmit = (createDeal || createPerson || createCompany) && !isConverting
  const personBlocked = createPerson && !hasContactName
  const companyBlocked = createCompany && !hasCompanyName

  const handleKeyDown = React.useCallback(
    (event: KeyboardEvent | React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onOpenChange(false)
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        if (canSubmit && !personBlocked && !companyBlocked) {
          handleSubmit()
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canSubmit, personBlocked, companyBlocked, onOpenChange],
  )

  React.useEffect(() => {
    if (!open) return
    const handler = (event: KeyboardEvent) => handleKeyDown(event)
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, handleKeyDown])

  const handleSubmit = React.useCallback(async () => {
    if (!canSubmit || personBlocked || companyBlocked || isConverting) return
    setError(null)
    setIsConverting(true)
    try {
      await runMutation({
        operation: async () => {
          const response = await apiCall<ConvertResponse>(
            `/api/customers/leads/${encodeURIComponent(leadId)}/convert`,
            {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                'if-match': leadUpdatedAt,
              },
              body: JSON.stringify({
                createDeal,
                createPerson,
                createCompany,
              }),
            },
          )
          if (!response.ok) {
            const errorResult = response.result as unknown as ConvertErrorResponse | null
            const message =
              typeof errorResult?.error === 'string'
                ? errorResult.error
                : t('customers.leads.convert.error', 'Failed to qualify lead.')
            throw new Error(message)
          }
          return response.result as ConvertResponse
        },
        context: { leadId, createDeal, createPerson, createCompany },
        mutationPayload: { createDeal, createPerson, createCompany },
      })
      flash(t('customers.leads.convert.success', 'Lead qualified.'), 'success')
      onOpenChange(false)
      onConverted()
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : t('customers.leads.convert.error', 'Failed to qualify lead.')
      setError(message)
      flash(message, 'error')
    } finally {
      setIsConverting(false)
    }
  }, [
    canSubmit,
    personBlocked,
    companyBlocked,
    isConverting,
    runMutation,
    leadId,
    leadUpdatedAt,
    createDeal,
    createPerson,
    createCompany,
    onOpenChange,
    onConverted,
    t,
  ])

  if (!open) return null

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onOpenChange(false)
        }
      }}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lead-qualify-title"
      >
        <h2 id="lead-qualify-title" className="text-lg font-semibold text-foreground">
          {t('customers.leads.convert.title', 'Qualify lead')}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('customers.leads.convert.description', 'Choose which records to create from this lead.')}
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <label className="flex items-center gap-3 rounded-md border border-border p-3 cursor-pointer hover:bg-muted/50">
            <input
              type="checkbox"
              checked={createDeal}
              onChange={(event) => setCreateDeal(event.target.checked)}
              className="h-4 w-4 rounded border-border"
            />
            <span className="text-sm font-medium">
              {t('customers.leads.convert.dealLabel', 'Create deal')}
            </span>
          </label>

          <label className="flex items-center gap-3 rounded-md border border-border p-3 cursor-pointer hover:bg-muted/50">
            <input
              type="checkbox"
              checked={createPerson}
              onChange={(event) => setCreatePerson(event.target.checked)}
              className="h-4 w-4 rounded border-border"
            />
            <span className="text-sm font-medium">
              {t('customers.leads.convert.personLabel', 'Create person')}
            </span>
          </label>
          {personBlocked ? (
            <p className="ml-7 text-xs text-destructive">
              {t(
                'customers.leads.convert.personRequired',
                'Contact first and last name are required to create a person.',
              )}
            </p>
          ) : null}

          <label className="flex items-center gap-3 rounded-md border border-border p-3 cursor-pointer hover:bg-muted/50">
            <input
              type="checkbox"
              checked={createCompany}
              onChange={(event) => setCreateCompany(event.target.checked)}
              className="h-4 w-4 rounded border-border"
            />
            <span className="text-sm font-medium">
              {t('customers.leads.convert.companyLabel', 'Create company')}
            </span>
          </label>
          {companyBlocked ? (
            <p className="ml-7 text-xs text-destructive">
              {t(
                'customers.leads.convert.companyRequired',
                'Company name is required to create a company.',
              )}
            </p>
          ) : null}
        </div>

        {!canSubmit && !isConverting ? (
          <p className="mt-3 text-xs text-muted-foreground">
            {t('customers.leads.convert.allTargetsRequired', 'Select at least one record to create.')}
          </p>
        ) : null}

        {error ? (
          <p className="mt-3 text-sm text-destructive">{error}</p>
        ) : null}

        <div className="mt-6 flex items-center justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isConverting}
          >
            {t('customers.leads.convert.cancel', 'Cancel')}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit || personBlocked || companyBlocked || isConverting}
          >
            {isConverting
              ? t('customers.leads.convert.converting', 'Qualifying…')
              : t('customers.leads.convert.submit', 'Qualify lead')}
          </Button>
        </div>
      </div>
    </div>
  )
}