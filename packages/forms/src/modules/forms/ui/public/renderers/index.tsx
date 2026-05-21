"use client"

import * as React from 'react'
import type { ComponentType } from 'react'
import { Lock, Paperclip, Plus, Trash2, X } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { FormField } from '@open-mercato/ui/primitives/form-field'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { CheckboxField } from '@open-mercato/ui/primitives/checkbox-field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { DatePicker } from '@open-mercato/ui/backend/inputs/DatePicker'
import { DateTimePicker } from '@open-mercato/ui/backend/inputs/DateTimePicker'
import { ScaleField } from '../../../runner/ScaleField'
import { SignatureCanvas, computeClauseSha256 } from '../../../runner/SignatureField'
import {
  defaultFieldTypeRegistry,
  FieldTypeRegistry,
} from '../../../schema/field-type-registry'
import { readFileRefs, type FileAttachmentRef } from '../../../schema/file-field'
import { readSignatureModes, type SignatureMode, type SignatureValue } from '../../../schema/signature-field'
import {
  readGroupSubFields,
  readGroupMinItems,
  readGroupMaxItems,
  type GroupSubFieldDescriptor,
} from '../../../schema/group-field'
import {
  resolveLocaleString,
  type RunnerFieldDescriptor,
  type RunnerFieldNode,
  type RunnerFieldRendererProps,
  type RunnerFileAttachmentRef,
  type RunnerOption,
} from '../types'

const labelFor = (
  node: RunnerFieldNode | undefined,
  locale: string,
  defaultLocale: string,
  fallback: string,
): string => resolveLocaleString(node?.['x-om-label'], locale, defaultLocale, fallback)

const helpFor = (
  node: RunnerFieldNode | undefined,
  locale: string,
  defaultLocale: string,
): string | undefined => {
  if (!node?.['x-om-help']) return undefined
  return resolveLocaleString(node['x-om-help'], locale, defaultLocale, '')
}

const SensitiveBadge = React.memo(function SensitiveBadge({ label }: { label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
      title={label}
      aria-label={label}
    >
      <Lock aria-hidden="true" className="h-3 w-3" />
      <span>{label}</span>
    </span>
  )
})

function FieldShell(
  props: RunnerFieldRendererProps & {
    children: React.ReactNode
    sensitiveLabel?: string
  },
) {
  const { field, fieldNode, locale, defaultLocale, error, sensitiveLabel, children } = props
  const label = labelFor(fieldNode, locale, defaultLocale, field.key)
  const help = helpFor(fieldNode, locale, defaultLocale)
  const description: React.ReactNode = field.sensitive && sensitiveLabel ? (
    <span className="flex flex-wrap items-center gap-2">
      <SensitiveBadge label={sensitiveLabel} />
      {help ? <span>{help}</span> : null}
    </span>
  ) : help

  return (
    <FormField
      label={label}
      required={field.required}
      description={description ?? undefined}
      error={error ?? undefined}
      id={props.inputId}
    >
      {children}
    </FormField>
  )
}

function asString(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  return String(value)
}

function asNumberOrEmpty(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function asArrayOfStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}

function optionsOf(node: RunnerFieldNode): RunnerOption[] {
  const options = node['x-om-options']
  return Array.isArray(options) ? (options as RunnerOption[]) : []
}

const pad2 = (input: number): string => String(input).padStart(2, '0')

// Date pickers exchange `Date` objects, but submissions persist the native
// `YYYY-MM-DD` / `YYYY-MM-DDTHH:mm` strings the JSON-Schema validators expect.
// These adapters keep the stored bytes identical so schemaHash + validation
// parity survive the widget swap (forms AGENTS MUST 6 / MUST 15).
function parseDateOnly(value: unknown): Date | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(date.getTime()) ? null : date
}

function formatDateOnly(date: Date | null): string | undefined {
  if (!date) return undefined
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function parseDateTimeLocal(value: unknown): Date | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value)
  if (!match) return null
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
  )
  return Number.isNaN(date.getTime()) ? null : date
}

function formatDateTimeLocal(date: Date | null): string | undefined {
  if (!date) return undefined
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}` +
    `T${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  )
}

