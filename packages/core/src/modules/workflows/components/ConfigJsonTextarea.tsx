"use client"

import * as React from 'react'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { useT } from '@open-mercato/shared/lib/i18n/context'

interface ConfigJsonTextareaProps {
  id: string
  value: Record<string, unknown> | undefined
  onChange: (config: Record<string, unknown>) => void
  onValidityChange?: (valid: boolean) => void
  rows?: number
  placeholder?: string
  className?: string
}

export function ConfigJsonTextarea({
  id,
  value,
  onChange,
  onValidityChange,
  rows = 3,
  placeholder = '{"key": "value"}',
  className,
}: ConfigJsonTextareaProps) {
  const t = useT()
  const serialized = React.useMemo(() => JSON.stringify(value ?? {}, null, 2), [value])
  const [text, setText] = React.useState(serialized)
  const [isInvalid, setIsInvalid] = React.useState(false)
  const [errorKind, setErrorKind] = React.useState<'syntax' | 'not-object'>('syntax')
  const isFocusedRef = React.useRef(false)
  const lastSerializedRef = React.useRef(serialized)
  const onValidityChangeRef = React.useRef(onValidityChange)

  React.useEffect(() => {
    onValidityChangeRef.current = onValidityChange
  }, [onValidityChange])

  React.useEffect(() => {
    onValidityChangeRef.current?.(!isInvalid)
  }, [isInvalid])

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
    let parsed: unknown
    try {
      parsed = JSON.parse(nextText)
    } catch {
      setIsInvalid(true)
      setErrorKind('syntax')
      return
    }
    // Valid JSON is not necessarily a valid config: an array or a scalar parses
    // cleanly but breaks every `config.<key>` lookup downstream, so it is
    // refused here rather than written into the activity.
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      setIsInvalid(true)
      setErrorKind('not-object')
      return
    }
    setIsInvalid(false)
    // Adopt the value we are about to emit as the baseline, so the round trip
    // through the parent does not overwrite the user's raw text with a
    // re-serialized copy — that reformat-on-every-keystroke is what made a
    // pasted config feel uneditable (#4234).
    lastSerializedRef.current = JSON.stringify(parsed, null, 2)
    onChange(parsed as Record<string, unknown>)
  }

  const handleFocus = () => {
    isFocusedRef.current = true
  }

  const handleBlur = () => {
    isFocusedRef.current = false
    if (!isInvalid) setText(serialized)
  }

  return (
    <div>
      <Textarea
        id={id}
        value={text}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder={placeholder}
        rows={rows}
        className={className}
        aria-invalid={isInvalid || undefined}
        aria-describedby={isInvalid ? `${id}-error` : undefined}
      />
      {isInvalid && (
        <p id={`${id}-error`} role="alert" className="text-xs text-status-error-text mt-1">
          {errorKind === 'not-object'
            ? t('workflows.activities.configMustBeObject', 'Config must be a JSON object')
            : t('workflows.fieldEditors.activities.invalidJson')}
        </p>
      )}
    </div>
  )
}
