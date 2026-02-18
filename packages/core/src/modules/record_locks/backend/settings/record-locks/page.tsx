'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Spinner } from '@open-mercato/ui/primitives/spinner'

type RecordLockSettings = {
  enabled: boolean
  strategy: 'optimistic' | 'pessimistic'
  timeoutSeconds: number
  heartbeatSeconds: number
  enabledResources: string[]
  allowForceUnlock: boolean
  notifyOnConflict: boolean
}

const DEFAULT_SETTINGS: RecordLockSettings = {
  enabled: false,
  strategy: 'optimistic',
  timeoutSeconds: 300,
  heartbeatSeconds: 30,
  enabledResources: [],
  allowForceUnlock: true,
  notifyOnConflict: true,
}

export default function RecordLockingSettingsPage() {
  const t = useT()
  const [settings, setSettings] = React.useState<RecordLockSettings>(DEFAULT_SETTINGS)
  const [resourcesText, setResourcesText] = React.useState('')
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)

  const parseResources = React.useCallback((value: string): string[] => {
    const seen = new Set<string>()
    const out: string[] = []
    value
      .split(/[\n,]/)
      .map((token) => token.trim())
      .filter(Boolean)
      .forEach((resource) => {
        if (seen.has(resource)) return
        seen.add(resource)
        out.push(resource)
      })
    return out
  }, [])

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const call = await apiCall<{ settings?: RecordLockSettings }>('/api/record_locks/settings')
      const next = call.result?.settings ?? DEFAULT_SETTINGS
      setSettings(next)
      setResourcesText((next.enabledResources ?? []).join('\n'))
    } catch {
      flash(t('record_locks.settings.save_error', 'Failed to load settings'), 'error')
    } finally {
      setLoading(false)
    }
  }, [t])

  React.useEffect(() => {
    void load()
  }, [load])

  const onSave = React.useCallback(async () => {
    setSaving(true)
    try {
      const payload: RecordLockSettings = {
        ...settings,
        enabledResources: parseResources(resourcesText),
      }
      const call = await apiCallOrThrow<{ settings?: RecordLockSettings }>(
        '/api/record_locks/settings',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        },
        { errorMessage: t('record_locks.settings.save_error', 'Failed to save settings') },
      )

      const next = call.result?.settings ?? payload
      setSettings(next)
      setResourcesText((next.enabledResources ?? []).join('\n'))
      flash(t('record_locks.settings.saved', 'Settings saved'), 'success')
    } catch {
      flash(t('record_locks.settings.save_error', 'Failed to save settings'), 'error')
    } finally {
      setSaving(false)
    }
  }, [parseResources, resourcesText, settings, t])

  if (loading) {
    return (
      <div className="p-6">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('record_locks.settings.title', 'Record locking')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('record_locks.settings.description', 'Configure optimistic/pessimistic locking and conflict handling.')}
        </p>
      </div>

      <div className="space-y-5 rounded-lg border p-4">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="record-lock-enabled">{t('record_locks.settings.enabled', 'Enable record locking')}</Label>
          <Switch
            id="record-lock-enabled"
            checked={settings.enabled}
            onCheckedChange={(checked) => setSettings((prev) => ({ ...prev, enabled: checked }))}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="record-lock-strategy">{t('record_locks.settings.strategy', 'Strategy')}</Label>
          <select
            id="record-lock-strategy"
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            value={settings.strategy}
            onChange={(event) => setSettings((prev) => ({
              ...prev,
              strategy: event.target.value === 'pessimistic' ? 'pessimistic' : 'optimistic',
            }))}
          >
            <option value="optimistic">{t('record_locks.settings.strategy_optimistic', 'Optimistic')}</option>
            <option value="pessimistic">{t('record_locks.settings.strategy_pessimistic', 'Pessimistic')}</option>
          </select>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="record-lock-timeout">{t('record_locks.settings.timeout_seconds', 'Lock timeout (seconds)')}</Label>
            <Input
              id="record-lock-timeout"
              type="number"
              min={30}
              max={3600}
              value={settings.timeoutSeconds}
              onChange={(event) => setSettings((prev) => ({
                ...prev,
                timeoutSeconds: Math.max(30, Math.min(3600, Number(event.target.value) || 30)),
              }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="record-lock-heartbeat">{t('record_locks.settings.heartbeat_seconds', 'Heartbeat interval (seconds)')}</Label>
            <Input
              id="record-lock-heartbeat"
              type="number"
              min={5}
              max={300}
              value={settings.heartbeatSeconds}
              onChange={(event) => setSettings((prev) => ({
                ...prev,
                heartbeatSeconds: Math.max(5, Math.min(300, Number(event.target.value) || 5)),
              }))}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="record-lock-resources">{t('record_locks.settings.enabled_resources', 'Enabled resources')}</Label>
          <textarea
            id="record-lock-resources"
            className="min-h-[120px] w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={resourcesText}
            onChange={(event) => setResourcesText(event.target.value)}
            placeholder="customers.person\ncustomers.company\nsales.order"
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="record-lock-force-unlock">{t('record_locks.settings.allow_force_unlock', 'Allow force unlock')}</Label>
          <Switch
            id="record-lock-force-unlock"
            checked={settings.allowForceUnlock}
            onCheckedChange={(checked) => setSettings((prev) => ({ ...prev, allowForceUnlock: checked }))}
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="record-lock-notify-conflict">{t('record_locks.settings.notify_on_conflict', 'Notify on conflict')}</Label>
          <Switch
            id="record-lock-notify-conflict"
            checked={settings.notifyOnConflict}
            onCheckedChange={(checked) => setSettings((prev) => ({ ...prev, notifyOnConflict: checked }))}
          />
        </div>

        <div className="pt-2">
          <Button onClick={() => void onSave()} disabled={saving}>
            {saving ? t('ui.forms.status.saving', 'Saving...') : t('record_locks.settings.save', 'Save settings')}
          </Button>
        </div>
      </div>
    </div>
  )
}
