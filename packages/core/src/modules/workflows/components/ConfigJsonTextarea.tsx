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
    try {
      const parsed = JSON.parse(nextText) as Record<string, unknown>
      setIsInvalid(false)
      onChange(parsed)
    } catch {
      setIsInvalid(true)
    }
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
      />
      {isInvalid && (
        <p className="text-xs text-status-error-text mt-1">
          {t('workflows.fieldEditors.activities.invalidJson')}
        </p>
      )}
    </div>
  )
}
