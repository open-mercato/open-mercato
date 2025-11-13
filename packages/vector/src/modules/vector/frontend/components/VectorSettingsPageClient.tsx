/* eslint-disable jsx-a11y/label-has-associated-control */
'use client'

import * as React from 'react'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { Label } from '@open-mercato/ui/primitives/label'
import { Spinner } from '@open-mercato/ui/primitives/spinner'

type VectorSettings = {
  openaiConfigured: boolean
  autoIndexingEnabled: boolean
  autoIndexingLocked: boolean
  lockReason: string | null
}

type Props = {
  statusTitle: string
  statusEnabledMessage: string
  statusDisabledMessage: string
  autoIndexingLabel: string
  autoIndexingDescription: string
  autoIndexingLockedMessage: string
  toggleSuccessMessage: string
  toggleErrorMessage: string
  refreshLabel: string
  savingLabel: string
  loadingLabel: string
}

type SettingsResponse = {
  settings?: VectorSettings
  error?: string
}

const normalizeErrorMessage = (error: unknown, fallback: string): string => {
  if (typeof error === 'string' && error.trim().length) return error.trim()
  if (error instanceof Error && error.message.trim().length) return error.message.trim()
  return fallback
}

export function VectorSettingsPageClient(props: Props) {
  const [settings, setSettings] = React.useState<VectorSettings | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const previousValueRef = React.useRef<boolean>(true)

  const fetchSettings = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const body = await readApiResultOrThrow<SettingsResponse>(
        '/api/vector/settings',
        undefined,
        { errorMessage: props.toggleErrorMessage, allowNullResult: true },
      )
      if (body?.settings) {
        setSettings(body.settings)
        previousValueRef.current = body.settings.autoIndexingEnabled
      } else {
        previousValueRef.current = true
        setSettings({
          openaiConfigured: false,
          autoIndexingEnabled: true,
          autoIndexingLocked: false,
          lockReason: null,
        })
      }
    } catch (err) {
      const message = normalizeErrorMessage(err, props.toggleErrorMessage)
      setError(message)
      flash(message, 'error')
    } finally {
      setLoading(false)
    }
  }, [props.toggleErrorMessage])

  React.useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

  const updateAutoIndexing = React.useCallback(
    async (nextValue: boolean) => {
      setSettings((prev) => {
        previousValueRef.current = prev?.autoIndexingEnabled ?? true
        if (prev) return { ...prev, autoIndexingEnabled: nextValue }
        return {
          openaiConfigured: false,
          autoIndexingEnabled: nextValue,
          autoIndexingLocked: false,
          lockReason: null,
        }
      })
      setSaving(true)
      try {
        const body = await readApiResultOrThrow<SettingsResponse>(
          '/api/vector/settings',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ autoIndexingEnabled: nextValue }),
          },
          { errorMessage: props.toggleErrorMessage, allowNullResult: true },
        )
        if (body?.settings) {
          setSettings(body.settings)
          previousValueRef.current = body.settings.autoIndexingEnabled
        }
        flash(props.toggleSuccessMessage, 'success')
      } catch (err) {
        const message = normalizeErrorMessage(err, props.toggleErrorMessage)
        flash(message, 'error')
        setSettings((prev) => (prev ? { ...prev, autoIndexingEnabled: previousValueRef.current } : prev))
      } finally {
        setSaving(false)
      }
    },
    [props.toggleErrorMessage, props.toggleSuccessMessage],
  )

  const autoIndexingChecked = settings ? settings.autoIndexingEnabled : true
  const autoIndexingDisabled = loading || saving || Boolean(settings?.autoIndexingLocked)
  const statusMessage = settings?.openaiConfigured ? props.statusEnabledMessage : props.statusDisabledMessage

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">{props.statusTitle}</h2>
            <p className="text-sm text-muted-foreground">
              {loading ? props.loadingLabel : statusMessage}
            </p>
          </div>
          <div
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ${
              settings?.openaiConfigured
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200'
                : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200'
            }`}
          >
            {loading ? <Spinner size="sm" /> : null}
            <span>{loading ? props.loadingLabel : statusMessage}</span>
          </div>
        </div>

        <div className="mt-5 space-y-2">
          <div className="flex items-center gap-3">
            <input
              id="vector-auto-indexing"
              type="checkbox"
              className="h-4 w-4 rounded border-muted-foreground/40"
              checked={autoIndexingChecked}
              onChange={(event) => updateAutoIndexing(event.target.checked)}
              disabled={autoIndexingDisabled}
            />
            <Label htmlFor="vector-auto-indexing" className="text-sm font-medium">
              {props.autoIndexingLabel}
            </Label>
            {saving ? <Spinner size="sm" className="text-muted-foreground" /> : null}
          </div>
          <p className="text-sm text-muted-foreground">{props.autoIndexingDescription}</p>
          {settings?.autoIndexingLocked ? (
            <p className="text-sm text-destructive">{props.autoIndexingLockedMessage}</p>
          ) : null}
        </div>

        <div className="mt-5 flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fetchSettings()}
            disabled={loading}
          >
            {loading ? props.loadingLabel : props.refreshLabel}
          </Button>
          {saving ? <span className="text-sm text-muted-foreground">{props.savingLabel}</span> : null}
          {error ? <span className="text-sm text-destructive">{error}</span> : null}
        </div>
      </div>
    </div>
  )
}

export default VectorSettingsPageClient
