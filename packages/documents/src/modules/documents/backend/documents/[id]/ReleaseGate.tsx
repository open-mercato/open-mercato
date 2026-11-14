"use client"

import * as React from 'react'
import { Lock, LockOpen } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import type { ReleaseGateState } from './reviewModeModel'

export function ReleaseGate({ state, onActivate }: { state: ReleaseGateState; onActivate: () => void }) {
  const t = useT()
  const blocked = state.kind === 'blocked'
  const label = blocked
    ? t(state.blocking === 1 ? 'documents.findings.releaseGate.blockedOne' : 'documents.findings.releaseGate.blocked', { count: state.blocking })
    : t('documents.findings.releaseGate.ready')
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onActivate}
      data-testid="documents-release-gate"
      data-state={state.kind}
      className={cn(
        'rounded-full',
        blocked
          ? 'border-status-error-border bg-status-error-bg text-status-error-text hover:bg-status-error-bg'
          : 'border-status-success-border bg-status-success-bg text-status-success-text hover:bg-status-success-bg',
      )}
    >
      {blocked ? <Lock aria-hidden /> : <LockOpen aria-hidden />}
      {label}
    </Button>
  )
}
