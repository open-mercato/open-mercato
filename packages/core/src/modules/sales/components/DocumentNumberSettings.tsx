"use client"

import * as React from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  DOCUMENT_NUMBER_TOKENS,
  DEFAULT_ORDER_NUMBER_FORMAT,
  DEFAULT_QUOTE_NUMBER_FORMAT,
} from '../lib/documentNumberTokens'

type SettingsResponse = {
  orderNumberFormat: string
  quoteNumberFormat: string
  nextOrderNumber: number
  nextQuoteNumber: number
  tokens?: typeof DOCUMENT_NUMBER_TOKENS
}

type FormState = {
  orderNumberFormat: string
  quoteNumberFormat: string
  orderNextNumber: string
  quoteNextNumber: string
}

const DEFAULT_STATE: FormState = {
  orderNumberFormat: DEFAULT_ORDER_NUMBER_FORMAT,
  quoteNumberFormat: DEFAULT_QUOTE_NUMBER_FORMAT,
  orderNextNumber: '1',
  quoteNextNumber: '1',
}

const normalizeState = (payload?: Partial<SettingsResponse> | null): FormState => ({
  orderNumberFormat:
    typeof payload?.orderNumberFormat === 'string' && payload.orderNumberFormat.trim().length
      ? payload.orderNumberFormat
      : DEFAULT_ORDER_NUMBER_FORMAT,
  quoteNumberFormat:
    typeof payload?.quoteNumberFormat === 'string' && payload.quoteNumberFormat.trim().length
      ? payload.quoteNumberFormat
      : DEFAULT_QUOTE_NUMBER_FORMAT,
  orderNextNumber:
    typeof payload?.nextOrderNumber === 'number' && Number.isFinite(payload.nextOrderNumber)
      ? String(payload.nextOrderNumber)
      : '1',
  quoteNextNumber:
    typeof payload?.nextQuoteNumber === 'number' && Number.isFinite(payload.nextQuoteNumber)
      ? String(payload.nextQuoteNumber)
      : '1',
})

