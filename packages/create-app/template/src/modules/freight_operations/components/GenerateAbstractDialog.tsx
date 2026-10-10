"use client"

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { useDialogKeyHandler } from '@open-mercato/ui/hooks/useDialogKeyHandler'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall, apiCallOrThrow, type ApiCallResult } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

const CONTEXT_ID = 'freight_operations.abstracts.generate'

export type ActiveContractOption = { value: string; label: string; currencyCode: string }

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export function useActiveContractOptions() {
  const scopeVersion = useOrganizationScopeVersion()
  const query = useQuery({
    queryKey: ['freight-active-contract-options', scopeVersion],
    queryFn: async (): Promise<ActiveContractOption[]> => {
      const call = await apiCall<{ items?: Array<Record<string, unknown>> }>('/api/freight_operations/contracts?status=active&pageSize=100')
      return (call.result?.items ?? []).flatMap((raw) => {
        const id = typeof raw.id === 'string' ? raw.id : null
        if (!id) return []
        const number = typeof raw.contract_number === 'string' ? raw.contract_number : id
        const title = typeof raw.title === 'string' ? raw.title : ''
        const currencyCode = typeof raw.currency_code === 'string' ? raw.currency_code : 'SAR'
        return [{ value: id, label: `${number} · ${title}`.trim(), currencyCode }]
      })
    },
    staleTime: 60 * 1000,
  })
  return query.data ?? []
}

export function GenerateAbstractDialog({
  open,
  onOpenChange,
  pinnedContractId,
  onGenerated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Launched from a contract detail: the contract is fixed and only the period is chosen. */
  pinnedContractId?: string | null
  onGenerated?: (abstractId: string) => void
}) {
  const t = useT()
  const router = useRouter()
  const contracts = useActiveContractOptions()
  const [contractId, setContractId] = React.useState(pinnedContractId ?? '')
  const [periodFrom, setPeriodFrom] = React.useState(daysAgo(30))
  const [periodTo, setPeriodTo] = React.useState(new Date().toISOString().slice(0, 10))
  const [error, setError] = React.useState<string | null>(null)
  const { runMutation, retryLastMutation } = useGuardedMutation<{ formId: string; resourceKind: string; resourceId?: string; retryLastMutation: () => Promise<boolean> }>({
    contextId: CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  React.useEffect(() => {
    if (!open) return
    setContractId(pinnedContractId ?? '')
    setError(null)
  }, [open, pinnedContractId])

  const contract = contracts.find((option) => option.value === contractId)
  const submit = React.useCallback(async () => {
    if (!contractId) {
      setError(t('freight_operations.abstracts.generate.error.contract', 'Choose a contract.'))
      return
    }
    try {
      const response = await runMutation<ApiCallResult<{ abstractId?: string }>>({
        // Generation creates a new aggregate (it parks the period's delivered
        // trips inside it); there is no record version to guard the call with.
        operation: () => apiCallOrThrow<{ abstractId?: string }>('/api/freight_operations/abstracts/generate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ contractId, periodFrom, periodTo }),
        }, { errorMessage: t('freight_operations.abstracts.generate.error.failed', 'Unable to generate the abstract.') }),
        mutationPayload: { operation: 'abstracts.generate', contractId, periodFrom, periodTo },
        context: { formId: CONTEXT_ID, resourceKind: 'freight_operations:freight_trip_abstract', retryLastMutation },
      })
      const abstractId = response.result?.abstractId ?? null
      flash(t('freight_operations.abstracts.generate.success', 'Abstract generated.'), 'success')
      onOpenChange(false)
      if (abstractId) {
        if (onGenerated) onGenerated(abstractId)
        else router.push(`/backend/freight/abstracts/${abstractId}`)
      }
    } catch (caught) {
      setError(caught instanceof Error && caught.message
        ? caught.message
        : t('freight_operations.abstracts.generate.error.failed', 'Unable to generate the abstract.'))
    }
  }, [contractId, onGenerated, onOpenChange, periodFrom, periodTo, retryLastMutation, router, runMutation, t])

  const handleKeyDown = useDialogKeyHandler({
    onConfirm: () => { void submit() },
    onCancel: () => onOpenChange(false),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{t('freight_operations.abstracts.generate.title', 'Generate abstract')}</DialogTitle>
          <DialogDescription>
            {t('freight_operations.abstracts.generate.description', 'Collects the delivered, unbilled trips of the period into a new abstract. Each trip can sit on one live abstract only.')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {pinnedContractId ? (
            <p className="text-sm text-muted-foreground">
              {t('freight_operations.abstracts.generate.contract', 'Contract')}: {contract?.label ?? pinnedContractId}
            </p>
          ) : (
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-foreground">{t('freight_operations.abstracts.generate.contract', 'Contract')}</span>
              <Select value={contractId} onValueChange={setContractId}>
                <SelectTrigger aria-label={t('freight_operations.abstracts.generate.contract', 'Contract')}>
                  <SelectValue placeholder={t('freight_operations.abstracts.generate.contractPlaceholder', 'Choose an active contract')} />
                </SelectTrigger>
                <SelectContent>
                  {contracts.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-foreground">{t('freight_operations.abstracts.generate.periodFrom', 'Period from')}</span>
              <Input type="date" value={periodFrom} onChange={(event) => setPeriodFrom(event.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-foreground">{t('freight_operations.abstracts.generate.periodTo', 'Period to')}</span>
              <Input type="date" value={periodTo} onChange={(event) => setPeriodTo(event.target.value)} />
            </label>
          </div>

          {error ? <p className="text-sm text-status-error-text">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('freight_operations.abstracts.generate.cancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={() => { void submit() }}>
            {t('freight_operations.abstracts.generate.submit', 'Generate')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
