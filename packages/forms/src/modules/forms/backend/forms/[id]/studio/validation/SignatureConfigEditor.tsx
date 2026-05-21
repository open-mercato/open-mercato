'use client'

import * as React from 'react'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { CheckboxField } from '@open-mercato/ui/primitives/checkbox-field'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type SignatureMode = 'drawn' | 'typed'

export type SignatureConfigEditorProps = {
  /** Active studio locale — the consent clause is authored per-locale (W7). */
  locale: string
  clause: string
  modes: SignatureMode[]
  onClauseChange: (next: string | null) => void
  onModesChange: (next: SignatureMode[]) => void
}

const ALL_MODES: SignatureMode[] = ['drawn', 'typed']

export function SignatureConfigEditor({
  locale,
  clause,
  modes,
  onClauseChange,
  onModesChange,
}: SignatureConfigEditorProps) {
  const t = useT()
  const enabled = new Set<SignatureMode>(modes.length > 0 ? modes : ALL_MODES)

  const toggleMode = (mode: SignatureMode, checked: boolean) => {
    const next = new Set(enabled)
    if (checked) next.add(mode)
    else next.delete(mode)
    // Never let the author disable every mode — fall back to both.
    const result = ALL_MODES.filter((entry) => next.has(entry))
    onModesChange(result.length > 0 ? result : ALL_MODES)
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <label className="block text-xs font-medium text-muted-foreground">
          {t('forms.studio.signature.clause.label', { fallback: 'Consent statement' })}
          <span className="ml-1 uppercase">{locale}</span>
        </label>
        <Textarea
          rows={4}
          value={clause}
          placeholder={t('forms.studio.signature.clause.placeholder', {
            fallback: 'I consent to the treatment described above…',
          })}
          onChange={(event) => {
            const next = event.target.value
            onClauseChange(next.length === 0 ? null : next)
          }}
        />
        <p className="text-xs text-muted-foreground">
          {t('forms.studio.signature.clause.help', {
            fallback: 'Shown above the signature. Its exact text is fingerprinted (SHA-256) with each signature.',
          })}
        </p>
      </div>
      <div className="space-y-2">
        <span className="block text-xs font-medium text-muted-foreground">
          {t('forms.studio.signature.modes.label', { fallback: 'Allowed signature methods' })}
        </span>
        <CheckboxField
          checked={enabled.has('drawn')}
          onCheckedChange={(state) => toggleMode('drawn', state === true)}
          label={t('forms.studio.signature.modes.drawn', { fallback: 'Draw' })}
        />
        <CheckboxField
          checked={enabled.has('typed')}
          onCheckedChange={(state) => toggleMode('typed', state === true)}
          label={t('forms.studio.signature.modes.typed', { fallback: 'Type name' })}
        />
      </div>
    </div>
  )
}