const SENSITIVE_KEY = 'forms.runner.encrypted_label'

// ---------- Renderers ----------

export const TextRenderer: ComponentType<RunnerFieldRendererProps> = (props) => {
  const { value, onChange, onBlur, disabled, fieldNode } = props
  const minLength = typeof fieldNode.minLength === 'number' ? fieldNode.minLength : undefined
  const maxLength = typeof fieldNode.maxLength === 'number' ? fieldNode.maxLength : undefined
  const pattern = typeof fieldNode.pattern === 'string' ? fieldNode.pattern : undefined
  return (
    <FieldShell {...props} sensitiveLabel={SENSITIVE_KEY}>
      <Input
        type="text"
        value={asString(value)}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        disabled={disabled}
        minLength={minLength}
        maxLength={maxLength}
        pattern={pattern}
      />
    </FieldShell>
  )
}

export const TextareaRenderer: ComponentType<RunnerFieldRendererProps> = (props) => {
  const { value, onChange, onBlur, disabled } = props
  return (
    <FieldShell {...props} sensitiveLabel={SENSITIVE_KEY}>
      <Textarea
        value={asString(value)}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        disabled={disabled}
        rows={4}
      />
    </FieldShell>
  )
}

const NumericLikeRenderer: (allowDecimal: boolean) => ComponentType<RunnerFieldRendererProps> = (
  allowDecimal,
) => {
  const Renderer: ComponentType<RunnerFieldRendererProps> = (props) => {
    const { value, onChange, onBlur, disabled, fieldNode } = props
    const min = typeof fieldNode['x-om-min'] === 'number' ? (fieldNode['x-om-min'] as number) : undefined
    const max = typeof fieldNode['x-om-max'] === 'number' ? (fieldNode['x-om-max'] as number) : undefined
    return (
      <FieldShell {...props} sensitiveLabel={SENSITIVE_KEY}>
        <Input
          type="number"
          value={asNumberOrEmpty(value)}
          onChange={(event) => {
            const raw = event.target.value
            if (raw === '') {
              onChange(undefined)
              return
            }
            const parsed = allowDecimal ? Number.parseFloat(raw) : Number.parseInt(raw, 10)
            if (Number.isFinite(parsed)) {
              onChange(parsed)
            }
          }}
          onBlur={onBlur}
          disabled={disabled}
          min={min}
          max={max}
          step={allowDecimal ? 'any' : 1}
        />
      </FieldShell>
    )
  }
  return Renderer
}

export const NumberRenderer = NumericLikeRenderer(true)
export const IntegerRenderer = NumericLikeRenderer(false)

