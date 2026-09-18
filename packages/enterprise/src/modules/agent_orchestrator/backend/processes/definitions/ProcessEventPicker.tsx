'use client'

import * as React from 'react'
import { ComboboxInput } from '@open-mercato/ui/backend/inputs/ComboboxInput'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export function ProcessEventPicker({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}) {
  const t = useT()
  const [options, setOptions] = React.useState<Array<{ value: string; label: string; description?: string }>>(
    [],
  )
  const [status, setStatus] = React.useState<'loading' | 'ready' | 'error'>('loading')
  const [retry, setRetry] = React.useState(0)
  React.useEffect(() => {
    let cancelled = false
    setStatus('loading')
    void apiCall<{
      data?: Array<{ id: string; label: string; description?: string; excludeFromTriggers?: boolean }>
    }>('/api/events?excludeTriggerExcluded=true')
      .then((call) => {
        if (cancelled) return
        if (!call.ok || !Array.isArray(call.result?.data)) {
          setStatus('error')
          return
        }
        setOptions(
          call.result.data
            .filter((event) => !event.excludeFromTriggers)
            .map((event) => ({
              value: event.id,
              label: `${event.label} (${event.id})`,
              description: event.description,
            })),
        )
        setStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [retry])
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">
        {t('agent_orchestrator.processDefinitions.triggers.event.pattern')}
      </p>
      <ComboboxInput
        value={value}
        onChange={onChange}
        suggestions={options}
        disabled={disabled}
        allowCustomValues
        placeholder={t('agent_orchestrator.processDefinitions.triggers.event.search')}
      />
      {status === 'loading' ? (
        <LoadingMessage label={t('agent_orchestrator.processDefinitions.triggers.event.loading')} />
      ) : null}
      {status === 'error' ? (
        <div role="status" className="text-sm text-status-warning-text">
          {t('agent_orchestrator.processDefinitions.triggers.event.loadError')}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setRetry((previous) => previous + 1)}
          >
            {t('agent_orchestrator.processDefinitions.milestones.retry')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
