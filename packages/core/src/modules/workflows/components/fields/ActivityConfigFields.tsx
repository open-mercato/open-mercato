'use client'

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { DurationInput } from '@open-mercato/ui/backend/inputs/DurationInput'
import { EventPatternInput } from '@open-mercato/ui/backend/inputs/EventPatternInput'
import { Plus, Trash2 } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import '../../lib/activity-registry-bootstrap'
import { getActivityType, type ActivityFormFieldSpec } from '../../lib/activity-registry'
import type { LedgerEntry } from '../../lib/context-ledger'
import { CommandPicker } from './CommandPicker'
import { EndpointPicker } from './EndpointPicker'
import { FunctionPicker } from './FunctionPicker'
import { VariablePickerButton } from './VariablePickerButton'
import { ledgerDropTargetProps } from './ledgerDropTarget'

/**
 * Registry-driven config form for workflow activities (spec
 * 2026-07-26-workflows-ux-redesign.md section 3.2, step 4.2).
 *
 * Renders an activity's `config` object from the registry entry's
 * `form: ActivityFormFieldSpec[]` via a component-hint map. Unknown hints
 * fall back to a plain text input.
 */

const TYPES_WITH_CONFIG_FORM = new Set(['WAIT', 'SEND_EMAIL', 'CALL_WEBHOOK', 'CALL_API', 'EMIT_EVENT', 'UPDATE_ENTITY', 'EXECUTE_FUNCTION', 'SET_VARIABLE', 'INVOKE_AGENT'])

export function hasActivityConfigForm(activityType: string): boolean {
  return TYPES_WITH_CONFIG_FORM.has(activityType) && getActivityType(activityType) != null
}

const XOR_FIELD_GROUPS: Record<string, string[][]> = {
  WAIT: [['duration', 'until']],
}

const containsTemplate = (value: string) => value.includes('{{')

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function toDatetimeLocal(value: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function fromDatetimeLocal(value: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toISOString()
}

type KeyValueRow = { key: string; value: string }

function objectToRows(value: unknown): KeyValueRow[] {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return []
  return Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => ({
    key,
    value: typeof entryValue === 'string' ? entryValue : JSON.stringify(entryValue),
  }))
}

function rowsToObject(rows: KeyValueRow[]): Record<string, string> | undefined {
  const result: Record<string, string> = {}
  for (const row of rows) {
    if (row.key.trim().length === 0) continue
    result[row.key] = row.value
  }
  return Object.keys(result).length > 0 ? result : undefined
}

interface KeyValueRowsEditorProps {
  idPrefix: string
  label: string
  value: unknown
  onChange: (value: Record<string, string> | undefined) => void
  disabled?: boolean
}

