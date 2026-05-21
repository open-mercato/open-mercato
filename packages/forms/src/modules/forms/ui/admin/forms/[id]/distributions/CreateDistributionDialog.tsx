"use client"

import * as React from 'react'
import { Copy } from 'lucide-react'
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
import { Kbd, KbdShortcut } from '@open-mercato/ui/primitives/kbd'
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
import type { DistributionMode } from './DistributionsPanel'

type CreateResponse = {
  id: string
}

type DistributionDetailResponse = {
  id: string
  publicSlug: string | null
}

function toIsoOrNull(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

function publicLinkFor(slug: string | null): string | null {
  if (!slug) return null
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}/f/${slug}`
}

export function CreateDistributionDialog({
  formId,
  onClose,
  onCreated,
}: {
  formId: string
  onClose: () => void
  onCreated: () => void
}) {
  const t = useT()
  const { runMutation } = useGuardedMutation({ contextId: 'forms.distribution.create' })

  const [mode, setMode] = React.useState<DistributionMode>('open')
  const [title, setTitle] = React.useState('')
  const [defaultLocale, setDefaultLocale] = React.useState('en')
  const [requireCustomerAuth, setRequireCustomerAuth] = React.useState(false)
  const [allowMultipleSubmissions, setAllowMultipleSubmissions] = React.useState(false)
  const [maxResponses, setMaxResponses] = React.useState('')
  const [opensAt, setOpensAt] = React.useState('')
  const [closesAt, setClosesAt] = React.useState('')
  const [redirectUrl, setRedirectUrl] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const [createdLink, setCreatedLink] = React.useState<string | null>(null)

  const handleSubmit = React.useCallback(async () => {
    if (submitting) return
    const trimmedLocale = defaultLocale.trim()
    if (!trimmedLocale) {
      flash('forms.distribution.errors.locale_required', 'error')
      return
    }
    const parsedMax = maxResponses.trim() ? Number.parseInt(maxResponses.trim(), 10) : null
    if (parsedMax != null && (!Number.isFinite(parsedMax) || parsedMax <= 0)) {
      flash('forms.distribution.errors.max_invalid', 'error')
      return
    }
    const body = {
      mode,
      title: title.trim() ? title.trim() : null,
      defaultLocale: trimmedLocale,
      requireCustomerAuth,
      allowMultipleSubmissions,
      maxResponses: parsedMax,
      opensAt: toIsoOrNull(opensAt),
      closesAt: toIsoOrNull(closesAt),
      redirectUrl: redirectUrl.trim() ? redirectUrl.trim() : null,
    }

    setSubmitting(true)
    try {
      await runMutation({
        operation: async () => {
          const resp = await apiCall<CreateResponse>(
            `/api/forms/${encodeURIComponent(formId)}/distributions`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            },
          )
          if (!resp.ok || !resp.result?.id) {
            flash('forms.distribution.create.failed', 'error')
            throw new Error('forms.distribution.create.failed')
          }
          flash('forms.distribution.create.success', 'success')
          if (mode === 'open') {
            const detail = await apiCall<DistributionDetailResponse>(
              `/api/forms/distributions/${encodeURIComponent(resp.result.id)}`,
            )
            const link = detail.ok ? publicLinkFor(detail.result?.publicSlug ?? null) : null
            if (link) {
              setCreatedLink(link)
              onCreated()
              return
            }
          }
          onCreated()
        },
        context: { formId, mode },
        mutationPayload: { ...body, formId },
      })
    } catch {
      // flash already surfaced; keep dialog open for correction
    } finally {
      setSubmitting(false)
    }
  }, [
    allowMultipleSubmissions,
    closesAt,
    defaultLocale,
    formId,
    maxResponses,
    mode,
    onCreated,
    opensAt,
    redirectUrl,
    requireCustomerAuth,
    runMutation,
    submitting,
    title,
  ])

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        void handleSubmit()
      }
    },
    [handleSubmit],
  )

  const handleCopyLink = React.useCallback(async () => {
    if (!createdLink) return
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(createdLink)
        flash('forms.distribution.copy.success', 'success')
        return
      }
    } catch {
      // fall through to error flash
    }
    flash('forms.distribution.copy.failed', 'error')
  }, [createdLink])

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-lg" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>
            {t('forms.distribution.create.title', { fallback: 'New distribution' })}
          </DialogTitle>
          <DialogDescription>
            {t('forms.distribution.create.subtitle', {
              fallback: 'Share a public link or invite named recipients to fill this form.',
            })}
          </DialogDescription>
        </DialogHeader>

        {createdLink ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-foreground">
              {t('forms.distribution.create.link_ready', {
                fallback: 'Distribution created. Share this public link:',
              })}
            </p>
            <div className="flex items-center gap-2">
              <Input value={createdLink} readOnly className="font-mono text-xs" />
              <Button type="button" variant="outline" size="default" onClick={handleCopyLink}>
                <Copy className="mr-1 h-4 w-4" aria-hidden="true" />
                {t('forms.distribution.copy.action', { fallback: 'Copy link' })}
              </Button>
            </div>
            <DialogFooter>
              <Button type="button" size="default" onClick={onClose}>
                {t('forms.distribution.create.done', { fallback: 'Done' })}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <FormField label={t('forms.distribution.fields.mode', { fallback: 'Mode' })} required>
              <Select value={mode} onValueChange={(value) => setMode(value as DistributionMode)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">
                    {t('forms.distribution.mode.open', { fallback: 'Open link' })}
                  </SelectItem>
                  <SelectItem value="personal">
                    {t('forms.distribution.mode.personal', { fallback: 'Personal invitations' })}
                  </SelectItem>
                </SelectContent>
              </Select>
            </FormField>

            <FormField label={t('forms.distribution.fields.title', { fallback: 'Title' })}>
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={t('forms.distribution.fields.title_placeholder', {
                  fallback: 'Internal label (optional)',
                })}
              />
            </FormField>

            <FormField
              label={t('forms.distribution.fields.default_locale', { fallback: 'Default locale' })}
              required
            >
              <Input
                value={defaultLocale}
                onChange={(event) => setDefaultLocale(event.target.value)}
                placeholder="en"
              />
            </FormField>

            <FormField
              label={t('forms.distribution.fields.max_responses', { fallback: 'Max responses' })}
              description={t('forms.distribution.fields.max_responses_help', {
                fallback: 'Leave empty for unlimited.',
              })}
            >
              <Input
                type="number"
                min={1}
                value={maxResponses}
                onChange={(event) => setMaxResponses(event.target.value)}
              />
            </FormField>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label={t('forms.distribution.fields.opens_at', { fallback: 'Opens at' })}>
                <Input
                  type="datetime-local"
                  value={opensAt}
                  onChange={(event) => setOpensAt(event.target.value)}
                />
              </FormField>
              <FormField label={t('forms.distribution.fields.closes_at', { fallback: 'Closes at' })}>
                <Input
                  type="datetime-local"
                  value={closesAt}
                  onChange={(event) => setClosesAt(event.target.value)}
                />
              </FormField>
            </div>

            <FormField
              label={t('forms.distribution.fields.redirect_url', { fallback: 'Redirect URL' })}
              description={t('forms.distribution.fields.redirect_url_help', {
                fallback: 'Where to send the respondent after submitting (optional).',
              })}
            >
              <Input
                type="url"
                value={redirectUrl}
                onChange={(event) => setRedirectUrl(event.target.value)}
                placeholder="https://"
              />
            </FormField>

            <FormField
              label={t('forms.distribution.fields.require_customer_auth', {
                fallback: 'Require customer sign-in',
              })}
              orientation="horizontal"
            >
              <Switch
                checked={requireCustomerAuth}
                onCheckedChange={setRequireCustomerAuth}
                aria-label={t('forms.distribution.fields.require_customer_auth', {
                  fallback: 'Require customer sign-in',
                })}
              />
            </FormField>

            <FormField
              label={t('forms.distribution.fields.allow_multiple', {
                fallback: 'Allow multiple submissions',
              })}
              orientation="horizontal"
            >
              <Switch
                checked={allowMultipleSubmissions}
                onCheckedChange={setAllowMultipleSubmissions}
                aria-label={t('forms.distribution.fields.allow_multiple', {
                  fallback: 'Allow multiple submissions',
                })}
              />
            </FormField>

            <DialogFooter className="items-center">
              <span className="mr-auto hidden text-xs text-muted-foreground sm:inline-flex sm:items-center sm:gap-1">
                {t('forms.distribution.create.hint', { fallback: 'Press' })}{' '}
                <KbdShortcut keys={['⌘', 'Enter']} />{' '}
                {t('forms.distribution.create.hint_save', { fallback: 'to save,' })}{' '}
                <Kbd>Esc</Kbd>{' '}
                {t('forms.distribution.create.hint_cancel', { fallback: 'to cancel' })}
              </span>
              <Button type="button" variant="ghost" size="default" onClick={onClose}>
                {t('forms.distribution.create.cancel', { fallback: 'Cancel' })}
              </Button>
              <Button type="button" size="default" disabled={submitting} onClick={handleSubmit}>
                {t('forms.distribution.create.submit', { fallback: 'Create distribution' })}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
