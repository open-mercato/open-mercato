"use client"

import * as React from 'react'
import { Copy, Trash2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { FormField } from '@open-mercato/ui/primitives/form-field'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { normalizeEmbedOrigin } from '../../../../../lib/embed-frame-policy'

type EmbedTheme = 'light' | 'dark' | 'auto'

type DistributionDetailResponse = {
  id: string
  publicSlug: string | null
  settings: Record<string, unknown> | null
}

function readEmbedFromSettings(settings: Record<string, unknown> | null): {
  enabled: boolean
  allowedDomains: string[]
  theme: EmbedTheme
  autoResize: boolean
} {
  const embed =
    settings && typeof settings === 'object' && !Array.isArray(settings)
      ? (settings as Record<string, unknown>).embed
      : undefined
  if (!embed || typeof embed !== 'object' || Array.isArray(embed)) {
    return { enabled: false, allowedDomains: [], theme: 'auto', autoResize: true }
  }
  const record = embed as Record<string, unknown>
  const theme = record.theme
  return {
    enabled: record.enabled === true,
    allowedDomains: Array.isArray(record.allowedDomains)
      ? record.allowedDomains.filter((entry): entry is string => typeof entry === 'string')
      : [],
    theme: theme === 'light' || theme === 'dark' ? theme : 'auto',
    autoResize: record.autoResize !== false,
  }
}

function embedSnippet(slug: string | null): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const safeSlug = slug ?? 'YOUR-SLUG'
  return [
    `<script src="${origin}/api/forms/public/embed-loader" async></script>`,
    `<div data-om-form="${safeSlug}"></div>`,
  ].join('\n')
}

