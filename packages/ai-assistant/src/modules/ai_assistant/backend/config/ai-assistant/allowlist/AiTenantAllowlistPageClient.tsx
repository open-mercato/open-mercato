'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Save, Shield, Trash2, Info, AlertCircle, ShieldCheck } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { Label } from '@open-mercato/ui/primitives/label'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

type EnvAllowlistConfig = {
  providers: string[] | null
  modelsByProvider: Record<string, string[]>
  hasRestrictions: boolean
}

type TenantAllowlist = {
  allowedProviders: string[] | null
  allowedModelsByProvider: Record<string, string[]>
}

type EffectiveAllowlist = {
  providers: string[] | null
  modelsByProvider: Record<string, string[]>
  hasRestrictions: boolean
  tenantOverridesActive: boolean
}

type ProviderEntry = {
  id: string
  name: string
  defaultModel: string
  envKey: string | null
  configured: boolean
  defaultModels: Array<{ id: string; name: string; contextWindow?: number; tags?: string[] }>
}

type SettingsResponse = {
  availableProviders: ProviderEntry[]
  allowlistProviders?: ProviderEntry[]
  allowlist: EnvAllowlistConfig
  tenantAllowlist: TenantAllowlist | null
  effectiveAllowlist: EffectiveAllowlist
}

async function fetchSettings(): Promise<SettingsResponse> {
  const { result, status } = await apiCallOrThrow<SettingsResponse>(
    '/api/ai_assistant/settings',
    { method: 'GET', credentials: 'include' },
    { errorMessage: 'Failed to load AI settings' },
  )
  if (!result) throw new Error(`Failed to load settings (${status})`)
  return result
}

type EditState = {
  /** null = "no tenant restriction (inherit env)"; array = explicit tenant pick */
  allowedProviders: string[] | null
  allowedModelsByProvider: Record<string, string[]>
}

function snapshotToEditState(snapshot: TenantAllowlist | null): EditState {
  return {
    allowedProviders: snapshot?.allowedProviders ?? null,
    allowedModelsByProvider: { ...(snapshot?.allowedModelsByProvider ?? {}) },
  }
}

