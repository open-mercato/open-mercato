'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { CheckboxField } from '@open-mercato/ui/primitives/checkbox-field'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'

type CommandSettingsItem = {
  commandId: string
  requiredFeatures: string[]
  labelKey: string | null
  enabled: boolean
  defaultEnabled: boolean
}

type CommandSettingsResponse = {
  configured?: boolean
  items?: CommandSettingsItem[]
  error?: string
}

const SETTINGS_CONTEXT_ID = 'workflows-command-settings'

/** The module a command belongs to is the first segment of its id. */
function moduleOf(commandId: string): string {
  const [moduleId] = commandId.split('.')
  return moduleId || commandId
}

function groupByModule(items: CommandSettingsItem[]): Array<[string, CommandSettingsItem[]]> {
  const groups = new Map<string, CommandSettingsItem[]>()
  for (const item of items) {
    const key = moduleOf(item.commandId)
    const bucket = groups.get(key)
    if (bucket) bucket.push(item)
    else groups.set(key, [item])
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))
}

/**
 * Tier 2 of the UPDATE_ENTITY model: tick which of the code-declared candidates
 * this tenant's workflows may execute.
 *
 * There is deliberately no free-text field here. An administrator who could
 * type a command id would reach commands nobody designed for unattended
 * execution, and a command that declares no `requiredFeatures` would have no
 * gate left at all — the tick-box list over a code-declared catalogue IS the
 * safety model.
 */
export function CommandSettingsPageClient() {
  const t = useT()
  const [items, setItems] = React.useState<CommandSettingsItem[] | null>(null)
  const [configured, setConfigured] = React.useState(true)
  const [enabled, setEnabled] = React.useState<Set<string>>(new Set())
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)

  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: SETTINGS_CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const applyResponse = React.useCallback((body: CommandSettingsResponse | null) => {
    const loaded = Array.isArray(body?.items) ? body.items : []
    setItems(loaded)
    setConfigured(body?.configured !== false)
    setEnabled(new Set(loaded.filter((item) => item.enabled).map((item) => item.commandId)))
  }, [])

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const body = await readApiResultOrThrow<CommandSettingsResponse>(
        '/api/workflows/command-settings',
        undefined,
        {
          errorMessage: t('workflows.commandSettings.loadError'),
          allowNullResult: true,
        },
      )
      applyResponse(body)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('workflows.commandSettings.loadError')
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [applyResponse, t])

  React.useEffect(() => {
    void load()
  }, [load])

  const toggle = React.useCallback((commandId: string, next: boolean) => {
    setEnabled((prev) => {
      const updated = new Set(prev)
      if (next) updated.add(commandId)
      else updated.delete(commandId)
      return updated
    })
  }, [])

  const handleSave = React.useCallback(async () => {
    setSaving(true)
    try {
      const enabledCommandIds = [...enabled]
      // optimistic-lock-exempt: tenant-scoped preference setting stored as a
      // single `module_configs` row. There is no loaded record version to lock
      // against, and the PUT replaces the whole set, so a concurrent
      // administrator's save is last-write-wins by design rather than a
      // field-level lost update.
      const response = await runMutation({
        operation: () =>
          apiCall<CommandSettingsResponse>('/api/workflows/command-settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabledCommandIds }),
          }),
        context: {
          formId: SETTINGS_CONTEXT_ID,
          resourceKind: 'workflows.commandSettings',
          retryLastMutation,
        },
        mutationPayload: { enabledCommandIds },
      })
      if (!response.ok) {
        throw new Error(response.result?.error || t('workflows.commandSettings.saveError'))
      }
      applyResponse(response.result ?? null)
      flash(t('workflows.commandSettings.saveSuccess'), 'success')
    } catch (err) {
      const message = err instanceof Error ? err.message : t('workflows.commandSettings.saveError')
      flash(message, 'error')
    } finally {
      setSaving(false)
    }
  }, [applyResponse, enabled, retryLastMutation, runMutation, t])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner size="sm" />
        {t('workflows.commandSettings.loading')}
      </div>
    )
  }

  if (error) {
    return (
      <ErrorMessage
        label={error}
        action={
          <Button type="button" variant="outline" onClick={() => void load()}>
            {t('workflows.commandSettings.retry')}
          </Button>
        }
      />
    )
  }

  const groups = groupByModule(items ?? [])

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('workflows.commandSettings.pageTitle')}</h1>
        <p className="text-muted-foreground text-sm">
          {t('workflows.commandSettings.pageDescription')}
        </p>
      </div>

      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('workflows.commandSettings.empty')}</p>
      ) : null}

      {groups.map(([moduleId, moduleItems]) => (
        <Card key={moduleId}>
          <CardHeader>
            <CardTitle className="font-mono">{moduleId}</CardTitle>
            <CardDescription>{t('workflows.commandSettings.groupDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {moduleItems.map((item) => (
              <CheckboxField
                key={item.commandId}
                checked={enabled.has(item.commandId)}
                onCheckedChange={(checked) => toggle(item.commandId, checked === true)}
                label={item.labelKey ? t(item.labelKey, item.commandId) : item.commandId}
                sublabel={<span className="font-mono text-xs">{item.commandId}</span>}
                description={
                  <span>
                    {t('workflows.commandSettings.requires')}{' '}
                    <span className="font-mono">{item.requiredFeatures.join(', ')}</span>
                  </span>
                }
              />
            ))}
          </CardContent>
        </Card>
      ))}

      {!configured && groups.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('workflows.commandSettings.notConfiguredHint')}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button type="button" onClick={handleSave} disabled={saving}>
          {saving ? t('workflows.commandSettings.saving') : t('workflows.commandSettings.save')}
        </Button>
      </div>
    </div>
  )
}
