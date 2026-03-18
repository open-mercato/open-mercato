'use client'

import * as React from 'react'
import Link from 'next/link'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { TagsInput } from '@open-mercato/ui/backend/inputs'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Notice } from '@open-mercato/ui/primitives/Notice'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { E } from '@open-mercato/core/generated-shims/entities.ids.generated'
import { DEFAULT_RECORD_LOCK_SETTINGS } from '../../../lib/config'

type RecordLockSettings = {
  enabled: boolean
  strategy: 'optimistic' | 'pessimistic'
  timeoutSeconds: number
  heartbeatSeconds: number
  enabledResources: string[]
  allowForceUnlock: boolean
  allowIncomingOverride: boolean
  notifyOnConflict: boolean
}

const DEFAULT_SETTINGS: RecordLockSettings = {
  ...DEFAULT_RECORD_LOCK_SETTINGS,
}

const RECORD_LOCK_RESOURCE_ALIASES = [
  'customers.person',
  'customers.company',
  'customers.deal',
  'sales.quote',
  'sales.order',
]

const RECORD_LOCK_RESOURCE_SUGGESTIONS = Array.from(
  new Set([
    ...Object.values(E).flatMap((moduleEntities) =>
      Object.values(moduleEntities).flatMap((entityId) => {
        if (typeof entityId !== 'string' || !entityId.includes(':')) return []
        return [entityId.replace(':', '.')]
      })
    ),
    ...RECORD_LOCK_RESOURCE_ALIASES,
  ]),
).sort((left, right) => left.localeCompare(right))

export default function RecordLockingSettingsPage() {
  const t = useT()
  const [settings, setSettings] = React.useState<RecordLockSettings>(DEFAULT_SETTINGS)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)

  const normalizeResources = React.useCallback((input: string[]): string[] => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const raw of input) {
      const resource = typeof raw === 'string' ? raw.trim() : ''
      if (!resource || seen.has(resource)) continue
      seen.add(resource)
      out.push(resource)
    }
    return out
  }, [])

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const call = await apiCall<{ settings?: RecordLockSettings }>('/api/record_locks/settings')
      const next = call.result?.settings ?? DEFAULT_SETTINGS
      setSettings({
        ...next,
        enabledResources: normalizeResources(next.enabledResources ?? []),
      })
    } catch {
      flash(t('record_locks.settings.save_error', 'Failed to load settings'), 'error')
    } finally {
      setLoading(false)
    }
  }, [normalizeResources, t])

  React.useEffect(() => {
    void load()
  }, [load])

  const onSave = React.useCallback(async () => {
    setSaving(true)
    try {
      const payload: RecordLockSettings = {
        ...settings,
        enabledResources: normalizeResources(settings.enabledResources ?? []),
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
      setSettings({
        ...next,
        enabledResources: normalizeResources(next.enabledResources ?? []),
      })
      flash(t('record_locks.settings.saved', 'Settings saved'), 'success')
    } catch {
      flash(t('record_locks.settings.save_error', 'Failed to save settings'), 'error')
    } finally {
      setSaving(false)
    }
  }, [normalizeResources, settings, t])

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
          <Notice compact variant="info">
            <p>
              <strong>{t('record_locks.settings.strategy_optimistic', 'Optimistic')}:</strong>{' '}
              {t(
                'record_locks.settings.strategy_help_optimistic',
                'Multiple users can edit at the same time; conflicts are checked on save.',
              )}
            </p>
            <p className="mt-1">
              <strong>{t('record_locks.settings.strategy_pessimistic', 'Pessimistic')}:</strong>{' '}
              {t(
                'record_locks.settings.strategy_help_pessimistic',
                'First editor acquires the lock and blocks concurrent edits until release.',
              )}
            </p>
          </Notice>
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
          <Label>{t('record_locks.settings.enabled_resources', 'Enabled resources')}</Label>
          <TagsInput
            value={settings.enabledResources}
            onChange={(next) => setSettings((prev) => ({ ...prev, enabledResources: normalizeResources(next) }))}
            suggestions={RECORD_LOCK_RESOURCE_SUGGESTIONS}
            allowCustomValues
            disabled={saving}
            placeholder={t(
              'record_locks.settings.enabled_resources_placeholder',
              'Add resource kind and press Enter',
            )}
          />
          <p className="text-xs text-muted-foreground">
            {t(
              'record_locks.settings.enabled_resources_hint',
              'Pick from suggestions or type a custom resource kind.',
            )}
          </p>
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
          <Label htmlFor="record-lock-allow-incoming-override">
            {t('record_locks.settings.allow_incoming_override', 'Allow overriding incoming changes')}
          </Label>
          <Switch
            id="record-lock-allow-incoming-override"
            checked={settings.allowIncomingOverride}
            onCheckedChange={(checked) => setSettings((prev) => ({ ...prev, allowIncomingOverride: checked }))}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {t(
            'record_locks.settings.allow_incoming_override_hint',
            'Users still need the record_locks.override_incoming feature in their role or user ACL to keep their version during conflicts.'
          )}{' '}
          <Link href="/backend/users" className="underline underline-offset-2 hover:text-foreground">
            {t('record_locks.settings.allow_incoming_override_permissions_link', 'Check permissions')}
          </Link>
        </p>

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