export function AiTenantAllowlistPageClient(): React.JSX.Element {
  const t = useT()
  const queryClient = useQueryClient()
  const settingsQuery = useQuery({ queryKey: ['ai_assistant', 'settings'], queryFn: fetchSettings, staleTime: 0 })

  const [editState, setEditState] = React.useState<EditState>({
    allowedProviders: null,
    allowedModelsByProvider: {},
  })
  const [dirty, setDirty] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [clearing, setClearing] = React.useState(false)
  const [feedback, setFeedback] = React.useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  React.useEffect(() => {
    if (settingsQuery.data) {
      setEditState(snapshotToEditState(settingsQuery.data.tenantAllowlist))
      setDirty(false)
    }
  }, [settingsQuery.data])

  if (settingsQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 py-8 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('ai_assistant.allowlist.loading', 'Loading allowlist…')}
      </div>
    )
  }

  if (settingsQuery.isError || !settingsQuery.data) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>{t('ai_assistant.allowlist.loadError.title', 'Failed to load allowlist')}</AlertTitle>
        <AlertDescription>
          {settingsQuery.error instanceof Error
            ? settingsQuery.error.message
            : t('ai_assistant.allowlist.loadError.body', 'Try refreshing the page.')}
        </AlertDescription>
      </Alert>
    )
  }

  const settings = settingsQuery.data
  const envAllowedProviders = settings.allowlist.providers
  const envModelsByProvider = settings.allowlist.modelsByProvider

  // Provider universe to render: env-allowed providers (or all configured if env unset).
  const editableProviders = settings.allowlistProviders ?? settings.availableProviders
  const candidateProviders = editableProviders.filter((p) => {
    if (envAllowedProviders === null) return true
    return envAllowedProviders.some((id) => id.toLowerCase() === p.id.toLowerCase())
  })

  const tenantPickedProviders = editState.allowedProviders
  const isProviderEnabled = (id: string): boolean => {
    if (tenantPickedProviders === null) return true
    return tenantPickedProviders.includes(id)
  }

  const toggleProvider = (id: string, next: boolean): void => {
    setDirty(true)
    setFeedback(null)
    setEditState((prev) => {
      const current = prev.allowedProviders
      if (next) {
        const list = current === null ? [id] : Array.from(new Set([...current, id]))
        return { ...prev, allowedProviders: list }
      }
      const list = current === null
        ? candidateProviders.map((p) => p.id).filter((pid) => pid !== id)
        : current.filter((pid) => pid !== id)
      return { ...prev, allowedProviders: list }
    })
  }

  const isModelEnabled = (providerId: string, modelId: string): boolean => {
    const list = editState.allowedModelsByProvider[providerId]
    if (list === undefined) return true
    return list.includes(modelId)
  }

  const toggleModel = (providerId: string, modelId: string, next: boolean): void => {
    setDirty(true)
    setFeedback(null)
    const provider = candidateProviders.find((p) => p.id === providerId)
    const allModelIds = provider?.defaultModels.map((m) => m.id) ?? []
    setEditState((prev) => {
      const current = prev.allowedModelsByProvider[providerId]
      const allowedModelsByProvider = { ...prev.allowedModelsByProvider }
      if (next) {
        const list = current === undefined ? [modelId] : Array.from(new Set([...current, modelId]))
        allowedModelsByProvider[providerId] = list
      } else {
        const baseline = current === undefined ? allModelIds : current
        const list = baseline.filter((id) => id !== modelId)
        allowedModelsByProvider[providerId] = list
      }
      return { ...prev, allowedModelsByProvider }
    })
  }

  const resetTenantPicks = (): void => {
    setDirty(true)
    setFeedback(null)
    setEditState({ allowedProviders: null, allowedModelsByProvider: {} })
  }

  const handleSave = async (): Promise<void> => {
    setSaving(true)
    setFeedback(null)
    try {
      const { ok, status, result } = await apiCall<{ error?: string; code?: string }>(
        '/api/ai_assistant/settings/allowlist',
        {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            allowedProviders: editState.allowedProviders,
            allowedModelsByProvider: editState.allowedModelsByProvider,
          }),
        },
      )
      if (!ok) {
        setFeedback({
          kind: 'error',
          text: result?.error ?? t('ai_assistant.allowlist.save.error', `Save failed (${status})`),
        })
        return
      }
      setFeedback({
        kind: 'ok',
        text: t('ai_assistant.allowlist.save.success', 'Allowlist saved.'),
      })
      setDirty(false)
      await queryClient.invalidateQueries({ queryKey: ['ai_assistant', 'settings'] })
    } finally {
      setSaving(false)
    }
  }

  const handleClear = async (): Promise<void> => {
    setClearing(true)
    setFeedback(null)
    try {
      const { ok, status, result } = await apiCall<{ error?: string; cleared?: boolean }>(
        '/api/ai_assistant/settings/allowlist',
        { method: 'DELETE', credentials: 'include' },
      )
      if (!ok) {
        setFeedback({
          kind: 'error',
          text: result?.error ?? t('ai_assistant.allowlist.clear.error', `Clear failed (${status})`),
        })
        return
      }
      setFeedback({
        kind: 'ok',
        text: t('ai_assistant.allowlist.clear.success', 'Tenant allowlist cleared. Env-only enforcement applies.'),
      })
      setDirty(false)
      await queryClient.invalidateQueries({ queryKey: ['ai_assistant', 'settings'] })
    } finally {
      setClearing(false)
    }
  }

  const envBanner = envAllowedProviders === null && Object.keys(envModelsByProvider).length === 0
    ? null
    : (
      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>{t('ai_assistant.allowlist.envBanner.title', 'Env allowlist is in effect')}</AlertTitle>
        <AlertDescription className="space-y-1">
          {envAllowedProviders ? (
            <div>
              {t('ai_assistant.allowlist.envBanner.providers', 'OM_AI_AVAILABLE_PROVIDERS')}: <code className="font-mono text-xs">{envAllowedProviders.join(', ')}</code>
            </div>
          ) : null}
          {Object.keys(envModelsByProvider).map((pid) => (
            <div key={pid}>
              <code className="font-mono text-xs">OM_AI_AVAILABLE_MODELS_{pid.toUpperCase()}</code>: {envModelsByProvider[pid].join(', ')}
            </div>
          ))}
          <p className="text-xs text-muted-foreground mt-1">
            {t('ai_assistant.allowlist.envBanner.note', 'Tenant picks may not widen the env list — values outside it are hidden.')}
          </p>
        </AlertDescription>
      </Alert>
    )

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Shield className="h-6 w-6" />
          {t('ai_assistant.allowlist.title', 'AI provider & model allowlist')}
        </h1>
        <p className="text-muted-foreground">
          {t(
            'ai_assistant.allowlist.subtitle',
            'Limit which providers and models the runtime, settings, and chat picker may use for this tenant. The env allowlist is the outer constraint — tenant picks narrow it further.',
          )}
        </p>
      </div>

      {envBanner}

      {feedback ? (
        <Alert variant={feedback.kind === 'error' ? 'destructive' : undefined}>
          {feedback.kind === 'error' ? <AlertCircle className="h-4 w-4" /> : <Info className="h-4 w-4" />}
          <AlertDescription>{feedback.text}</AlertDescription>
        </Alert>
      ) : null}

      <div className="rounded-lg border bg-card p-6 space-y-6">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">{t('ai_assistant.allowlist.providers.title', 'Providers')}</h2>
            <p className="text-sm text-muted-foreground">
              {t(
                'ai_assistant.allowlist.providers.help',
                'Untick to forbid the runtime from using a provider for this tenant. Tick all to inherit the env allowlist.',
              )}
            </p>
          </div>
          <span
            className={
              settings.effectiveAllowlist.tenantOverridesActive
                ? 'inline-flex size-8 items-center justify-center rounded-md text-status-success-icon'
                : 'inline-flex size-8 items-center justify-center rounded-md text-status-warning-icon'
            }
            role="img"
            aria-label={
              settings.effectiveAllowlist.tenantOverridesActive
                ? t('ai_assistant.allowlist.badge.active', 'Tenant rules active')
                : t('ai_assistant.allowlist.badge.envOnly', 'Env-only')
            }
            title={
              settings.effectiveAllowlist.tenantOverridesActive
                ? t('ai_assistant.allowlist.badge.active', 'Tenant rules active')
                : t('ai_assistant.allowlist.badge.envOnly', 'Env-only')
            }
          >
            {settings.effectiveAllowlist.tenantOverridesActive ? (
              <ShieldCheck className="size-5" aria-hidden />
            ) : (
              <Shield className="size-5" aria-hidden />
            )}
          </span>
        </div>

        {candidateProviders.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('ai_assistant.allowlist.providers.empty', 'No configured providers within the env allowlist.')}
          </p>
        ) : (
          <div className="space-y-4">
            {candidateProviders.map((provider) => {
              const enabled = isProviderEnabled(provider.id)
              const envModels = envModelsByProvider[provider.id]
              const candidateModels = envModels
                ? provider.defaultModels.filter((m) => envModels.includes(m.id))
                : provider.defaultModels
              return (
                <div key={provider.id} className="rounded-md border p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <Checkbox
                        id={`provider-${provider.id}`}
                        checked={enabled}
                        onCheckedChange={(value) => toggleProvider(provider.id, value === true)}
                      />
                      <Label htmlFor={`provider-${provider.id}`} className="font-medium">
                        {provider.name}
                      </Label>
                      {provider.configured ? (
                        <Badge variant="outline" className="text-xs">
                          {t('ai_assistant.allowlist.providers.configured', 'configured')}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs text-muted-foreground">
                          {t('ai_assistant.allowlist.providers.notConfigured', 'not configured')}
                        </Badge>
                      )}
                    </div>
                  </div>

                  {enabled && candidateModels.length > 0 ? (
                    <div className="ml-7 space-y-2">
                      <div className="text-xs text-muted-foreground">
                        {t('ai_assistant.allowlist.models.help', 'Tick the models tenants may pick. Empty = no model restriction (inherit env).')}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {candidateModels.map((model) => {
                          const checked = isModelEnabled(provider.id, model.id)
                          return (
                            <label
                              key={`${provider.id}-${model.id}`}
                              className="flex items-center gap-2 text-sm"
                            >
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(value) => toggleModel(provider.id, model.id, value === true)}
                              />
                              <span className="font-mono text-xs">{model.id}</span>
                              {model.id === provider.defaultModel ? (
                                <Badge variant="outline" className="text-[10px]">
                                  {t('ai_assistant.allowlist.models.default', 'default')}
                                </Badge>
                              ) : null}
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void handleSave()} disabled={!dirty || saving} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {t('ai_assistant.allowlist.actions.save', 'Save allowlist')}
        </Button>
        <Button
          variant="outline"
          onClick={resetTenantPicks}
          disabled={saving || clearing}
          className="gap-2"
        >
          {t('ai_assistant.allowlist.actions.reset', 'Reset to env defaults')}
        </Button>
        <Button
          variant="ghost"
          onClick={() => void handleClear()}
          disabled={clearing || saving || !settings.tenantAllowlist}
          className="gap-2"
        >
          {clearing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          {t('ai_assistant.allowlist.actions.clearStored', 'Clear stored allowlist')}
        </Button>
      </div>
    </div>
  )
}

export default AiTenantAllowlistPageClient
