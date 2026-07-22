"use client"

import * as React from 'react'
import { FileJson, Upload } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { validatePlotGeometry, type GeometryValidationResult } from '../lib/geometry'
import { PlotMapPreview } from './PlotMapPreview'

export type GeometryInputProps = {
  id: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}

type ParsedGeometryState =
  | { state: 'empty' }
  | { state: 'invalid'; errorKey: string }
  | { state: 'valid'; result: Extract<GeometryValidationResult, { ok: true }> }

export async function readJsonFileText(file: File): Promise<string> {
  return file.text()
}

export function parseGeometryText(raw: string): unknown | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  return JSON.parse(trimmed)
}

function validateGeometryText(raw: string): ParsedGeometryState {
  const trimmed = raw.trim()
  if (!trimmed) return { state: 'empty' }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return { state: 'invalid', errorKey: 'geometryInvalid' }
  }
  const result = validatePlotGeometry(parsed)
  if (!result.ok) return { state: 'invalid', errorKey: result.errorKey }
  return { state: 'valid', result }
}

function formatArea(value: number | null): string {
  if (value === null) return ''
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(value)
}

export function GeometryInput({
  id,
  value,
  onChange,
  disabled,
}: GeometryInputProps) {
  const translate = useT()
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const [showTextarea, setShowTextarea] = React.useState(() => value.trim().length > 0)
  const validation = React.useMemo(() => validateGeometryText(value), [value])

  React.useEffect(() => {
    if (value.trim().length > 0) setShowTextarea(true)
  }, [value])

  const handleFile = React.useCallback(async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    const text = await readJsonFileText(file)
    onChange(text)
  }, [onChange])

  return (
    <div id={id} className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
        >
          <Upload className="size-4" aria-hidden="true" />
          {translate('eudr.plots.geometry.upload')}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => setShowTextarea((current) => !current)}
          disabled={disabled}
        >
          <FileJson className="size-4" aria-hidden="true" />
          {translate('eudr.plots.geometry.togglePaste')}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept=".json,.geojson,application/json,application/geo+json"
          disabled={disabled}
          onChange={(event) => {
            void handleFile(event.target.files)
            event.target.value = ''
          }}
        />
      </div>

      {showTextarea ? (
        <Textarea
          value={value}
          disabled={disabled}
          rows={10}
          placeholder={translate('eudr.plots.geometry.placeholder')}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : null}

      {validation.state === 'empty' ? (
        <div className="rounded-md border border-dashed border-border/70 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          {translate('eudr.plots.geometry.empty')}
        </div>
      ) : null}

      {validation.state === 'invalid' ? (
        <div className="rounded-md border border-status-error-border bg-status-error-bg px-3 py-2 text-sm text-status-error-text">
          {translate(`eudr.errors.${validation.errorKey}`)}
        </div>
      ) : null}

      {validation.state === 'valid' ? (
        <div className="space-y-3">
          <div className="rounded-md border border-status-success-border bg-status-success-bg px-3 py-2 text-sm text-status-success-text">
            <div className="font-medium">
              {translate('eudr.plots.geometry.valid', {
                type: translate(`eudr.plotType.${validation.result.plotType}`),
              })}
            </div>
            {validation.result.computedAreaHa !== null ? (
              <div>
                {translate('eudr.plots.geometry.computedArea', {
                  area: formatArea(validation.result.computedAreaHa),
                })}
              </div>
            ) : null}
            {validation.result.warnings.includes('low_precision') ? (
              <div className="mt-1 text-status-warning-text">
                {translate('eudr.errors.low_precision')}
              </div>
            ) : null}
          </div>
          <PlotMapPreview features={[validation.result.feature]} />
        </div>
      ) : null}
    </div>
  )
}

export default GeometryInput