export const BooleanRenderer: ComponentType<RunnerFieldRendererProps> = (props) => {
  const { value, onChange, disabled, field, fieldNode, locale, defaultLocale, error, inputId } = props
  const checked = value === true
  const label = labelFor(fieldNode, locale, defaultLocale, field.key)
  const help = helpFor(fieldNode, locale, defaultLocale)
  const description: React.ReactNode = field.sensitive ? (
    <span className="flex flex-wrap items-center gap-2">
      <SensitiveBadge label={SENSITIVE_KEY} />
      {help ? <span>{help}</span> : null}
    </span>
  ) : help
  return (
    <div className="flex flex-col gap-1.5">
      <CheckboxField
        id={inputId}
        checked={checked}
        onCheckedChange={(state) => onChange(state === true)}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        label={
          <>
            {label}
            {field.required ? (
              <span className="ml-0.5 text-status-error-icon" aria-hidden="true">*</span>
            ) : null}
          </>
        }
        description={description ?? undefined}
      />
      {error ? (
        <p role="alert" className="text-xs text-status-error-text">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export const DateRenderer: ComponentType<RunnerFieldRendererProps> = (props) => {
  const { value, onChange, disabled } = props
  return (
    <FieldShell {...props} sensitiveLabel={SENSITIVE_KEY}>
      <DatePicker
        value={parseDateOnly(value)}
        onChange={(date) => onChange(formatDateOnly(date))}
        disabled={disabled}
      />
    </FieldShell>
  )
}

export const DatetimeRenderer: ComponentType<RunnerFieldRendererProps> = (props) => {
  const { value, onChange, disabled } = props
  return (
    <FieldShell {...props} sensitiveLabel={SENSITIVE_KEY}>
      <DateTimePicker
        value={parseDateTimeLocal(value)}
        onChange={(date) => onChange(formatDateTimeLocal(date))}
        disabled={disabled}
      />
    </FieldShell>
  )
}

export const SelectOneRenderer: ComponentType<RunnerFieldRendererProps> = (props) => {
  const { value, onChange, disabled, fieldNode, locale, defaultLocale } = props
  const options = optionsOf(fieldNode)
  return (
    <FieldShell {...props} sensitiveLabel={SENSITIVE_KEY}>
      <Select
        value={asString(value)}
        onValueChange={(next) => onChange(next || undefined)}
        disabled={disabled}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {resolveLocaleString(option.label, locale, defaultLocale, option.value)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FieldShell>
  )
}

export const SelectManyRenderer: ComponentType<RunnerFieldRendererProps> = (props) => {
  const { value, onChange, disabled, fieldNode, locale, defaultLocale } = props
  const options = optionsOf(fieldNode)
  const selected = new Set(asArrayOfStrings(value))
  const toggle = (entry: string) => {
    const next = new Set(selected)
    if (next.has(entry)) next.delete(entry)
    else next.add(entry)
    onChange(Array.from(next))
  }
  return (
    <FieldShell {...props} sensitiveLabel={SENSITIVE_KEY}>
      <div role="group" className="flex flex-col gap-2.5">
        {options.map((option) => {
          const isChecked = selected.has(option.value)
          const label = resolveLocaleString(option.label, locale, defaultLocale, option.value)
          return (
            <CheckboxField
              key={option.value}
              label={label}
              checked={isChecked}
              onCheckedChange={() => toggle(option.value)}
              disabled={disabled}
            />
          )
        })}
      </div>
    </FieldShell>
  )
}

export const ScaleRenderer: ComponentType<RunnerFieldRendererProps> = (props) => {
  const { value, onChange, disabled, fieldNode, inputId } = props
  const min = typeof fieldNode['x-om-min'] === 'number' ? (fieldNode['x-om-min'] as number) : 0
  const max = typeof fieldNode['x-om-max'] === 'number' ? (fieldNode['x-om-max'] as number) : 10
  const current = typeof value === 'number' && Number.isFinite(value) ? (value as number) : null
  return (
    <FieldShell {...props} sensitiveLabel={SENSITIVE_KEY}>
      <ScaleField
        id={inputId}
        min={min}
        max={max}
        value={current}
        onChange={onChange}
        disabled={disabled}
      />
    </FieldShell>
  )
}

export const InfoBlockRenderer: ComponentType<RunnerFieldRendererProps> = (props) => {
  const { fieldNode, locale, defaultLocale } = props
  const label = resolveLocaleString(fieldNode['x-om-label'], locale, defaultLocale, '')
  const help = resolveLocaleString(fieldNode['x-om-help'], locale, defaultLocale, '')
  return (
    <div className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
      {label ? <p className="font-medium text-foreground">{label}</p> : null}
      {help ? <p className="mt-1 whitespace-pre-line">{help}</p> : null}
    </div>
  )
}

function readAcceptAttr(node: RunnerFieldNode): string | undefined {
  const accept = node['x-om-accept']
  if (!Array.isArray(accept)) return undefined
  const entries = accept.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
  return entries.length > 0 ? entries.join(',') : undefined
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export const FileRenderer: ComponentType<RunnerFieldRendererProps> = (props) => {
  const { value, onChange, disabled, fieldNode, uploader, submissionId, inputId } = props
  const t = useT()
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = React.useState(false)
  const [uploadError, setUploadError] = React.useState<string | null>(null)

  const allowMultiple = fieldNode['x-om-multiple'] === true
  const acceptAttr = readAcceptAttr(fieldNode)
  const maxSizeBytes =
    typeof fieldNode['x-om-max-size-bytes'] === 'number' ? (fieldNode['x-om-max-size-bytes'] as number) : null
  const refs: FileAttachmentRef[] = readFileRefs(value) ?? []
  const canUpload = Boolean(uploader && submissionId) && !disabled && (allowMultiple || refs.length === 0)

  const handleFiles = React.useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0 || !uploader || !submissionId) return
      setUploadError(null)
      const selected = Array.from(files)
      const toUpload = allowMultiple ? selected : selected.slice(0, 1)
      // Client-side defence-in-depth — the server is authoritative.
      for (const file of toUpload) {
        if (maxSizeBytes !== null && file.size > maxSizeBytes) {
          setUploadError(t('forms.runner.file.too_large', { fallback: 'File is too large.' }))
          return
        }
      }
      setUploading(true)
      try {
        const uploaded: RunnerFileAttachmentRef[] = []
        for (const file of toUpload) {
          const ref = await uploader.upload({ submissionId, fieldKey: props.field.key, file })
          uploaded.push(ref)
        }
        onChange(allowMultiple ? [...refs, ...uploaded] : uploaded)
      } catch (error) {
        setUploadError(
          error instanceof Error
            ? error.message
            : t('forms.runner.file.upload_failed', { fallback: 'Upload failed.' }),
        )
      } finally {
        setUploading(false)
        if (inputRef.current) inputRef.current.value = ''
      }
    },
    [allowMultiple, maxSizeBytes, onChange, props.field.key, refs, submissionId, t, uploader],
  )

  const removeAt = (index: number) => {
    const next = refs.filter((_, idx) => idx !== index)
    onChange(next)
  }

  return (
    <FieldShell {...props} sensitiveLabel={SENSITIVE_KEY}>
      <div className="flex flex-col gap-2">
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          className="sr-only"
          accept={acceptAttr}
          multiple={allowMultiple}
          disabled={!canUpload}
          onChange={(event) => {
            void handleFiles(event.target.files)
          }}
        />
        {refs.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {refs.map((ref, index) => (
              <li
                key={ref.id}
                className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm"
              >
                <span className="flex items-center gap-2 truncate text-foreground">
                  <Paperclip aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{ref.filename || ref.id}</span>
                  {ref.sizeBytes > 0 ? (
                    <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(ref.sizeBytes)}</span>
                  ) : null}
                </span>
                {!disabled ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeAt(index)}
                    aria-label={t('forms.runner.file.remove', { fallback: 'Remove file' })}
                  >
                    <X aria-hidden="true" className="h-4 w-4" />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {canUpload ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? (
              <Spinner className="h-4 w-4" />
            ) : (
              <Paperclip aria-hidden="true" className="h-4 w-4" />
            )}
            <span className="ml-2">
              {uploading
                ? t('forms.runner.file.uploading', { fallback: 'Uploading…' })
                : refs.length > 0
                  ? t('forms.runner.file.add', { fallback: 'Add another file' })
                  : t('forms.runner.file.choose', { fallback: 'Choose file' })}
            </span>
          </Button>
        ) : null}
        {uploadError ? (
          <p role="alert" className="text-xs text-status-error-text">
            {uploadError}
          </p>
        ) : null}
      </div>
    </FieldShell>
  )
}

function readSignatureValue(value: unknown): Partial<SignatureValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Partial<SignatureValue>
}

export const SignatureRenderer: ComponentType<RunnerFieldRendererProps> = (props) => {
  const { value, onChange, disabled, fieldNode, locale, defaultLocale, inputId } = props
  const t = useT()
  const current = readSignatureValue(value)
  const allowedModes = readSignatureModes(fieldNode)
  const clauseText = resolveLocaleString(
    fieldNode['x-om-consent-clause'] as RunnerLocaleMap | undefined,
    locale,
    defaultLocale,
    '',
  )
  const initialMode: SignatureMode = current.mode && allowedModes.includes(current.mode)
    ? current.mode
    : allowedModes[0]
  const [mode, setMode] = React.useState<SignatureMode>(initialMode)

  // Compose a complete signature value. Computes the clause fingerprint via
  // Web Crypto and stamps `signedAt`. Only emits when the affirmation +
  // mode-specific payload are present; otherwise clears the field so the
  // validator (which requires affirmed + clauseSha256) fails closed.
  const emit = React.useCallback(
    async (next: { mode: SignatureMode; image?: string | null; typedName?: string; affirmed: boolean }) => {
      const hasPayload = next.mode === 'drawn'
        ? typeof next.image === 'string' && next.image.length > 0
        : typeof next.typedName === 'string' && next.typedName.trim().length > 0
      if (!next.affirmed || !hasPayload) {
        onChange(undefined)
        return
      }
      const clauseSha256 = await computeClauseSha256(clauseText)
      if (!clauseSha256) {
        onChange(undefined)
        return
      }
      const payload: SignatureValue = {
        mode: next.mode,
        affirmed: true,
        signedAt: new Date().toISOString(),
        clauseSha256,
        ...(next.mode === 'drawn'
          ? { image: next.image ?? undefined }
          : { typedName: next.typedName?.trim() }),
      }
      onChange(payload)
    },
    [clauseText, onChange],
  )

  const affirmed = current.affirmed === true
  const drawnImage = typeof current.image === 'string' ? current.image : null
  const typedName = typeof current.typedName === 'string' ? current.typedName : ''

  return (
    <FieldShell {...props} sensitiveLabel={SENSITIVE_KEY}>
      <div className="flex flex-col gap-3">
        {clauseText ? (
          <div
            className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-foreground"
            aria-label={t('forms.runner.signature.clause_label', { fallback: 'Consent statement' })}
          >
            <p className="whitespace-pre-line">{clauseText}</p>
          </div>
        ) : null}
        {allowedModes.length > 1 ? (
          <div role="group" className="flex gap-2" aria-label={t('forms.runner.signature.mode_label', { fallback: 'Signature method' })}>
            {allowedModes.map((entry) => (
              <Button
                key={entry}
                type="button"
                size="sm"
                variant={mode === entry ? 'default' : 'outline'}
                disabled={disabled}
                onClick={() => setMode(entry)}
              >
                {entry === 'drawn'
                  ? t('forms.runner.signature.mode_draw', { fallback: 'Draw' })
                  : t('forms.runner.signature.mode_type', { fallback: 'Type' })}
              </Button>
            ))}
          </div>
        ) : null}
        {mode === 'drawn' ? (
          <SignatureCanvas
            value={drawnImage}
            disabled={disabled}
            ariaLabel={t('forms.runner.signature.canvas_label', { fallback: 'Signature pad' })}
            clearLabel={t('forms.runner.signature.clear', { fallback: 'Clear' })}
            onChange={(dataUrl) => {
              void emit({ mode: 'drawn', image: dataUrl, affirmed })
            }}
          />
        ) : (
          <Input
            id={inputId}
            type="text"
            value={typedName}
            disabled={disabled}
            placeholder={t('forms.runner.signature.typed_placeholder', { fallback: 'Type your full name' })}
            className="font-[cursive] text-lg"
            onChange={(event) => {
              void emit({ mode: 'typed', typedName: event.target.value, affirmed })
            }}
          />
        )}
        <CheckboxField
          checked={affirmed}
          disabled={disabled}
          onCheckedChange={(state) => {
            const nextAffirmed = state === true
            void emit({
              mode,
              image: mode === 'drawn' ? drawnImage : undefined,
              typedName: mode === 'typed' ? typedName : undefined,
              affirmed: nextAffirmed,
            })
          }}
          label={t('forms.runner.signature.affirmation', {
            fallback: 'I have read and agree to the statement above.',
          })}
        />
      </div>
    </FieldShell>
  )
}

function asArrayOfRecords(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return []
  return value.map((entry) =>
    entry && typeof entry === 'object' && !Array.isArray(entry)
      ? (entry as Record<string, unknown>)
      : {},
  )
}

export const GroupRenderer: ComponentType<RunnerFieldRendererProps> = (props) => {
  const { value, onChange, disabled, fieldNode, field } = props
  const t = useT()
  const subFields: GroupSubFieldDescriptor[] = readGroupSubFields(fieldNode as Record<string, unknown>)
  const minItems = readGroupMinItems(fieldNode as Record<string, unknown>)
  const maxItems = readGroupMaxItems(fieldNode as Record<string, unknown>)
  const entries = asArrayOfRecords(value)

  const updateEntry = (index: number, subKey: string, next: unknown) => {
    const draft = entries.map((entry) => ({ ...entry }))
    if (next === undefined || next === null) {
      delete draft[index][subKey]
    } else {
      draft[index][subKey] = next
    }
    onChange(draft)
  }

  const addEntry = () => {
    onChange([...entries.map((entry) => ({ ...entry })), {}])
  }

  const removeEntry = (index: number) => {
    onChange(entries.filter((_, idx) => idx !== index))
  }

  const canAdd = !disabled && (maxItems === null || entries.length < maxItems)
  const canRemove = !disabled && entries.length > minItems

  return (
    <FieldShell {...props} sensitiveLabel={SENSITIVE_KEY}>
      <div className="flex flex-col gap-3">
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('forms.runner.group.empty', { fallback: 'No entries yet.' })}
          </p>
        ) : null}
        {entries.map((entry, index) => (
          <fieldset
            key={index}
            className="flex flex-col gap-3 rounded-md border border-border bg-muted/30 p-3"
          >
            <div className="flex items-center justify-between">
              <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('forms.runner.group.entry_label', {
                  fallback: 'Entry {{index}}',
                  index: index + 1,
                })}
              </legend>
              {canRemove ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeEntry(index)}
                  aria-label={t('forms.runner.group.remove', { fallback: 'Remove entry' })}
                >
                  <Trash2 aria-hidden="true" className="h-4 w-4" />
                </Button>
              ) : null}
            </div>
            {subFields.map((subField) => {
              const SubRenderer = getCoreRenderer(subField.type)
              if (!SubRenderer) return null
              const subInputId = `${props.inputId ?? field.key}-${index}-${subField.key}`
              const subDescriptor: RunnerFieldDescriptor = {
                key: subField.key,
                type: subField.type,
                sectionKey: field.sectionKey,
                sensitive: field.sensitive,
                editableBy: field.editableBy,
                visibleTo: field.visibleTo,
                required: subField.required,
              }
              return (
                <SubRenderer
                  key={subField.key}
                  field={subDescriptor}
                  fieldNode={subField.node as RunnerFieldNode}
                  value={entry[subField.key]}
                  onChange={(next) => updateEntry(index, subField.key, next)}
                  locale={props.locale}
                  defaultLocale={props.defaultLocale}
                  disabled={disabled}
                  inputId={subInputId}
                />
              )
            })}
          </fieldset>
        ))}
        {canAdd ? (
          <Button type="button" variant="outline" size="sm" onClick={addEntry}>
            <Plus aria-hidden="true" className="h-4 w-4" />
            <span className="ml-2">{t('forms.runner.group.add', { fallback: 'Add entry' })}</span>
          </Button>
        ) : null}
      </div>
    </FieldShell>
  )
}

export const CORE_RENDERER_MAP: Record<string, ComponentType<RunnerFieldRendererProps>> = {
  text: TextRenderer,
  textarea: TextareaRenderer,
  number: NumberRenderer,
  integer: IntegerRenderer,
  boolean: BooleanRenderer,
  date: DateRenderer,
  datetime: DatetimeRenderer,
  select_one: SelectOneRenderer,
  select_many: SelectManyRenderer,
  scale: ScaleRenderer,
  info_block: InfoBlockRenderer,
  file: FileRenderer,
  signature: SignatureRenderer,
  group: GroupRenderer,
}

export function registerCoreRenderers(registry: FieldTypeRegistry = defaultFieldTypeRegistry) {
  for (const [key, component] of Object.entries(CORE_RENDERER_MAP)) {
    registry.setRenderer(key, component as ComponentType<unknown>)
  }
}

export function getCoreRenderer(typeKey: string): ComponentType<RunnerFieldRendererProps> | null {
  return CORE_RENDERER_MAP[typeKey] ?? null
}
