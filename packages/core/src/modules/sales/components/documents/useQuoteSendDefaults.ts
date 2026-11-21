"use client"

import * as React from 'react'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { QuoteValiditySettings } from '../../data/validators'
import { DEFAULT_QUOTE_VALID_FOR_DAYS, normalizeQuoteValidityDays, resolveDefaultValidForDays } from '../../lib/quoteValidity'

export function useQuoteSendDefaults(documentId: string | null, validUntil: string | null | undefined) {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [sendOpen, setSendOpen] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [defaultDays, setDefaultDays] = React.useState(DEFAULT_QUOTE_VALID_FOR_DAYS)
  const [validForDays, setValidForDays] = React.useState(DEFAULT_QUOTE_VALID_FOR_DAYS)
  const requestVersion = React.useRef(0)
  const identity = `${scopeVersion}:${documentId ?? ''}`
  const currentIdentity = React.useRef(identity)
  currentIdentity.current = identity

  React.useEffect(() => {
    setSendOpen(false)
    setLoading(false)
    return () => { requestVersion.current += 1 }
  }, [identity])

  const openSendDialog = React.useCallback(async () => {
    if (!documentId) return
    const version = ++requestVersion.current
    setLoading(true)
    try {
      const settings = await readApiResultOrThrow<QuoteValiditySettings>(
        '/api/sales/settings/quote-validity', undefined,
        { errorMessage: t('sales.settings.errors.load_failed', 'Failed to load sales settings') },
      )
      if (version !== requestVersion.current || identity !== currentIdentity.current) return
      const days = normalizeQuoteValidityDays(settings.defaultQuoteValidityDays)
      setDefaultDays(days)
      setValidForDays(resolveDefaultValidForDays(validUntil, days))
      setSendOpen(true)
    } catch (error) {
      if (version === requestVersion.current && identity === currentIdentity.current) {
        getTelemetryRuntime()?.reportError(error, { module: 'sales', code: 'sales.quote_send_defaults_load_failed' })
        flash(t('sales.settings.errors.load_failed', 'Failed to load sales settings'), 'error')
      }
    } finally {
      if (version === requestVersion.current && identity === currentIdentity.current) setLoading(false)
    }
  }, [documentId, identity, t, validUntil])

  return { sendOpen, setSendOpen, loading, defaultDays, validForDays, setValidForDays, openSendDialog }
}