export function DocumentNumberSettings() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [formState, setFormState] = React.useState<FormState>(DEFAULT_STATE)
  const [loading, setLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [tokens, setTokens] = React.useState(DOCUMENT_NUMBER_TOKENS)

  const translations = React.useMemo(() => ({
    title: t('sales.config.numbering.title', 'Document numbers'),
    description: t(
      'sales.config.numbering.description',
      'Control how sales orders and quotes are numbered. Formats can include dates, sequences, and random fragments.'
    ),
    orderLabel: t('sales.config.numbering.orderFormat', 'Order number format'),
    quoteLabel: t('sales.config.numbering.quoteFormat', 'Quote number format'),
    orderNext: t('sales.config.numbering.orderNext', 'Next order sequence'),
    quoteNext: t('sales.config.numbering.quoteNext', 'Next quote sequence'),
    save: t('sales.config.numbering.actions.save', 'Save settings'),
    reset: t('sales.config.numbering.actions.reset', 'Reset changes'),
    refresh: t('sales.config.numbering.actions.refresh', 'Refresh'),
    refreshing: t('sales.config.numbering.actions.refreshing', 'Refreshing…'),
    tokensTitle: t('sales.config.numbering.tokensTitle', 'Available tokens'),
    tokensHint: t(
      'sales.config.numbering.tokensHint',
      'Combine tokens to shape your identifiers, e.g. ORDER/{yyyy}/{seq:5}.'
    ),
    errors: {
      load: t('sales.config.numbering.errors.load', 'Failed to load numbering settings.'),
      save: t('sales.config.numbering.errors.save', 'Failed to save numbering settings.'),
    },
    messages: {
      saved: t('sales.config.numbering.messages.saved', 'Numbering settings saved.'),
    },
  }), [t])

  const handleLoad = React.useCallback(async () => {
    setLoading(true)
    try {
      const call = await apiCall<SettingsResponse>('/api/sales/settings/document-numbers')
      if (call.ok) {
        setFormState(normalizeState(call.result))
        setTokens(Array.isArray(call.result?.tokens) && call.result.tokens.length ? call.result.tokens : DOCUMENT_NUMBER_TOKENS)
      } else {
        flash(translations.errors.load, 'error')
      }
    } catch (err) {
      console.error('sales.document-number-settings.load failed', err)
      flash(translations.errors.load, 'error')
    } finally {
      setLoading(false)
    }
  }, [translations.errors.load])

  React.useEffect(() => {
    void handleLoad()
  }, [handleLoad, scopeVersion])

  const handleChange = (key: keyof FormState) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setFormState((prev) => ({ ...prev, [key]: event.target.value }))
  }

  const handleSubmit = React.useCallback(async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      const payload = {
        orderNumberFormat: formState.orderNumberFormat.trim(),
        quoteNumberFormat: formState.quoteNumberFormat.trim(),
        orderNextNumber: Number.parseInt(formState.orderNextNumber, 10) || undefined,
        quoteNextNumber: Number.parseInt(formState.quoteNextNumber, 10) || undefined,
      }
      const call = await apiCall<SettingsResponse>('/api/sales/settings/document-numbers', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!call.ok) {
        flash(translations.errors.save, 'error')
        return
      }
      setFormState(normalizeState(call.result))
      setTokens(Array.isArray(call.result?.tokens) && call.result.tokens.length ? call.result.tokens : DOCUMENT_NUMBER_TOKENS)
      flash(translations.messages.saved, 'success')
    } catch (err) {
      console.error('sales.document-number-settings.save failed', err)
      flash(translations.errors.save, 'error')
    } finally {
      setSaving(false)
    }
  }, [formState.orderNextNumber, formState.orderNumberFormat, formState.quoteNextNumber, formState.quoteNumberFormat, translations.errors.save, translations.messages.saved])

  const handleReset = React.useCallback(() => {
    setFormState(DEFAULT_STATE)
    void handleLoad()
  }, [handleLoad])

  return (
    <section className="rounded-none border bg-card/30 p-5 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{translations.title}</h2>
          <p className="text-sm text-muted-foreground">{translations.description}</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="icon"
            type="button"
            className="rounded-none border-0 shadow-none hover:bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
            onClick={handleLoad}
            disabled={loading || saving}
            aria-label={translations.refresh}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="sr-only">{loading ? translations.refreshing : translations.refresh}</span>
          </Button>
        </div>
      </div>
      <form className="mt-4 space-y-5" onSubmit={handleSubmit}>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2">
            <div className="text-sm font-medium">{translations.orderLabel}</div>
            <Input
              value={formState.orderNumberFormat}
              onChange={handleChange('orderNumberFormat')}
              disabled={loading || saving}
              spellCheck={false}
            />
            <p className="text-xs text-muted-foreground">
              {t('sales.config.numbering.orderHint', 'Example: ORDER/{yyyy}/{seq:5}')}
            </p>
          </label>
          <label className="space-y-2">
            <div className="text-sm font-medium">{translations.quoteLabel}</div>
            <Input
              value={formState.quoteNumberFormat}
              onChange={handleChange('quoteNumberFormat')}
              disabled={loading || saving}
              spellCheck={false}
            />
            <p className="text-xs text-muted-foreground">
              {t('sales.config.numbering.quoteHint', 'Example: QUOTE/{yy}/{mm}/{seq:4}')}
            </p>
          </label>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2">
            <div className="text-sm font-medium">{translations.orderNext}</div>
            <Input
              type="number"
              min={1}
              value={formState.orderNextNumber}
              onChange={handleChange('orderNextNumber')}
              disabled={loading || saving}
            />
            <p className="text-xs text-muted-foreground">
              {t('sales.config.numbering.sequenceHint', 'Applied on the next generated number for this type.')}
            </p>
          </label>
          <label className="space-y-2">
            <div className="text-sm font-medium">{translations.quoteNext}</div>
            <Input
              type="number"
              min={1}
              value={formState.quoteNextNumber}
              onChange={handleChange('quoteNextNumber')}
              disabled={loading || saving}
            />
            <p className="text-xs text-muted-foreground">
              {t('sales.config.numbering.sequenceHintQuote', 'Resets the quote counter for the next document.')}
            </p>
          </label>
        </div>
        <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            {translations.tokensTitle}
            <span className="text-xs font-normal text-muted-foreground">{translations.tokensHint}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {tokens.map((entry) => (
              <div key={entry.token} className="flex items-center gap-2 rounded border bg-background px-2 py-1">
                <Badge variant="secondary" className="font-mono text-xs">
                  {entry.token}
                </Badge>
                <span className="text-xs text-muted-foreground">{entry.description}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={handleReset} disabled={loading || saving}>
            {translations.reset}
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? t('sales.config.numbering.actions.saving', 'Saving…') : translations.save}
          </Button>
        </div>
      </form>
    </section>
  )
}
