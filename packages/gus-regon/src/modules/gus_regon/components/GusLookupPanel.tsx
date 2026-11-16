'use client'

import * as React from 'react'
import { Search } from 'lucide-react'
import { Input } from '@open-mercato/ui/primitives/input'
import { Button } from '@open-mercato/ui/primitives/button'
import { Label } from '@open-mercato/ui/primitives/label'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { isValidNip, normalizeNip } from '../lib/nip'
import type { GusCompany, GusLookupResult } from '../lib/types'

type LookupState = 'idle' | 'searching' | 'not_found' | 'unavailable' | 'not_configured'

export type GusLookupPanelProps = {
  /** Pre-fills the NIP input (e.g. from the host form's tax id field). */
  initialNip?: string
  disabled?: boolean
  /** Called with the primary company (and all candidates) after a successful lookup. */
  onCompany: (company: GusCompany, candidates: GusCompany[]) => void
  /** Optional DOM id prefix when several panels render on one page. */
  idPrefix?: string
}

/**
 * Reusable NIP input + "Fetch from GUS" button.
 *
 * Exported so any host form (e.g. a purchasing supplier form in an app
 * module) can embed the lookup and map the result onto its own fields.
 */
export function GusLookupPanel({ initialNip = '', disabled = false, onCompany, idPrefix = 'gus_regon' }: GusLookupPanelProps) {
  const t = useT()
  const [nip, setNip] = React.useState(initialNip)
  const [state, setState] = React.useState<LookupState>('idle')
  const [touched, setTouched] = React.useState(false)
  const [found, setFound] = React.useState<GusCompany | null>(null)

  React.useEffect(() => {
    if (!touched && initialNip) setNip(initialNip)
  }, [initialNip, touched])

  const digits = normalizeNip(nip)
  const nipValid = isValidNip(digits)
  const showInvalid = touched && digits.length > 0 && !nipValid
  const busy = state === 'searching'

  const runLookup = React.useCallback(async () => {
    if (busy || !nipValid) return
    setState('searching')
    setFound(null)
    try {
      const res = await apiCall<GusLookupResult>(`/api/gus_regon/lookup?nip=${encodeURIComponent(digits)}`)
      const result = res.result
      if (res.ok && result?.ok === true) {
        setFound(result.company)
        onCompany(result.company, result.candidates)
        setState('idle')
        return
      }
      const reason = res.ok && result?.ok === false && typeof result.reason === 'string' ? result.reason : 'unavailable'
      setState(reason)
    } catch {
      setState('unavailable')
    }
  }, [busy, digits, nipValid, onCompany])

  const inputId = `${idPrefix}-nip`
  const message =
    state === 'not_found'
      ? t('gus_regon.lookup.notFound', 'No company with this NIP was found in GUS REGON.')
      : state === 'unavailable'
        ? t('gus_regon.lookup.unavailable', 'GUS REGON is unavailable right now. Fill the fields manually or try again later.')
        : state === 'not_configured'
          ? t('gus_regon.lookup.notConfigured', 'GUS REGON integration is not enabled. Configure it in Settings → Integrations.')
          : null

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <Label htmlFor={inputId}>{t('gus_regon.lookup.nip.label', 'NIP')}</Label>
        <div className="flex items-start gap-2">
          <Input
            id={inputId}
            inputMode="numeric"
            autoComplete="off"
            value={nip}
            disabled={disabled || busy}
            placeholder={t('gus_regon.lookup.nip.placeholder', 'e.g. 5252344078')}
            aria-invalid={showInvalid || undefined}
            onChange={(event) => {
              setNip(event.target.value)
              setTouched(true)
              setFound(null)
              if (state !== 'searching') setState('idle')
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
                event.preventDefault()
                void runLookup()
              }
            }}
          />
          <Button type="button" variant="outline" disabled={disabled || busy || !nipValid} onClick={() => void runLookup()}>
            {busy ? <Spinner size="sm" /> : <Search aria-hidden="true" />}
            {busy
              ? t('gus_regon.lookup.searching', 'Searching…')
              : t('gus_regon.lookup.action', 'Fetch from GUS')}
          </Button>
        </div>
        {showInvalid ? (
          <p className="text-xs text-status-error-text" role="alert">
            {t('gus_regon.lookup.invalidNip', 'This NIP is invalid (checksum failed).')}
          </p>
        ) : null}
      </div>
      {found ? (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {t('gus_regon.lookup.found', 'Found: {name} · REGON {regon}', {
            name: found.name ?? found.nip,
            regon: found.regon ?? '—',
          })}
        </p>
      ) : null}
      {message ? (
        <Alert status={state === 'not_found' ? 'information' : 'warning'} size="sm">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}

export default GusLookupPanel
