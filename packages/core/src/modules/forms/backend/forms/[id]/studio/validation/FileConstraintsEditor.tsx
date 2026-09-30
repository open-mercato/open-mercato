'use client'

import * as React from 'react'
import { Input } from '@open-mercato/ui/primitives/input'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type FileConstraintsEditorProps = {
  accept: string[] | undefined
  maxSizeBytes: number | undefined
  multiple: boolean
  onAcceptChange: (next: string[]) => void
  onMaxSizeChange: (next: number | null) => void
  onMultipleChange: (next: boolean) => void
}

function parseAccept(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

function parseSizeMb(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  const parsed = Number.parseFloat(trimmed)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return Math.round(parsed * 1024 * 1024)
}

/**
 * W4 — file upload constraints editor. Lets authors restrict accepted MIME
 * types (comma-separated, `image/*` wildcards allowed), cap the size (MB), and
 * toggle multiple-file uploads. The server is always authoritative; these are
 * field-level hints persisted as `x-om-accept` / `x-om-max-size-bytes` /
 * `x-om-multiple`.
 */
export function FileConstraintsEditor({
  accept,
  maxSizeBytes,
  multiple,
  onAcceptChange,
  onMaxSizeChange,
  onMultipleChange,
}: FileConstraintsEditorProps) {
  const t = useT()
  const acceptValue = Array.isArray(accept) ? accept.join(', ') : ''
  const sizeMb = typeof maxSizeBytes === 'number' ? maxSizeBytes / (1024 * 1024) : undefined
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <label className="block text-xs font-medium text-muted-foreground">
          {t('forms.studio.field.file.accept')}
        </label>
        <Input
          type="text"
          placeholder="image/*, application/pdf"
          value={acceptValue}
          onChange={(event) => onAcceptChange(parseAccept(event.target.value))}
        />
      </div>
      <div className="space-y-1">
        <label className="block text-xs font-medium text-muted-foreground">
          {t('forms.studio.field.file.maxSizeMb')}
        </label>
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          step="0.1"
          value={typeof sizeMb === 'number' ? String(sizeMb) : ''}
          onChange={(event) => onMaxSizeChange(parseSizeMb(event.target.value))}
        />
      </div>
      <label className="flex items-center justify-between gap-2 text-sm">
        <span className="font-medium text-foreground">{t('forms.studio.field.file.multiple')}</span>
        <Switch checked={multiple} onCheckedChange={(next) => onMultipleChange(Boolean(next))} />
      </label>
    </div>
  )
}