function KeyValueRowsEditor({ idPrefix, label, value, onChange, disabled }: KeyValueRowsEditorProps) {
  const t = useT()
  const [rows, setRows] = React.useState<KeyValueRow[]>(() => objectToRows(value))
  const emittedRef = React.useRef(JSON.stringify(rowsToObject(objectToRows(value)) ?? {}))

  React.useEffect(() => {
    const external = value != null && typeof value === 'object' && !Array.isArray(value) ? value : {}
    const serialized = JSON.stringify(external)
    if (serialized === emittedRef.current) return
    emittedRef.current = serialized
    setRows(objectToRows(value))
  }, [value])

  const commit = (nextRows: KeyValueRow[]) => {
    setRows(nextRows)
    const nextObject = rowsToObject(nextRows)
    emittedRef.current = JSON.stringify(nextObject ?? {})
    onChange(nextObject)
  }

  return (
    <div className="space-y-2">
      {rows.map((row, rowIndex) => (
        <div key={rowIndex} className="flex items-center gap-2">
          <Input
            id={`${idPrefix}-${rowIndex}-key`}
            type="text"
            value={row.key}
            onChange={(event) =>
              commit(rows.map((entry, entryIndex) => (entryIndex === rowIndex ? { ...entry, key: event.target.value } : entry)))
            }
            placeholder={t('workflows.fieldEditors.activities.keyValueKey')}
            aria-label={`${label} — ${t('workflows.fieldEditors.activities.keyValueKey')}`}
            className="text-xs"
            disabled={disabled}
          />
          <Input
            id={`${idPrefix}-${rowIndex}-value`}
            type="text"
            value={row.value}
            onChange={(event) =>
              commit(rows.map((entry, entryIndex) => (entryIndex === rowIndex ? { ...entry, value: event.target.value } : entry)))
            }
            placeholder={t('workflows.fieldEditors.activities.keyValueValue')}
            aria-label={`${label} — ${t('workflows.fieldEditors.activities.keyValueValue')}`}
            className="text-xs"
            disabled={disabled}
          />
          <IconButton
            variant="ghost"
            size="sm"
            onClick={() => commit(rows.filter((_, entryIndex) => entryIndex !== rowIndex))}
            aria-label={t('workflows.fieldEditors.activities.keyValueRemoveRow')}
            disabled={disabled}
          >
            <Trash2 className="size-3.5" />
          </IconButton>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setRows([...rows, { key: '', value: '' }])}
        disabled={disabled}
      >
        <Plus className="size-3 mr-1" />
        {t('workflows.fieldEditors.activities.keyValueAddRow')}
      </Button>
    </div>
  )
}

type AssignmentValue = { path: string; value: unknown }

type AssignmentRow = { path: string; jsonMode: boolean; text: string; invalid: boolean }

function assignmentsToRows(value: unknown): AssignmentRow[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => {
    const record = entry != null && typeof entry === 'object' && !Array.isArray(entry) ? (entry as Record<string, unknown>) : {}
    const path = typeof record.path === 'string' ? record.path : ''
    const rawValue = record.value
    if (typeof rawValue === 'string') return { path, jsonMode: false, text: rawValue, invalid: false }
    return {
      path,
      jsonMode: true,
      text: rawValue === undefined ? '' : JSON.stringify(rawValue, null, 2),
      invalid: false,
    }
  })
}

function parseAssignmentRowValue(row: AssignmentRow): { value: unknown; invalid: boolean } {
  if (!row.jsonMode) return { value: row.text, invalid: false }
  if (row.text.trim().length === 0) return { value: undefined, invalid: false }
  try {
    return { value: JSON.parse(row.text) as unknown, invalid: false }
  } catch {
    return { value: undefined, invalid: true }
  }
}

interface AssignmentRowsEditorProps {
  idPrefix: string
  label: string
  value: unknown
  onChange: (value: AssignmentValue[] | undefined) => void
  disabled?: boolean
}

function AssignmentRowsEditor({ idPrefix, label, value, onChange, disabled }: AssignmentRowsEditorProps) {
  const t = useT()
  const [rows, setRows] = React.useState<AssignmentRow[]>(() => assignmentsToRows(value))
  const emittedRef = React.useRef(JSON.stringify(Array.isArray(value) ? value : []))

  React.useEffect(() => {
    const serialized = JSON.stringify(Array.isArray(value) ? value : [])
    if (serialized === emittedRef.current) return
    emittedRef.current = serialized
    setRows(assignmentsToRows(value))
  }, [value])

  const commit = (nextRows: AssignmentRow[]) => {
    const markedRows = nextRows.map((row) => ({ ...row, invalid: parseAssignmentRowValue(row).invalid }))
    setRows(markedRows)
    if (markedRows.some((row) => row.invalid)) return
    const assignments: AssignmentValue[] = []
    for (const row of markedRows) {
      if (row.path.trim().length === 0) continue
      assignments.push({ path: row.path, value: parseAssignmentRowValue(row).value })
    }
    const next = assignments.length > 0 ? assignments : undefined
    emittedRef.current = JSON.stringify(next ?? [])
    onChange(next)
  }

  const toggleJsonMode = (rowIndex: number) => {
    commit(
      rows.map((row, entryIndex) => {
        if (entryIndex !== rowIndex) return row
        if (row.jsonMode) {
          let nextText = row.text
          try {
            const parsed = JSON.parse(row.text) as unknown
            if (typeof parsed === 'string') nextText = parsed
          } catch {
            nextText = row.text
          }
          return { ...row, jsonMode: false, text: nextText }
        }
        let nextText = row.text
        if (row.text.trim().length > 0) {
          try {
            JSON.parse(row.text)
          } catch {
            nextText = JSON.stringify(row.text)
          }
        }
        return { ...row, jsonMode: true, text: nextText }
      }),
    )
  }

  return (
    <div className="space-y-2">
      {rows.map((row, rowIndex) => (
        <div key={rowIndex} className="flex items-start gap-2">
          <Input
            id={`${idPrefix}-${rowIndex}-path`}
            type="text"
            value={row.path}
            onChange={(event) =>
              commit(rows.map((entry, entryIndex) => (entryIndex === rowIndex ? { ...entry, path: event.target.value } : entry)))
            }
            placeholder={t('workflows.fieldEditors.activities.assignmentPathPlaceholder')}
            aria-label={`${label} — ${t('workflows.fieldEditors.activities.assignmentPath')}`}
            className="text-xs"
            disabled={disabled}
          />
          <div className="flex-1 min-w-0">
            {row.jsonMode ? (
              <Textarea
                id={`${idPrefix}-${rowIndex}-value`}
                value={row.text}
                onChange={(event) =>
                  commit(rows.map((entry, entryIndex) => (entryIndex === rowIndex ? { ...entry, text: event.target.value } : entry)))
                }
                rows={3}
                placeholder='{"key": "value"}'
                aria-label={`${label} — ${t('workflows.fieldEditors.activities.assignmentValue')}`}
                aria-invalid={row.invalid || undefined}
                className="text-xs font-mono"
                disabled={disabled}
              />
            ) : (
              <Input
                id={`${idPrefix}-${rowIndex}-value`}
                type="text"
                value={row.text}
                onChange={(event) =>
                  commit(rows.map((entry, entryIndex) => (entryIndex === rowIndex ? { ...entry, text: event.target.value } : entry)))
                }
                placeholder={t('workflows.fieldEditors.activities.assignmentValuePlaceholder')}
                aria-label={`${label} — ${t('workflows.fieldEditors.activities.assignmentValue')}`}
                className="text-xs"
                disabled={disabled}
              />
            )}
            {row.invalid && (
              <p className="text-xs text-status-error-text mt-1">
                {t('workflows.fieldEditors.activities.invalidJson')}
              </p>
            )}
          </div>
          <Button
            type="button"
            variant={row.jsonMode ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => toggleJsonMode(rowIndex)}
            aria-pressed={row.jsonMode}
            aria-label={t('workflows.fieldEditors.activities.assignmentJsonToggle')}
            disabled={disabled}
          >
            {t('workflows.fieldEditors.activities.assignmentJsonToggle')}
          </Button>
          <IconButton
            variant="ghost"
            size="sm"
            onClick={() => commit(rows.filter((_, entryIndex) => entryIndex !== rowIndex))}
            aria-label={t('workflows.fieldEditors.activities.assignmentRemoveRow')}
            disabled={disabled}
          >
            <Trash2 className="size-3.5" />
          </IconButton>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setRows([...rows, { path: '', jsonMode: false, text: '', invalid: false }])}
        disabled={disabled}
      >
        <Plus className="size-3 mr-1" />
        {t('workflows.fieldEditors.activities.assignmentAddRow')}
      </Button>
    </div>
  )
}

interface JsonValueTextareaProps {
  id: string
  value: unknown
  onChange: (value: unknown) => void
  disabled?: boolean
}

function JsonValueTextarea({ id, value, onChange, disabled }: JsonValueTextareaProps) {
  const t = useT()
  const serialized = React.useMemo(
    () => (value === undefined ? '' : JSON.stringify(value, null, 2)),
    [value]
  )
  const [text, setText] = React.useState(serialized)
  const [isInvalid, setIsInvalid] = React.useState(false)
  const isFocusedRef = React.useRef(false)
  const lastSerializedRef = React.useRef(serialized)

  React.useEffect(() => {
    if (serialized === lastSerializedRef.current) return
    lastSerializedRef.current = serialized
    if (isFocusedRef.current) return
    setText(serialized)
    setIsInvalid(false)
  }, [serialized])

  const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const nextText = event.target.value
    setText(nextText)
    if (nextText.trim().length === 0) {
      setIsInvalid(false)
      onChange(undefined)
      return
    }
    try {
      const parsed = JSON.parse(nextText) as unknown
      setIsInvalid(false)
      onChange(parsed)
    } catch {
      setIsInvalid(true)
    }
  }

  return (
    <div>
      <Textarea
        id={id}
        value={text}
        onChange={handleChange}
        onFocus={() => {
          isFocusedRef.current = true
        }}
        onBlur={() => {
          isFocusedRef.current = false
          if (!isInvalid) setText(serialized)
        }}
        placeholder='{"key": "value"}'
        rows={3}
        className="text-xs font-mono"
        aria-invalid={isInvalid || undefined}
        disabled={disabled}
      />
      {isInvalid && (
        <p className="text-xs text-status-error-text mt-1">
          {t('workflows.fieldEditors.activities.invalidJson')}
        </p>
      )}
    </div>
  )
}

export interface ActivityConfigFieldsProps {
  activityType: string
  idPrefix: string
  config: Record<string, unknown>
  onChange: (config: Record<string, unknown>) => void
  ledgerEntries?: LedgerEntry[]
  disabled?: boolean
}

export function ActivityConfigFields({ activityType, idPrefix, config, onChange, ledgerEntries, disabled }: ActivityConfigFieldsProps) {
  const t = useT()
  const entry = getActivityType(activityType)
  if (!entry || entry.form.length === 0) return null

  const setField = (spec: ActivityFormFieldSpec, nextValue: unknown) => {
    const next: Record<string, unknown> = { ...config }
    const isEmpty = nextValue === '' || nextValue === undefined
    if (isEmpty) {
      delete next[spec.id]
    } else {
      next[spec.id] = nextValue
      for (const group of XOR_FIELD_GROUPS[activityType] ?? []) {
        if (!group.includes(spec.id)) continue
        for (const sibling of group) {
          if (sibling !== spec.id) delete next[sibling]
        }
      }
    }
    onChange(next)
  }

  const labelFor = (spec: ActivityFormFieldSpec): string =>
    t(spec.labelKey ?? `workflows.activityConfig.${activityType}.${spec.id}`)

  const renderControl = (spec: ActivityFormFieldSpec) => {
    const fieldId = `${idPrefix}-${spec.id}`
    const label = labelFor(spec)
    const rawValue = config[spec.id]
    switch (spec.component) {
      case 'duration':
        return (
          <DurationInput
            id={fieldId}
            value={stringValue(rawValue)}
            onChange={(nextValue) => setField(spec, nextValue)}
            aria-label={label}
            disabled={disabled}
          />
        )
      case 'datetime': {
        const current = stringValue(rawValue)
        if (containsTemplate(current)) {
          return (
            <div className="flex items-center gap-1">
              <Input
                id={fieldId}
                type="text"
                value={current}
                onChange={(event) => setField(spec, event.target.value)}
                className="flex-1 text-xs"
                disabled={disabled}
                {...ledgerDropTargetProps({
                  value: current,
                  onValueChange: (nextValue) => setField(spec, nextValue),
                  disabled,
                })}
              />
              <VariablePickerButton
                targetId={fieldId}
                value={current}
                onValueChange={(nextValue) => setField(spec, nextValue)}
                ledgerEntries={ledgerEntries}
                disabled={disabled}
              />
            </div>
          )
        }
        return (
          <Input
            id={fieldId}
            type="datetime-local"
            value={toDatetimeLocal(current)}
            onChange={(event) => setField(spec, fromDatetimeLocal(event.target.value))}
            className="text-xs"
            disabled={disabled}
          />
        )
      }
      case 'textarea':
        return (
          <div className="flex items-start gap-1">
            <Textarea
              id={fieldId}
              value={stringValue(rawValue)}
              onChange={(event) => setField(spec, event.target.value)}
              rows={4}
              className="flex-1 text-xs"
              disabled={disabled}
              {...ledgerDropTargetProps({
                value: stringValue(rawValue),
                onValueChange: (nextValue) => setField(spec, nextValue),
                disabled,
              })}
            />
            <VariablePickerButton
              targetId={fieldId}
              value={stringValue(rawValue)}
              onValueChange={(nextValue) => setField(spec, nextValue)}
              ledgerEntries={ledgerEntries}
              disabled={disabled}
            />
          </div>
        )
      case 'eventName':
        return (
          <EventPatternInput
            value={stringValue(rawValue)}
            onChange={(nextValue) => setField(spec, nextValue)}
            disabled={disabled}
          />
        )
      case 'endpoint':
        return (
          <EndpointPicker
            id={fieldId}
            endpoint={stringValue(rawValue)}
            method={stringValue(config.method)}
            onApply={(patch) => {
              const next: Record<string, unknown> = { ...config }
              for (const [patchKey, patchValue] of Object.entries(patch)) {
                if (patchValue === '' || patchValue === undefined) {
                  delete next[patchKey]
                } else {
                  next[patchKey] = patchValue
                }
              }
              onChange(next)
            }}
            ledgerEntries={ledgerEntries}
            disabled={disabled}
          />
        )
      case 'commandId':
        return (
          <CommandPicker
            value={stringValue(rawValue)}
            onChange={(nextValue) => setField(spec, nextValue)}
            disabled={disabled}
          />
        )
      case 'functionName':
        return (
          <FunctionPicker
            value={stringValue(rawValue)}
            onChange={(nextValue) => setField(spec, nextValue)}
            disabled={disabled}
          />
        )
      case 'assignments':
        return (
          <AssignmentRowsEditor
            idPrefix={fieldId}
            label={label}
            value={rawValue}
            onChange={(nextValue) => setField(spec, nextValue)}
            disabled={disabled}
          />
        )
      case 'keyValue':
        return (
          <KeyValueRowsEditor
            idPrefix={fieldId}
            label={label}
            value={rawValue}
            onChange={(nextValue) => setField(spec, nextValue)}
            disabled={disabled}
          />
        )
      case 'json':
        return (
          <JsonValueTextarea
            id={fieldId}
            value={rawValue}
            onChange={(nextValue) => setField(spec, nextValue)}
            disabled={disabled}
          />
        )
      case 'checkbox':
        return (
          <div className="flex items-center gap-2">
            <Checkbox
              id={fieldId}
              checked={rawValue === true}
              onCheckedChange={(checked) => setField(spec, checked === true)}
              disabled={disabled}
            />
            <Label htmlFor={fieldId} className="text-xs cursor-pointer">
              {label}
            </Label>
          </div>
        )
      default:
        return (
          <div className="flex items-center gap-1">
            <Input
              id={fieldId}
              type="text"
              value={stringValue(rawValue)}
              onChange={(event) => setField(spec, event.target.value)}
              className="flex-1 text-xs"
              disabled={disabled}
              {...ledgerDropTargetProps({
                value: stringValue(rawValue),
                onValueChange: (nextValue) => setField(spec, nextValue),
                disabled,
              })}
            />
            <VariablePickerButton
              targetId={fieldId}
              value={stringValue(rawValue)}
              onValueChange={(nextValue) => setField(spec, nextValue)}
              ledgerEntries={ledgerEntries}
              disabled={disabled}
            />
          </div>
        )
    }
  }

  const xorHintKey = XOR_FIELD_GROUPS[activityType]
    ? `workflows.activityConfig.${activityType}.xorHint`
    : null

  return (
    <div className="space-y-3">
      {entry.form.map((spec) => (
        <div
          key={spec.id}
          {...(spec.component === 'commandId' || spec.component === 'functionName'
            ? { role: 'group', 'aria-labelledby': `${idPrefix}-${spec.id}-label` }
            : {})}
        >
          {spec.component !== 'checkbox' && (
            <Label
              id={`${idPrefix}-${spec.id}-label`}
              {...(spec.component === 'commandId' || spec.component === 'functionName'
                ? {}
                : { htmlFor: `${idPrefix}-${spec.id}` })}
              className="text-xs font-medium mb-1"
            >
              {labelFor(spec)}
              {spec.required ? ' *' : ''}
            </Label>
          )}
          {renderControl(spec)}
          {spec.descriptionKey && (
            <p className="text-xs text-muted-foreground mt-1">{t(spec.descriptionKey)}</p>
          )}
        </div>
      ))}
      {xorHintKey && <p className="text-xs text-muted-foreground">{t(xorHintKey)}</p>}
    </div>
  )
}
