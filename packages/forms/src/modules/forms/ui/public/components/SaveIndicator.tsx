"use client"

import * as React from 'react'
import { AlertCircle, Check, RefreshCw } from 'lucide-react'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { RunnerSaveState } from '../types'

export type SaveIndicatorProps = {
  state: RunnerSaveState
}

function formatTime(iso: string): string {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function SaveIndicator({ state }: SaveIndicatorProps) {
  const t = useT()
  let icon: React.ReactNode = null
  let label = ''
  let tone = 'text-muted-foreground'

  switch (state.status) {
    case 'idle':
      label = ''
      break
    case 'dirty':
      icon = <span aria-hidden="true">…</span>
      label = t('forms.runner.save_indicator.dirty', { fallback: 'Unsaved changes' })
      break
    case 'saving':
      icon = <Spinner className="h-3 w-3" />
      label = t('forms.runner.save_indicator.saving', { fallback: 'Saving…' })
      break
    case 'saved':
      icon = <Check aria-hidden="true" className="h-3 w-3 text-status-success-foreground" />
      label = t('forms.runner.save_indicator.saved_at', {
        fallback: 'Saved at {time}',
        time: formatTime(state.savedAt),
      })
      tone = 'text-status-success-foreground'
      break
    case 'conflict':
      icon = <RefreshCw aria-hidden="true" className="h-3 w-3 text-status-warning-foreground" />
      label = t('forms.runner.save_indicator.conflict', {
        fallback: 'We refreshed the form to merge a change made elsewhere.',
      })
      tone = 'text-status-warning-foreground'
      break
    case 'error':
      icon = <AlertCircle aria-hidden="true" className="h-3 w-3 text-status-error-foreground" />
      label = state.message
      tone = 'text-status-error-foreground'
      break
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={`inline-flex items-center gap-1.5 text-xs ${tone}`}
    >
      {icon}
      <span>{label}</span>
    </div>
  )
}
