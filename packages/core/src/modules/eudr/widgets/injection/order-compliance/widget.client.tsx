"use client"

import * as React from 'react'
import Link from 'next/link'
import { Check, Copy } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { statusBadgeVariant } from '../../../components/formConfig'

export type OrderRecord = {
  id: string
}

type StatementListItem = {
  id: string
  title: string | null
  status: string | null
  referenceNumber: string | null
  verificationNumber: string | null
}

function CopyNumberButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = React.useState(false)

  const handleCopy = React.useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return
    await navigator.clipboard.writeText(value)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }, [value])

  return (
    <IconButton type="button" variant="ghost" size="xs" onClick={handleCopy} aria-label={label}>
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
    </IconButton>
  )
}

export default function OrderComplianceWidget({ data }: InjectionWidgetComponentProps<unknown, OrderRecord>) {
  const t = useT()
  const orderId = data?.id

  const { data: statementsData, isLoading, isError } = useQuery({
    queryKey: ['eudr-order-statements', orderId],
    queryFn: async () => {
      if (!orderId) return null
      const result = await apiCall<{ items: StatementListItem[] }>(
        `/api/eudr/statements?orderId=${encodeURIComponent(orderId)}&pageSize=20`
      )
      if (!result.ok) throw new Error('[internal] eudr order compliance statements load failed')
      return result.result
    },
    enabled: Boolean(orderId),
    staleTime: 5_000,
  })

  if (!orderId) return null

  const statements = statementsData?.items ?? []

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4 shadow-sm">
      <div className="text-sm font-semibold text-foreground">
        {t('eudr.orderPanel.groupLabel', 'EUDR compliance')}
      </div>

      {isLoading ? (
        <LoadingMessage label={t('eudr.orderPanel.loading', 'Loading due diligence statements...')} />
      ) : isError ? (
        <ErrorMessage label={t('eudr.orderPanel.error', 'Failed to load due diligence statements.')} />
      ) : statements.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('eudr.orderPanel.empty', 'No due diligence statements are linked to this order.')}{' '}
          <Link
            href={`/backend/eudr/statements/create?orderId=${encodeURIComponent(orderId)}`}
            className="text-primary hover:underline"
          >
            {t('eudr.orderPanel.createStatement', 'Create statement')}
          </Link>
        </p>
      ) : (
        <ul className="space-y-2">
          {statements.map((statement) => (
            <li key={statement.id} className="space-y-1.5 rounded-md border p-2.5">
              <div className="flex items-center justify-between gap-2">
                <Link
                  href={`/backend/eudr/statements/${encodeURIComponent(statement.id)}`}
                  className="min-w-0 truncate text-sm font-medium hover:underline"
                >
                  {statement.title || t('eudr.orderPanel.untitled', 'Untitled statement')}
                </Link>
                {statement.status ? (
                  <StatusBadge variant={statusBadgeVariant(statement.status)} dot>
                    {t(`eudr.statementStatus.${statement.status}`)}
                  </StatusBadge>
                ) : null}
              </div>
              {statement.referenceNumber ? (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <span className="truncate">
                    {t('eudr.orderPanel.referenceLabel', 'Reference')}: {statement.referenceNumber}
                  </span>
                  <CopyNumberButton
                    value={statement.referenceNumber}
                    label={t('eudr.orderPanel.copyReference', 'Copy reference number')}
                  />
                </div>
              ) : null}
              {statement.verificationNumber ? (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <span className="truncate">
                    {t('eudr.orderPanel.verificationLabel', 'Verification')}: {statement.verificationNumber}
                  </span>
                  <CopyNumberButton
                    value={statement.verificationNumber}
                    label={t('eudr.orderPanel.copyVerification', 'Copy verification number')}
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
