'use client'

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Alert } from '@open-mercato/ui/primitives/alert'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Trash2 } from '../lucide-icons'
import {
  validateJsonLogicGrammar,
} from '../../../../../schema/jsonlogic-grammar'
import type { FormSchema, VariableEntry } from '../schema-helpers'

const NAME_PATTERN = /^[a-z][a-z0-9_]*$/

export type VariablesPanelProps = {
  schema: FormSchema
  entries: VariableEntry[]
  onChange: (next: VariableEntry[]) => void
}

type BuilderMode = 'sum' | 'count_yes' | 'raw'

type DraftState = {
  name: string
  type: 'number' | 'boolean' | 'string'
  mode: BuilderMode
  selectedFields: string[]
  rawJson: string
  defaultValue: string
}

function emptyDraft(): DraftState {
  return {
    name: '',
    type: 'number',
    mode: 'sum',
    selectedFields: [],
    rawJson: '',
    defaultValue: '',
  }
}

function buildFormula(draft: DraftState): unknown {
  if (draft.mode === 'sum') {
    return {
      '+': draft.selectedFields.map((field) => ({ var: field })),
    }
  }
  if (draft.mode === 'count_yes') {
    if (draft.selectedFields.length === 0) return 0
    return {
      '+': draft.selectedFields.map((field) => ({
        if: [{ '==': [{ var: field }, true] }, 1, 0],
      })),
    }
  }
  try {
    return JSON.parse(draft.rawJson)
  } catch {
    return null
  }
}

export function VariablesPanel({ schema, entries, onChange }: VariablesPanelProps) {
  const t = useT()
  const [draft, setDraft] = React.useState<DraftState>(emptyDraft)
  const [error, setError] = React.useState<string | null>(null)
  const fieldKeys = React.useMemo(() => {
    return Object.entries(schema.properties)
      .filter(([, node]) => {
        const omType = String((node as Record<string, unknown>)['x-om-type'] ?? '')
        return omType !== 'info_block'
      })
      .map(([key]) => key)
  }, [schema])

  const handleToggleField = (fieldKey: string, checked: boolean) => {
    setDraft((current) => ({
      ...current,
      selectedFields: checked
        ? [...current.selectedFields, fieldKey]
        : current.selectedFields.filter((entry) => entry !== fieldKey),
    }))
  }

  const handleAdd = () => {
    const name = draft.name.trim()
    if (!NAME_PATTERN.test(name)) {
      setError(t('forms.studio.parameters.variables.error.name'))
      return
    }
    if (entries.some((entry) => entry.name === name)) {
      setError(t('forms.studio.parameters.variables.error.duplicate'))
      return
    }
    const formula = buildFormula(draft)
    if (formula === null || formula === undefined) {
      setError(t('forms.studio.parameters.variables.error.formula'))
      return
    }
    const grammarMessage = validateJsonLogicGrammar(formula)
    if (grammarMessage) {
      setError(grammarMessage)
      return
    }
    setError(null)
    const next: VariableEntry = { name, type: draft.type, formula }
    if (draft.defaultValue.trim().length > 0) {
      if (draft.type === 'number') {
        const parsed = Number(draft.defaultValue)
        if (Number.isFinite(parsed)) next.default = parsed
      } else if (draft.type === 'boolean') {
        next.default = draft.defaultValue === 'true'
      } else {
        next.default = draft.defaultValue
      }
    }
    onChange([...entries, next])
    setDraft(emptyDraft())
  }

  const handleRemove = (name: string) => {
    onChange(entries.filter((entry) => entry.name !== name))
  }

  return (
    <div className="space-y-3" data-testid="variables-panel">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">
          {t('forms.studio.parameters.variables.heading')}
        </h3>
      </div>
      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('forms.studio.parameters.variables.empty')}</p>
      ) : (
        <ul className="space-y-1">
          {entries.map((entry) => (
            <li
              key={entry.name}
              className="flex items-start justify-between gap-2 rounded-md border border-border bg-background px-2 py-1"
            >
              <div className="flex flex-col">
                <span className="font-mono text-xs text-foreground">
                  {entry.name} <span className="text-muted-foreground">: {entry.type}</span>
                </span>
                <code className="mt-1 max-w-xs truncate text-[10px] text-muted-foreground">
                  {JSON.stringify(entry.formula)}
                </code>
              </div>
              <IconButton
                aria-label={t('forms.studio.parameters.variables.remove')}
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
            placeholder={t('forms.studio.parameters.variables.namePlaceholder')}
            value={draft.name}
            onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
          />
          <Select
            value={draft.type}
            onValueChange={(value) =>
              setDraft((current) => ({ ...current, type: value as DraftState['type'] }))
            }
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="number">number</SelectItem>
              <SelectItem value="boolean">boolean</SelectItem>
              <SelectItem value="string">string</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Select
          value={draft.mode}
          onValueChange={(value) =>
            setDraft((current) => ({ ...current, mode: value as BuilderMode }))
          }
        >
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="sum">{t('forms.studio.parameters.variables.mode.sum')}</SelectItem>
            <SelectItem value="count_yes">{t('forms.studio.parameters.variables.mode.countYes')}</SelectItem>
            <SelectItem value="raw">{t('forms.studio.parameters.variables.mode.raw')}</SelectItem>
          </SelectContent>
        </Select>
        {(draft.mode === 'sum' || draft.mode === 'count_yes') ? (
          <div className="max-h-40 space-y-1 overflow-auto rounded-md border border-border bg-muted/30 p-2">
            {fieldKeys.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('forms.studio.parameters.variables.noFields')}</p>
            ) : (
              fieldKeys.map((key) => {
                const checked = draft.selectedFields.includes(key)
                return (
                  <label key={key} className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => handleToggleField(key, event.target.checked)}
                    />
                    <span className="font-mono">{key}</span>
                  </label>
                )
              })
            )}
          </div>
        ) : null}
        {draft.mode === 'raw' ? (
          <details>
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
              {t('forms.studio.parameters.variables.rawHint')}
            </summary>
            <textarea
              className="mt-1 h-24 w-full rounded-md border border-border bg-background p-2 font-mono text-xs"
              placeholder={'{"+": [{"var": "a"}, {"var": "b"}]}'}
              value={draft.rawJson}
              onChange={(event) =>
                setDraft((current) => ({ ...current, rawJson: event.target.value }))
              }
            />
          </details>
        ) : null}
        <Input
          placeholder={t('forms.studio.parameters.variables.defaultPlaceholder')}
          value={draft.defaultValue}
          onChange={(event) => setDraft((current) => ({ ...current, defaultValue: event.target.value }))}
        />
        {error ? <Alert variant="destructive">{error}</Alert> : null}
        <Button variant="outline" size="sm" type="button" onClick={handleAdd}>
          {t('forms.studio.parameters.variables.add')}
        </Button>
      </div>
    </div>
  )
}
