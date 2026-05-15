'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { FieldNode } from '../schema-helpers'
import { PatternEditor } from './PatternEditor'
import { LengthRangeEditor } from './LengthRangeEditor'
import { NumberRangeEditor } from './NumberRangeEditor'
import { MessageOverridesEditor, type MessageOverrideRule } from './MessageOverridesEditor'
import { NpsAnchorsEditor } from './NpsAnchorsEditor'
import { OpinionIconSelect, type OpinionIconValue } from './OpinionIconSelect'
import { RankingExhaustiveSwitch } from './RankingExhaustiveSwitch'
import { MatrixRowsEditor } from './MatrixRowsEditor'
import { MatrixColumnsEditor } from './MatrixColumnsEditor'
import type { OmMatrixColumnInput, OmMatrixRowInput } from '../schema-helpers'

export type ValidationPanelProps = {
  fieldKey: string
  fieldType: string
  node: FieldNode
  locale: string
  onPatternChange: (next: string | null) => void
  onLengthRangeChange: (next: { min?: number | null; max?: number | null }) => void
  onNumberRangeChange: (next: { min?: number | null; max?: number | null }) => void
  onMessageChange: (next: { rule: string; message: string | null }) => void
  onOpinionIconChange?: (next: OpinionIconValue) => void
  onNpsAnchorChange?: (next: { anchor: 'low' | 'high'; label: string | null }) => void
  onRankingExhaustiveChange?: (next: boolean) => void
  onMatrixRowsChange?: (next: OmMatrixRowInput[]) => void
  onMatrixColumnsChange?: (next: OmMatrixColumnInput[]) => void
}

const STRING_TEXTUAL_TYPES: ReadonlySet<string> = new Set([
  'text',
  'textarea',
  'email',
  'phone',
  'website',
])

const NUMERIC_RANGE_TYPES: ReadonlySet<string> = new Set([
  'number',
  'integer',
  'scale',
  'nps',
  'opinion_scale',
])

function readNumber(node: FieldNode, key: string): number | undefined {
  const raw = (node as Record<string, unknown>)[key]
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined
}

function readString(node: FieldNode, key: string): string | undefined {
  const raw = (node as Record<string, unknown>)[key]
  return typeof raw === 'string' ? raw : undefined
}

function readMessages(node: FieldNode): { [locale: string]: { [rule: string]: string } } | undefined {
  const raw = node['x-om-validation-messages']
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  return raw
}

function readOpinionIcon(node: FieldNode): OpinionIconValue {
  const raw = (node as Record<string, unknown>)['x-om-opinion-icon']
  if (raw === 'star' || raw === 'dot' || raw === 'thumb') return raw
  return 'dot'
}

function readMatrixRows(node: FieldNode): OmMatrixRowInput[] {
  const raw = (node as Record<string, unknown>)['x-om-matrix-rows']
  if (!Array.isArray(raw)) return []
  return raw.map((entry) => {
    const candidate = entry as Record<string, unknown>
    const row: OmMatrixRowInput = {
      key: typeof candidate.key === 'string' ? candidate.key : '',
      label:
        candidate.label && typeof candidate.label === 'object' && !Array.isArray(candidate.label)
          ? { ...(candidate.label as Record<string, string>) }
          : {},
    }
    if (typeof candidate.multiple === 'boolean') row.multiple = candidate.multiple
    if (typeof candidate.required === 'boolean') row.required = candidate.required
    return row
  })
}

function readMatrixColumns(node: FieldNode): OmMatrixColumnInput[] {
  const raw = (node as Record<string, unknown>)['x-om-matrix-columns']
  if (!Array.isArray(raw)) return []
  return raw.map((entry) => {
    const candidate = entry as Record<string, unknown>
    return {
      value: typeof candidate.value === 'string' ? candidate.value : '',
      label:
        candidate.label && typeof candidate.label === 'object' && !Array.isArray(candidate.label)
          ? { ...(candidate.label as Record<string, string>) }
          : {},
    }
  })
}

