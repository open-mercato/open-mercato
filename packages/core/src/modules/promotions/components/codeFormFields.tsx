// Shared `CrudForm` config for the promotional-code create and detail pages (Release 4
// PLAN.md Step 6.6, SPEC-055 "Promotional Codes (`/backend/codes`)"). Mirrors
// `promotionFormFields.tsx`'s shape (schema/fields/groups builder functions consumed by
// both the create and detail pages) so the two code pages share one source of truth for
// field config, same as the `Promotion` entity's own create/detail pages.
//
// Field set per `promotionCodeCreateSchema` (`data/validators.ts`): `code` is
// static-only, `prefix`/`suffix`/`length`/`amount` are dynamic-only, `usageAmount` is
// required only when `usage === 'multiple'`. Visibility is driven by `CrudField.visibleWhen`
// (base-field conditional visibility already built into `CrudForm`) rather than a custom
// field component.

import { z } from 'zod'
import type { CrudField, CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import type { useT } from '@open-mercato/shared/lib/i18n/context'
import { promotionCodeTypeValues, promotionCodeUsageModeValues } from '../data/validators'

export type CodeFormValues = {
  name: string
  type: (typeof promotionCodeTypeValues)[number]
  code?: string | null
  prefix?: string | null
  suffix?: string | null
  length?: number | null
  amount?: number | null
  usage: (typeof promotionCodeUsageModeValues)[number]
  usageAmount?: number | null
  usagePerCustomer?: number | null
  active: boolean
}

type Translate = ReturnType<typeof useT>

export function createCodeFormSchema(t: Translate): z.ZodType<CodeFormValues> {
  return z
    .object({
      name: z.string().trim().min(1, t('promotions.codes.form.errors.nameRequired', 'Name is required')),
      type: z.enum(promotionCodeTypeValues),
      code: z.string().nullable().optional(),
      prefix: z.string().nullable().optional(),
      suffix: z.string().nullable().optional(),
      length: z.number().int().positive().nullable().optional(),
      amount: z.number().int().positive().nullable().optional(),
      usage: z.enum(promotionCodeUsageModeValues),
      usageAmount: z.number().int().positive().nullable().optional(),
      usagePerCustomer: z.number().int().positive().nullable().optional(),
      active: z.boolean(),
    })
    .superRefine((value, ctx) => {
      if (value.type === 'static' && !value.code?.trim()) {
        ctx.addIssue({
          code: 'custom',
          message: t('promotions.codes.form.errors.codeRequired', 'Code is required for a static code'),
          path: ['code'],
        })
      }
      if (value.type === 'dynamic' && !value.amount) {
        ctx.addIssue({
          code: 'custom',
          message: t('promotions.codes.form.errors.amountRequired', 'Pool size is required for a dynamic code'),
          path: ['amount'],
        })
      }
      if (value.usage === 'multiple' && value.usageAmount == null) {
        ctx.addIssue({
          code: 'custom',
          message: t('promotions.codes.form.errors.usageAmountRequired', 'Uses per code is required when usage is "Multiple uses"'),
          path: ['usageAmount'],
        })
      }
    })
}

export function createCodeFormFields(t: Translate): CrudField[] {
  return [
    { id: 'name', label: t('promotions.codes.form.fields.name', 'Name'), type: 'text', required: true },
    {
      id: 'type',
      label: t('promotions.codes.form.fields.type', 'Code type'),
      type: 'select',
      required: true,
      options: [
        { value: 'static', label: t('promotions.codes.form.fields.type.static', 'Static — one shared code') },
        { value: 'dynamic', label: t('promotions.codes.form.fields.type.dynamic', 'Dynamic — a generated pool of codes') },
      ],
    },
    {
      id: 'code',
      label: t('promotions.codes.form.fields.code', 'Code'),
      type: 'text',
      required: true,
      visibleWhen: { field: 'type', equals: 'static' },
      description: t('promotions.codes.form.fields.code.description', 'The exact code buyers enter at checkout.'),
    },
    {
      id: 'prefix',
      label: t('promotions.codes.form.fields.prefix', 'Prefix'),
      type: 'text',
      layout: 'half',
      visibleWhen: { field: 'type', equals: 'dynamic' },
    },
    {
      id: 'suffix',
      label: t('promotions.codes.form.fields.suffix', 'Suffix'),
      type: 'text',
      layout: 'half',
      visibleWhen: { field: 'type', equals: 'dynamic' },
    },
    {
      id: 'length',
      label: t('promotions.codes.form.fields.length', 'Generated code length'),
      type: 'number',
      layout: 'half',
      visibleWhen: { field: 'type', equals: 'dynamic' },
    },
    {
      id: 'amount',
      label: t('promotions.codes.form.fields.amount', 'Pool size'),
      type: 'number',
      required: true,
      layout: 'half',
      visibleWhen: { field: 'type', equals: 'dynamic' },
      description: t('promotions.codes.form.fields.amount.description', 'How many codes the generator should fill the pool to.'),
    },
    {
      id: 'usage',
      label: t('promotions.codes.form.fields.usage', 'Usage'),
      type: 'select',
      required: true,
      options: [
        { value: 'single', label: t('promotions.codes.form.fields.usage.single', 'Single use') },
        { value: 'multiple', label: t('promotions.codes.form.fields.usage.multiple', 'Multiple uses') },
        { value: 'unlimited', label: t('promotions.codes.form.fields.usage.unlimited', 'Unlimited') },
      ],
    },
    {
      id: 'usageAmount',
      label: t('promotions.codes.form.fields.usageAmount', 'Uses per code'),
      type: 'number',
      required: true,
      layout: 'half',
      visibleWhen: { field: 'usage', equals: 'multiple' },
    },
    {
      id: 'usagePerCustomer',
      label: t('promotions.codes.form.fields.usagePerCustomer', 'Uses per customer'),
      type: 'number',
      layout: 'half',
      description: t('promotions.codes.form.fields.usagePerCustomer.description', 'Leave empty for no per-customer limit.'),
    },
    { id: 'active', label: t('promotions.codes.form.fields.active', 'Active'), type: 'checkbox' },
  ]
}

export function createCodeFormGroups(t: Translate): CrudFormGroup[] {
  return [
    {
      id: 'details',
      title: t('promotions.codes.form.panels.details', 'Details'),
      column: 1,
      fields: ['name', 'type', 'code', 'prefix', 'suffix', 'length', 'amount'],
    },
    {
      id: 'usage',
      title: t('promotions.codes.form.panels.usage', 'Usage'),
      column: 2,
      fields: ['usage', 'usageAmount', 'usagePerCustomer', 'active'],
    },
  ]
}
