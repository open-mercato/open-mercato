'use client'

import * as React from 'react'
import { Input } from '@open-mercato/ui/primitives/input'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { Radio, RadioGroup } from '@open-mercato/ui/primitives/radio'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  FIELD_TYPE_DEFAULT_PATTERNS,
  FIELD_TYPE_PATTERN_LABEL_KEY,
} from '../../../../../schema/field-type-patterns'

export type PatternEditorProps = {
  fieldType: string
  pattern: string | undefined
  onChange: (next: string | null) => void
}

function isStandardPattern(fieldType: string, pattern: string | undefined): boolean {
  if (!pattern) return true
  const standard = FIELD_TYPE_DEFAULT_PATTERNS[fieldType]
  if (!standard) return false
  return standard === pattern
}

function isPatternValid(pattern: string): boolean {
  try {
    new RegExp(pattern)
    return true
  } catch {
    return false
  }
}

export function PatternEditor({ fieldType, pattern, onChange }: PatternEditorProps) {
  const t = useT()
  const standardPattern = FIELD_TYPE_DEFAULT_PATTERNS[fieldType]
  const standardLabelKey = FIELD_TYPE_PATTERN_LABEL_KEY[fieldType]
  const hasStandard = typeof standardPattern === 'string'
  const onStandard = hasStandard && isStandardPattern(fieldType, pattern)
  const customDraft = onStandard ? '' : pattern ?? ''
  const draftIsEmpty = customDraft.length === 0
  const draftIsValid = draftIsEmpty || isPatternValid(customDraft)

  const handleModeChange = React.useCallback(
    (next: string) => {
      if (next === 'standard') {
        if (hasStandard) onChange(null)
        else onChange(null)
        return
      }
      if (next === 'custom') {
        if (!pattern && hasStandard) {
          onChange(standardPattern)
        }
      }
    },
    [hasStandard, onChange, pattern, standardPattern],
  )

  const handleCustomInput = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value
      if (value.length === 0) {
        onChange(null)
        return
      }
      onChange(value)
    },
    [onChange],
  )

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          {t('forms.studio.validation.pattern.heading')}
        </span>
        {hasStandard && onStandard ? (
          <Tag variant="neutral">{t(standardLabelKey)}</Tag>
        ) : null}
      </div>
      {hasStandard ? (
        <RadioGroup
          value={onStandard ? 'standard' : 'custom'}
          onValueChange={handleModeChange}
          className="space-y-1"
        >
          <label className="flex items-center gap-2 text-sm">
            <Radio value="standard" />
            {t('forms.studio.validation.pattern.modeStandard')}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Radio value="custom" />
            {t('forms.studio.validation.pattern.modeCustom')}
          </label>
        </RadioGroup>
      ) : null}
      {!hasStandard || !onStandard ? (
        <div className="space-y-1">
          <Input
            value={customDraft}
            onChange={handleCustomInput}
            className="font-mono text-xs"
            placeholder={t('forms.studio.validation.pattern.customPlaceholder')}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
          {!draftIsValid ? (
            <Alert variant="destructive">
              <AlertDescription>
                {t('forms.studio.validation.pattern.invalid')}
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