function readNpsAnchor(node: FieldNode, anchor: 'low' | 'high', locale: string): string {
  const raw = (node as Record<string, unknown>)['x-om-nps-anchors']
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ''
  const target = (raw as Record<string, unknown>)[anchor]
  if (!target || typeof target !== 'object' || Array.isArray(target)) return ''
  const value = (target as Record<string, unknown>)[locale]
  return typeof value === 'string' ? value : ''
}

export function ValidationPanel({
  fieldType,
  node,
  locale,
  onPatternChange,
  onLengthRangeChange,
  onNumberRangeChange,
  onMessageChange,
  onOpinionIconChange,
  onNpsAnchorChange,
  onRankingExhaustiveChange,
  onMatrixRowsChange,
  onMatrixColumnsChange,
}: ValidationPanelProps) {
  const t = useT()
  const showPattern = STRING_TEXTUAL_TYPES.has(fieldType)
  const showLength = STRING_TEXTUAL_TYPES.has(fieldType)
  const showRange = NUMERIC_RANGE_TYPES.has(fieldType)
  const showOpinionIcon = fieldType === 'opinion_scale' && Boolean(onOpinionIconChange)
  const showNpsAnchors = fieldType === 'nps' && Boolean(onNpsAnchorChange)
  const showRankingExhaustive = fieldType === 'ranking' && Boolean(onRankingExhaustiveChange)
  const rankingExhaustive = (node as Record<string, unknown>)['x-om-ranking-exhaustive'] === true
  const showMatrix = fieldType === 'matrix' && Boolean(onMatrixRowsChange) && Boolean(onMatrixColumnsChange)

  const applicableRules = React.useMemo<MessageOverrideRule[]>(() => {
    const rules: MessageOverrideRule[] = []
    if (showPattern) rules.push('pattern')
    if (showLength) {
      rules.push('minLength')
      rules.push('maxLength')
    }
    if (showRange) {
      rules.push('minValue')
      rules.push('maxValue')
    }
    return rules
  }, [showPattern, showLength, showRange])

  if (
    !showPattern
    && !showLength
    && !showRange
    && !showOpinionIcon
    && !showNpsAnchors
    && !showRankingExhaustive
    && !showMatrix
  ) {
    return null
  }

  return (
    <div className="space-y-3 rounded-md border border-border bg-card p-3">
      <span className="block text-sm font-semibold text-foreground">
        {t('forms.studio.validation.heading')}
      </span>
      {showPattern ? (
        <PatternEditor
          fieldType={fieldType}
          pattern={readString(node, 'x-om-pattern')}
          onChange={onPatternChange}
        />
      ) : null}
      {showLength ? (
        <LengthRangeEditor
          min={readNumber(node, 'x-om-min-length')}
          max={readNumber(node, 'x-om-max-length')}
          onChange={onLengthRangeChange}
        />
      ) : null}
      {showRange ? (
        <NumberRangeEditor
          min={readNumber(node, 'x-om-min')}
          max={readNumber(node, 'x-om-max')}
          onChange={onNumberRangeChange}
        />
      ) : null}
      {showOpinionIcon && onOpinionIconChange ? (
        <OpinionIconSelect
          value={readOpinionIcon(node)}
          onChange={onOpinionIconChange}
        />
      ) : null}
      {showNpsAnchors && onNpsAnchorChange ? (
        <NpsAnchorsEditor
          locale={locale}
          low={readNpsAnchor(node, 'low', locale)}
          high={readNpsAnchor(node, 'high', locale)}
          onChange={onNpsAnchorChange}
        />
      ) : null}
      {showRankingExhaustive && onRankingExhaustiveChange ? (
        <RankingExhaustiveSwitch
          value={rankingExhaustive}
          onChange={onRankingExhaustiveChange}
        />
      ) : null}
      {showMatrix && onMatrixRowsChange ? (
        <MatrixRowsEditor
          locale={locale}
          rows={readMatrixRows(node)}
          onChange={onMatrixRowsChange}
        />
      ) : null}
      {showMatrix && onMatrixColumnsChange ? (
        <MatrixColumnsEditor
          locale={locale}
          columns={readMatrixColumns(node)}
          onChange={onMatrixColumnsChange}
        />
      ) : null}
      <MessageOverridesEditor
        locale={locale}
        applicableRules={applicableRules}
        messages={readMessages(node)}
        onChange={onMessageChange}
      />
    </div>
  )
}
