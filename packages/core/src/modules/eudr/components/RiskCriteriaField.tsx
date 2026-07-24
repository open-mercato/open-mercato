"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@open-mercato/ui/primitives/segmented-control'
import { EUDR_RISK_CRITERIA_GROUPS } from '../lib/reference-data'
import {
  EUDR_CRITERIA_ANSWERS,
  type EudrCriteriaAnswer,
} from '../data/validators'

export type RiskCriteriaEntry = {
  answer: EudrCriteriaAnswer
  note?: string | null
}

export type RiskCriteriaValue = Record<string, RiskCriteriaEntry>

export type RiskCriteriaFieldProps = {
  id: string
  value: unknown
  onChange: (value: RiskCriteriaValue) => void
  disabled?: boolean
}

const criteriaKeys = new Set<string>(
  EUDR_RISK_CRITERIA_GROUPS.flatMap((group) => [...group.criteria]),
)

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isCriteriaAnswer(value: unknown): value is EudrCriteriaAnswer {
  return typeof value === 'string' && EUDR_CRITERIA_ANSWERS.some((answer) => answer === value)
}

function normalizeCriteriaValue(value: unknown): RiskCriteriaValue {
  if (!isRecord(value)) return {}
  const normalized: RiskCriteriaValue = {}
  for (const [key, rawEntry] of Object.entries(value)) {
    if (!criteriaKeys.has(key) || !isRecord(rawEntry) || !isCriteriaAnswer(rawEntry.answer)) continue
    const note = typeof rawEntry.note === 'string' && rawEntry.note.trim().length > 0
      ? rawEntry.note
      : null
    normalized[key] = note ? { answer: rawEntry.answer, note } : { answer: rawEntry.answer }
  }
  return normalized
}

export function RiskCriteriaField({
  id,
  value,
  onChange,
  disabled,
}: RiskCriteriaFieldProps) {
  const translate = useT()
  const criteria = React.useMemo(() => normalizeCriteriaValue(value), [value])
  const total = criteriaKeys.size
  const answered = Object.keys(criteria).filter((key) => criteriaKeys.has(key)).length

  const updateAnswer = React.useCallback((criterionKey: string, answer: EudrCriteriaAnswer) => {
    const current = criteria[criterionKey]
    const next: RiskCriteriaValue = { ...criteria }
    const note = answer === 'concern' && current?.note ? current.note : null
    next[criterionKey] = note ? { answer, note } : { answer }
    onChange(next)
  }, [criteria, onChange])

  const updateNote = React.useCallback((criterionKey: string, note: string) => {
    const current = criteria[criterionKey]
    if (!current || current.answer !== 'concern') return
    const trimmed = note.trim()
    onChange({
      ...criteria,
      [criterionKey]: trimmed
        ? { answer: current.answer, note }
        : { answer: current.answer },
    })
  }, [criteria, onChange])

  return (
    <div id={id} className="space-y-5">
      <div className="text-sm text-muted-foreground">
        {translate('eudr.risk.criteria.answeredCount', { answered, total })}
      </div>
      {EUDR_RISK_CRITERIA_GROUPS.map((group) => (
        <section key={group.key} className="space-y-3">
          <h3 className="text-sm font-semibold">
            {translate(`eudr.risk.criteriaGroup.${group.key}`)}
          </h3>
          <div className="space-y-3">
            {group.criteria.map((criterionKey) => {
              const entry = criteria[criterionKey]
              const criterionId = `${id}-${criterionKey}`
              return (
                <div key={criterionKey} className="space-y-2 rounded-md border border-border bg-background p-3">
                  <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                    <Label htmlFor={criterionId} className="text-sm font-medium">
                      {translate(`eudr.risk.criteria.${criterionKey}`)}
                    </Label>
                    <SegmentedControl
                      id={criterionId}
                      value={entry?.answer}
                      onValueChange={(nextValue) => {
                        if (isCriteriaAnswer(nextValue)) updateAnswer(criterionKey, nextValue)
                      }}
                      disabled={disabled}
                      aria-label={translate(`eudr.risk.criteria.${criterionKey}`)}
                    >
                      {EUDR_CRITERIA_ANSWERS.map((answer) => (
                        <SegmentedControlItem
                          key={answer}
                          value={answer}
                          className={answer === 'concern'
                            ? 'data-[state=checked]:bg-status-warning-bg data-[state=checked]:text-status-warning-text'
                            : undefined}
                        >
                          {translate(`eudr.risk.criteriaAnswer.${answer}`)}
                        </SegmentedControlItem>
                      ))}
                    </SegmentedControl>
                  </div>
                  {entry?.answer === 'concern' ? (
                    <Input
                      value={entry.note ?? ''}
                      disabled={disabled}
                      placeholder={translate('eudr.risk.criteria.notePlaceholder')}
                      onChange={(event) => updateNote(criterionKey, event.target.value)}
                    />
                  ) : null}
                </div>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

export default RiskCriteriaField
