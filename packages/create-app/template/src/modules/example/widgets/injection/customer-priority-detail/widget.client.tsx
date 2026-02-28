"use client"

import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type PriorityValue = 'low' | 'normal' | 'high' | 'critical'
type PriorityItem = { id?: string; priority?: string }
type PriorityResponse = { items?: PriorityItem[]; data?: PriorityItem[] }

function readCustomerId(context: unknown, data: unknown): string | null {
  const ctx = context && typeof context === 'object' ? (context as Record<string, unknown>) : {}
  const payload = data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  const person = payload.person && typeof payload.person === 'object' ? (payload.person as Record<string, unknown>) : {}
  const contextId = typeof ctx.personId === 'string'
    ? ctx.personId
    : (typeof ctx.resourceId === 'string' ? ctx.resourceId : null)
  const dataId = typeof person.id === 'string' ? person.id : null
  return contextId || dataId
}

function normalizePriority(value: unknown): PriorityValue {
  return value === 'low' || value === 'high' || value === 'critical' ? value : 'normal'
}

export default function CustomerPriorityDetailWidget({ context, data, disabled }: InjectionWidgetComponentProps) {
  const t = useT()
  const customerId = React.useMemo(() => readCustomerId(context, data), [context, data])
  const { runMutation } = useGuardedMutation<{ resourceType: string; resourceId: string | null }>({
    contextId: `example.customer-priority.detail.${customerId ?? 'unknown'}`,
  })
  const [priorityId, setPriorityId] = React.useState<string | null>(null)
  const [value, setValue] = React.useState<PriorityValue>('normal')
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false

    async function load() {
      if (!customerId) {
        if (!cancelled) {
          setLoading(false)
          setPriorityId(null)
          setValue('normal')
          setError(null)
        }
        return
      }
      setLoading(true)
      setError(null)
      try {
        const payload = await readApiResultOrThrow<PriorityResponse>(
          `/api/example/customer-priorities?customerId=${encodeURIComponent(customerId)}&page=1&pageSize=1`,
        )
        if (cancelled) return
        const entries = Array.isArray(payload.items) ? payload.items : (Array.isArray(payload.data) ? payload.data : [])
        const first = entries[0]
        setPriorityId(typeof first?.id === 'string' ? first.id : null)
        setValue(normalizePriority(first?.priority))
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error && err.message ? err.message : t('example.priority.detail.error.load')
        setError(message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => { cancelled = true }
  }, [customerId, t])

  const handleChange = React.useCallback(async (event: React.ChangeEvent<HTMLSelectElement>) => {
    if (!customerId) return
    const next = normalizePriority(event.target.value)
    setValue(next)
    setSaving(true)
    setError(null)
    try {
      const payload = priorityId
        ? { id: priorityId, customerId, priority: next }
        : { customerId, priority: next }
      const method = priorityId ? 'PUT' : 'POST'
      const response = await runMutation({
        operation: () => readApiResultOrThrow<{ id?: string }>(
          '/api/example/customer-priorities',
          {
            method,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          },
        ),
        context: {
          resourceType: 'customers.person',
          resourceId: customerId,
        },
        mutationPayload: payload,
      })
      if (response && typeof response.id === 'string' && response.id.length > 0) {
        setPriorityId(response.id)
      }
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : t('example.priority.detail.error.save')
      setError(message)
    } finally {
      setSaving(false)
    }
  }, [customerId, priorityId, t, runMutation])

  if (!customerId) return null

  return (
    <div className="rounded-md border border-border p-3">
      <div className="mb-1 text-sm font-medium text-foreground">{t('example.priority.detail.label')}</div>
      <div className="text-xs text-muted-foreground mb-2">{t('example.priority.detail.description')}</div>
      <select
        className="h-9 w-full rounded border border-input bg-background px-3 text-sm"
        value={value}
        onChange={(event) => { void handleChange(event) }}
        disabled={disabled || loading || saving}
      >
        <option value="low">{t('example.priority.low')}</option>
        <option value="normal">{t('example.priority.normal')}</option>
        <option value="high">{t('example.priority.high')}</option>
        <option value="critical">{t('example.priority.critical')}</option>
      </select>
      {loading ? <div className="mt-2 text-xs text-muted-foreground">{t('example.priority.detail.loading')}</div> : null}
      {saving ? <div className="mt-2 text-xs text-muted-foreground">{t('example.priority.detail.saving')}</div> : null}
      {error ? <div className="mt-2 text-xs text-destructive">{error}</div> : null}
    </div>
  )
}