export function EmbedSettingsDialog({
  distributionId,
  publicSlug,
  onClose,
  onSaved,
}: {
  distributionId: string
  publicSlug: string | null
  onClose: () => void
  onSaved: () => void
}) {
  const t = useT()
  const { runMutation } = useGuardedMutation({ contextId: 'forms.distribution.embed' })

  const [loading, setLoading] = React.useState(true)
  const [submitting, setSubmitting] = React.useState(false)
  const [baseSettings, setBaseSettings] = React.useState<Record<string, unknown> | null>(null)
  const [enabled, setEnabled] = React.useState(false)
  const [domains, setDomains] = React.useState<string[]>([])
  const [theme, setTheme] = React.useState<EmbedTheme>('auto')
  const [autoResize, setAutoResize] = React.useState(true)
  const [domainDraft, setDomainDraft] = React.useState('')

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const resp = await apiCall<DistributionDetailResponse>(
          `/api/forms/distributions/${encodeURIComponent(distributionId)}`,
        )
        if (cancelled) return
        if (!resp.ok || !resp.result) {
          flash('forms.distribution.errors.load', 'error')
          onClose()
          return
        }
        setBaseSettings(resp.result.settings ?? null)
        const embed = readEmbedFromSettings(resp.result.settings ?? null)
        setEnabled(embed.enabled)
        setDomains(embed.allowedDomains)
        setTheme(embed.theme)
        setAutoResize(embed.autoResize)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [distributionId, onClose])

  const addDomain = React.useCallback(() => {
    const normalized = normalizeEmbedOrigin(domainDraft)
    if (!normalized) {
      flash('forms.distribution.embed.domain_invalid', 'error')
      return
    }
    setDomains((current) => (current.includes(normalized) ? current : [...current, normalized]))
    setDomainDraft('')
  }, [domainDraft])

  const removeDomain = React.useCallback((value: string) => {
    setDomains((current) => current.filter((entry) => entry !== value))
  }, [])

  const handleSubmit = React.useCallback(async () => {
    if (submitting || loading) return
    if (enabled && domains.length === 0) {
      flash('forms.distribution.embed.allowlist_required', 'error')
      return
    }
    const nextSettings: Record<string, unknown> = { ...(baseSettings ?? {}) }
    nextSettings.embed = { enabled, allowedDomains: domains, theme, autoResize }
    const body = { settings: nextSettings }

    setSubmitting(true)
    try {
      await runMutation({
        operation: async () => {
          const resp = await apiCall(`/api/forms/distributions/${encodeURIComponent(distributionId)}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })
          if (!resp.ok) {
            flash('forms.distribution.embed.save_failed', 'error')
            throw new Error('forms.distribution.embed.save_failed')
          }
          flash('forms.distribution.embed.save_success', 'success')
          onSaved()
        },
        context: { distributionId },
        mutationPayload: { distributionId, ...body },
      })
    } catch {
      // flash already surfaced; keep dialog open for correction
    } finally {
      setSubmitting(false)
    }
  }, [autoResize, baseSettings, distributionId, domains, enabled, loading, onSaved, runMutation, submitting, theme])

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        void handleSubmit()
      }
    },
    [handleSubmit],
  )

  const copySnippet = React.useCallback(async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(embedSnippet(publicSlug))
        flash('forms.distribution.copy.success', 'success')
        return
      }
    } catch {
      // fall through
    }
    flash('forms.distribution.copy.failed', 'error')
  }, [publicSlug])

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-lg" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{t('forms.distribution.embed.title', { fallback: 'Website embed' })}</DialogTitle>
          <DialogDescription>
            {t('forms.distribution.embed.subtitle', {
              fallback: 'Allow this open distribution to be embedded on specific external websites.',
            })}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Spinner className="h-5 w-5" />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-sm font-medium text-foreground">
                  {t('forms.distribution.embed.enabled_label', { fallback: 'Enable embedding' })}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t('forms.distribution.embed.enabled_help', {
                    fallback: 'Off by default. Requires at least one allowed domain.',
                  })}
                </span>
              </div>
              <Switch checked={enabled} onCheckedChange={setEnabled} />
            </div>

            <FormField label={t('forms.distribution.embed.domains_label', { fallback: 'Allowed domains' })}>
              <div className="flex gap-2">
                <Input
                  value={domainDraft}
                  placeholder="https://www.acme.com"
                  onChange={(event) => setDomainDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      addDomain()
                    }
                  }}
                />
                <Button type="button" variant="secondary" onClick={addDomain}>
                  {t('forms.distribution.embed.domain_add', { fallback: 'Add' })}
                </Button>
              </div>
              {domains.length === 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  {t('forms.distribution.embed.domains_empty', {
                    fallback: 'No domains yet. Only https origins (http allowed for localhost).',
                  })}
                </p>
              ) : (
                <ul className="mt-2 flex flex-col gap-1">
                  {domains.map((domain) => (
                    <li
                      key={domain}
                      className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-2 py-1"
                    >
                      <span className="font-mono text-xs text-foreground">{domain}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeDomain(domain)}
                        aria-label={t('forms.distribution.embed.domain_remove', { fallback: 'Remove domain' })}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </FormField>

            <FormField label={t('forms.distribution.embed.theme_label', { fallback: 'Theme' })}>
              <Select value={theme} onValueChange={(value) => setTheme(value as EmbedTheme)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">{t('forms.distribution.embed.theme_auto', { fallback: 'Auto' })}</SelectItem>
                  <SelectItem value="light">{t('forms.distribution.embed.theme_light', { fallback: 'Light' })}</SelectItem>
                  <SelectItem value="dark">{t('forms.distribution.embed.theme_dark', { fallback: 'Dark' })}</SelectItem>
                </SelectContent>
              </Select>
            </FormField>

            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">
                {t('forms.distribution.embed.auto_resize_label', { fallback: 'Auto-resize iframe' })}
              </span>
              <Switch checked={autoResize} onCheckedChange={setAutoResize} />
            </div>

            <FormField label={t('forms.distribution.embed.snippet_label', { fallback: 'Embed snippet' })}>
              <pre className="overflow-x-auto rounded-md border border-border bg-muted/40 p-2 text-xs text-foreground">
                {embedSnippet(publicSlug)}
              </pre>
              <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={copySnippet}>
                <Copy className="mr-1 h-4 w-4" aria-hidden="true" />
                {t('forms.distribution.embed.snippet_copy', { fallback: 'Copy snippet' })}
              </Button>
            </FormField>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
            {t('forms.actions.cancel', { fallback: 'Cancel' })}
          </Button>
          <Button type="button" onClick={() => void handleSubmit()} disabled={submitting || loading}>
            {t('forms.actions.save', { fallback: 'Save' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
