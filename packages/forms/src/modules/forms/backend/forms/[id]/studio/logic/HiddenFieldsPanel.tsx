'use client'

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Trash2 } from '../lucide-icons'
import type { HiddenFieldEntry } from '../schema-helpers'

const NAME_PATTERN = /^[a-z][a-z0-9_]*$/

export type HiddenFieldsPanelProps = {
  formId: string
  entries: HiddenFieldEntry[]
  onChange: (next: HiddenFieldEntry[]) => void
}

export function HiddenFieldsPanel({ formId, entries, onChange }: HiddenFieldsPanelProps) {
  const t = useT()
  const [draftName, setDraftName] = React.useState('')
  const [draftDefault, setDraftDefault] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const urlSnippet = React.useMemo(() => {
    if (entries.length === 0) return null
    const query = entries.map((entry) => `${encodeURIComponent(entry.name)}=<value>`).join('&')
    return `/forms/${encodeURIComponent(formId)}/run?${query}`
  }, [entries, formId])

  const handleAdd = () => {
    const name = draftName.trim()
    if (!NAME_PATTERN.test(name)) {
      setError(t('forms.studio.parameters.hidden.error.name'))
      return
    }
    if (entries.some((entry) => entry.name === name)) {
      setError(t('forms.studio.parameters.hidden.error.duplicate'))
      return
    }
    setError(null)
    const trimmedDefault = draftDefault.trim()
    const next: HiddenFieldEntry = trimmedDefault.length > 0
      ? { name, defaultValue: trimmedDefault }
      : { name }
    onChange([...entries, next])
    setDraftName('')
    setDraftDefault('')
  }

  const handleRemove = (name: string) => {
    onChange(entries.filter((entry) => entry.name !== name))
  }

  return (
    <div className="space-y-3" data-testid="hidden-fields-panel">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">
          {t('forms.studio.parameters.hidden.heading')}
        </h3>
      </div>
      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('forms.studio.parameters.hidden.empty')}</p>
      ) : (
        <ul className="space-y-1">
          {entries.map((entry) => (
            <li key={entry.name} className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-2 py-1">
              <div className="flex flex-col">
                <span className="font-mono text-xs text-foreground">{entry.name}</span>
                <span className="text-[11px] text-muted-foreground">
                  {entry.defaultValue
                    ? t('forms.studio.parameters.hidden.defaultLabel', { value: entry.defaultValue })
                    : t('forms.studio.parameters.hidden.noDefault')}
                </span>
              </div>
              <IconButton
                aria-label={t('forms.studio.parameters.hidden.remove')}
                variant="ghost"
                size="sm"
                type="button"
                onClick={() => handleRemove(entry.name)}
              >
                <Trash2 className="size-4" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-2 rounded-md border border-dashed border-border p-2">
        <div className="grid grid-cols-2 gap-2">
          <Input
            placeholder={t('forms.studio.parameters.hidden.namePlaceholder')}
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
          />
          <Input
            placeholder={t('forms.studio.parameters.hidden.defaultPlaceholder')}
            value={draftDefault}
            onChange={(event) => setDraftDefault(event.target.value)}
          />
        </div>
        {error ? (
          <Alert variant="destructive">{error}</Alert>
        ) : null}
        <Button variant="outline" size="sm" type="button" onClick={handleAdd}>
          {t('forms.studio.parameters.hidden.add')}
        </Button>
      </div>
      {urlSnippet ? (
        <div className="space-y-1">
          <label className="block text-xs font-medium text-muted-foreground">
            {t('forms.studio.parameters.hidden.urlSnippet.label')}
          </label>
          <div className="rounded-md border border-border bg-muted/30 px-2 py-1 font-mono text-[11px] text-muted-foreground break-all">
            {urlSnippet}
          </div>
        </div>
      ) : null}
    </div>
  )
}
