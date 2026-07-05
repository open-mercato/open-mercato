"use client"

import * as React from 'react'
import type { CrudField, CrudFieldOption, CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { CLAIM_TYPES } from '../../../data/validators'
import {
  parseGuideSteps,
  type TroubleshootingNode,
} from '../../../lib/troubleshooting'

export type TroubleshootingGuideRecord = {
  id: string
  title: string | null
  claimType: string | null
  reasonCode: string | null
  steps: TroubleshootingNode | null
  isActive: boolean
  updatedAt: string | null
}

export type TroubleshootingGuideFormValues = Partial<Omit<TroubleshootingGuideRecord, 'claimType' | 'steps'>> & {
  claimType?: string | null
  stepsJson?: string | null
} & Record<string, unknown>

const CLAIM_TYPE_ANY = 'any'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length ? value.trim() : null
}

function nullableText(value: unknown): string | null {
  return toStringOrNull(value)
}

function parseStepsJson(value: unknown, t: TranslateFn): TroubleshootingNode | null {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    const message = t('warranty_claims.troubleshootingGuides.form.stepsJson.invalidJson', 'Enter valid JSON for the troubleshooting steps.')
    throw createCrudFormError(message, { stepsJson: message })
  }

  const steps = parseGuideSteps(parsed)
  if (!steps) {
    const message = t('warranty_claims.troubleshootingGuides.form.stepsJson.invalidTree', 'The steps JSON must contain a prompt and option branches with labels.')
    throw createCrudFormError(message, { stepsJson: message })
  }
  return steps
}

function stepsToJson(steps: TroubleshootingNode | null): string {
  return steps ? JSON.stringify(steps, null, 2) : ''
}

function createSwitchField(
  label: string,
  enabledLabel: string,
  disabledLabel: string,
): CrudField {
  return {
    id: 'isActive',
    label,
    type: 'custom',
    component: ({ value, setValue, disabled }) => {
      const checked = value !== false
      return (
        <div className="flex items-center gap-3">
          <Switch
            aria-label={label}
            checked={checked}
            disabled={disabled}
            onCheckedChange={(next) => setValue(next)}
          />
          <span className="text-sm text-muted-foreground">
            {checked ? enabledLabel : disabledLabel}
          </span>
        </div>
      )
    },
  }
}

export function claimTypeLabel(value: string | null, t: TranslateFn): string {
  if (!value || value === CLAIM_TYPE_ANY) return t('warranty_claims.troubleshootingGuides.claimType.any', 'Any claim type')
  if (value === 'warranty') return t('warranty_claims.claimTypes.warranty', 'Warranty')
  if (value === 'return') return t('warranty_claims.claimTypes.return', 'Return')
  if (value === 'core_return') return t('warranty_claims.claimTypes.coreReturn', 'Core return')
  if (value === 'vendor_recovery') return t('warranty_claims.claimTypes.vendorRecovery', 'Vendor recovery')
  return value
}

export function activeLabel(value: boolean, t: TranslateFn): string {
  return value
    ? t('warranty_claims.troubleshootingGuides.status.active', 'Active')
    : t('warranty_claims.troubleshootingGuides.status.inactive', 'Inactive')
}

export function normalizeTroubleshootingGuide(value: unknown): TroubleshootingGuideRecord | null {
  if (!isRecord(value)) return null
  const id = toStringOrNull(value.id)
  if (!id) return null
  return {
    id,
    title: toStringOrNull(value.title),
    claimType: toStringOrNull(value.claimType),
    reasonCode: toStringOrNull(value.reasonCode),
    steps: parseGuideSteps(value.steps),
    isActive: value.isActive !== false,
    updatedAt: toStringOrNull(value.updatedAt),
  }
}

export function toTroubleshootingGuideInitialValues(
  guide: TroubleshootingGuideRecord,
): TroubleshootingGuideFormValues {
  return {
    ...guide,
    claimType: guide.claimType ?? CLAIM_TYPE_ANY,
    stepsJson: stepsToJson(guide.steps),
  }
}

export function buildTroubleshootingGuidePayload(
  values: TroubleshootingGuideFormValues,
  t: TranslateFn,
  id?: string,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  if (id) payload.id = id
  const claimType = toStringOrNull(values.claimType)
  payload.title = nullableText(values.title) ?? ''
  payload.claimType = claimType && claimType !== CLAIM_TYPE_ANY ? claimType : null
  payload.reasonCode = nullableText(values.reasonCode)
  payload.steps = parseStepsJson(values.stepsJson, t)
  payload.isActive = values.isActive !== false
  return payload
}

export function useTroubleshootingGuideFormConfig(t: TranslateFn): { fields: CrudField[]; groups: CrudFormGroup[] } {
  const claimTypeOptions = React.useMemo<CrudFieldOption[]>(() => [
    { value: CLAIM_TYPE_ANY, label: claimTypeLabel(null, t) },
    ...CLAIM_TYPES.map((value) => ({ value, label: claimTypeLabel(value, t) })),
  ], [t])

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'title',
      label: t('warranty_claims.troubleshootingGuides.form.title', 'Title'),
      type: 'text',
      required: true,
    },
    {
      id: 'claimType',
      label: t('warranty_claims.troubleshootingGuides.form.claimType', 'Claim type'),
      type: 'select',
      options: claimTypeOptions,
    },
    {
      id: 'reasonCode',
      label: t('warranty_claims.troubleshootingGuides.form.reasonCode', 'Reason code'),
      type: 'text',
      description: t('warranty_claims.troubleshootingGuides.form.reasonCode.help', 'Leave empty to match any reason.'),
    },
    createSwitchField(
      t('warranty_claims.troubleshootingGuides.form.isActive', 'Active'),
      t('warranty_claims.troubleshootingGuides.form.isActive.enabled', 'Guide active'),
      t('warranty_claims.troubleshootingGuides.form.isActive.disabled', 'Guide inactive'),
    ),
    {
      id: 'stepsJson',
      label: t('warranty_claims.troubleshootingGuides.form.stepsJson', 'Steps JSON'),
      type: 'textarea',
      rows: 16,
      layout: 'full',
      description: t('warranty_claims.troubleshootingGuides.form.stepsJson.help', 'Use a prompt with options. Each option needs a label and either a next node or a resolution/reason code.'),
    },
  ], [claimTypeOptions, t])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'match',
      title: t('warranty_claims.troubleshootingGuides.form.group.match', 'Guide match'),
      fields: ['title', 'claimType', 'reasonCode', 'isActive'],
    },
    {
      id: 'steps',
      title: t('warranty_claims.troubleshootingGuides.form.group.steps', 'Decision tree'),
      fields: ['stepsJson'],
    },
  ], [t])

  return { fields, groups }
}
