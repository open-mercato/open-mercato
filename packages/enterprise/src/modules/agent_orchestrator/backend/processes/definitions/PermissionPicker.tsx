'use client'

import * as React from 'react'
import { TagsInput } from '@open-mercato/ui/backend/inputs/TagsInput'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { unknownFeatureIds } from './formHelpers'

export type PermissionOption = { id: string; title: string }

export function PermissionPicker({
  value,
  onChange,
  catalog,
  disabled,
}: {
  value: string[]
  onChange: (value: string[]) => void
  catalog?: PermissionOption[]
  disabled?: boolean
}) {
  const t = useT()
  const [loaded, setLoaded] = React.useState<PermissionOption[]>([])
  const [status, setStatus] = React.useState<'loading' | 'ready' | 'error'>('loading')
  const [retry, setRetry] = React.useState(0)
  const [focused, setFocused] = React.useState(false)
  React.useEffect(() => {
    if (catalog) return
    let cancelled = false
    setStatus('loading')
    void apiCall<{ items?: PermissionOption[] }>('/api/agent_orchestrator/features')
      .then((call) => {
        if (cancelled) return
        if (!call.ok || !Array.isArray(call.result?.items)) {
          setStatus('error')
          return
        }
        setLoaded(call.result.items)
        setStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [catalog, retry])
  const options = catalog ?? loaded
  const unknown =
    catalog || status === 'ready'
      ? unknownFeatureIds(
          value,
          options.map((option) => option.id),
        )
      : []
  return (
    <div
      className="space-y-2"
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setFocused(false)
      }}
    >
      <TagsInput
        value={value}
        onChange={onChange}
        disabled={disabled}
        placeholder={t('agent_orchestrator.processDefinitions.form.permissionSearch')}
        selectedOptions={options
          .filter((option) => value.includes(option.id))
          .map((option) => ({
            value: option.id,
            label: option.title ? t(option.title, option.title) : option.id,
          }))}
        suggestions={
          focused
            ? options.map((option) => ({
                value: option.id,
                label: option.title ? t(option.title, option.title) : option.id,
                description: option.id,
              }))
            : []
        }
        allowCustomValues
        commitOnBlur={false}
      />
      {unknown.length > 0 ? (
        <Alert status="warning" size="sm">
          <AlertDescription>
            {t('agent_orchestrator.processDefinitions.form.featuresUnknown')}: {unknown.join(', ')}
          </AlertDescription>
        </Alert>
      ) : null}
      {!catalog && status === 'loading' ? (
        <LoadingMessage label={t('agent_orchestrator.processDefinitions.form.permissionsLoading')} />
      ) : null}
      {!catalog && status === 'error' ? (
        <div role="status" className="text-sm text-status-warning-text">
          {t('agent_orchestrator.processDefinitions.form.permissionsError')}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setRetry((previous) => previous + 1)}
          >
            {t('agent_orchestrator.processDefinitions.milestones.retry')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
