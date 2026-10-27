"use client"

import * as React from 'react'
import { CheckCircle2, CircleDashed } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Alert, AlertTitle } from '@open-mercato/ui/primitives/alert'
import type { EudrStatementStatus } from '../data/validators'

type ReadinessResponse = {
  status?: string
  allowed?: boolean
  reasons?: string[]
}

export type StatementReadinessChecklistProps = {
  statementId: string
  status: EudrStatementStatus
  updatedAt: string
}

export function StatementReadinessChecklist({
  statementId,
  status,
  updatedAt,
}: StatementReadinessChecklistProps) {
  const translate = useT()
  const [readiness, setReadiness] = React.useState<{ allowed: boolean; reasons: string[] } | null>(null)

  React.useEffect(() => {
    if (status !== 'draft') {
      setReadiness(null)
      return
    }
    let cancelled = false
    async function loadReadiness() {
      const call = await apiCall<ReadinessResponse>(
        `/api/eudr/statements/${encodeURIComponent(statementId)}/readiness`,
        undefined,
        { fallback: null },
      )
      if (cancelled || !call.ok || !call.result) return
      const reasons = Array.isArray(call.result.reasons)
        ? call.result.reasons.filter((reason): reason is string => typeof reason === 'string' && reason.length > 0)
        : []
      setReadiness({ allowed: call.result.allowed === true, reasons })
    }
    void loadReadiness()
    return () => {
      cancelled = true
    }
  }, [statementId, status, updatedAt])

  if (status !== 'draft' || readiness === null) return null

  if (readiness.allowed) {
    return (
      <Alert status="success" style="lighter">
        <div className="flex items-center gap-2 text-sm leading-5">
          <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
          {translate('eudr.lifecycle.readinessReady')}
        </div>
      </Alert>
    )
  }

  return (
    <Alert status="information" style="lighter">
      <AlertTitle>{translate('eudr.lifecycle.readinessTitle')}</AlertTitle>
      <ul className="space-y-1 text-sm leading-5">
        {readiness.reasons.map((reason) => (
          <li key={reason} className="flex items-start gap-2">
            <CircleDashed className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{translate(reason)}</span>
          </li>
        ))}
      </ul>
    </Alert>
  )
}

export default StatementReadinessChecklist
