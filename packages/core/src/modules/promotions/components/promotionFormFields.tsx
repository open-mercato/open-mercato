// Shared Info/Settings/Exclusions panel config for the promotion create and detail
// pages (Step 1.7, SPEC-055 §UI/UX "Promotion Form"). Rev 9 dropped the unbacked
// "promotional-price-visibility toggle" — the real control lives in the Exclusions
// panel below as the `exclude_promotional_prices` flag inside `exclude_flags`. No
// fourth panel/toggle exists; the fourth spec panel ("Rules & Benefits") is the
// `RuleTreeBuilder` tree editor, rendered separately from this `CrudForm` config (see
// `backend/promotions/[id]/page.tsx`).

import { z } from 'zod'
import type { CrudField, CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import type { useT } from '@open-mercato/shared/lib/i18n/context'

export type PromotionFormValues = {
  name: string
  description?: string | null
  startsAt?: string | null
  endsAt?: string | null
  active: boolean
  cumulative: boolean
  tags: string[]
  excludedTags: string[]
  excludeFlags: { excludePromotionalPrices?: boolean }
}

type Translate = ReturnType<typeof useT>

export function createPromotionFormSchema(t: Translate): z.ZodType<PromotionFormValues> {
  return z
    .object({
      name: z.string().trim().min(1, t('promotions.form.errors.nameRequired', 'Name is required')),
      description: z.string().nullable().optional(),
      startsAt: z.string().nullable().optional(),
      endsAt: z.string().nullable().optional(),
      active: z.boolean(),
      cumulative: z.boolean(),
      tags: z.array(z.string()),
      excludedTags: z.array(z.string()),
      excludeFlags: z.object({ excludePromotionalPrices: z.boolean().optional() }),
    })
    .superRefine((value, ctx) => {
      if (value.startsAt && value.endsAt && new Date(value.startsAt).getTime() > new Date(value.endsAt).getTime()) {
        ctx.addIssue({
          code: 'custom',
          message: t('promotions.form.errors.endBeforeStart', 'End date must be on or after the start date'),
          path: ['endsAt'],
        })
      }
    })
}

export function createPromotionFormFields(t: Translate): CrudField[] {
  return [
    { id: 'name', label: t('promotions.form.fields.name', 'Name'), type: 'text', required: true },
    { id: 'description', label: t('promotions.form.fields.description', 'Description'), type: 'textarea', rows: 3 },
    { id: 'startsAt', label: t('promotions.form.fields.startsAt', 'Starts at'), type: 'datepicker', layout: 'half' },
    { id: 'endsAt', label: t('promotions.form.fields.endsAt', 'Ends at'), type: 'datepicker', layout: 'half' },
    { id: 'active', label: t('promotions.form.fields.active', 'Active'), type: 'checkbox' },
    { id: 'cumulative', label: t('promotions.form.fields.cumulative', 'Cumulative'), type: 'checkbox' },
    {
      id: 'tags',
      label: t('promotions.form.fields.tags', 'Tags'),
      type: 'tags',
      placeholder: t('promotions.form.fields.tagsPlaceholder', 'Add a tag...'),
    },
    {
      id: 'excludedTags',
      label: t('promotions.form.fields.excludedTags', 'Excluded tags'),
      type: 'tags',
      placeholder: t('promotions.form.fields.excludedTagsPlaceholder', 'Add an excluded tag...'),
    },
    {
      id: 'excludeFlags.excludePromotionalPrices',
      label: t('promotions.form.fields.excludePromotionalPrices', 'Exclude items already on a promotional price'),
      description: t(
        'promotions.form.fields.excludePromotionalPrices.description',
        'Skip items whose unit price already comes from a promotional catalog price.',
      ),
      type: 'checkbox',
    },
  ]
}

export function createPromotionFormGroups(t: Translate): CrudFormGroup[] {
  return [
    {
      id: 'info',
      title: t('promotions.form.panels.info', 'Info'),
      column: 1,
      fields: ['name', 'description', 'startsAt', 'endsAt'],
    },
    {
      id: 'settings',
      title: t('promotions.form.panels.settings', 'Settings'),
      column: 2,
      fields: ['active', 'cumulative', 'tags', 'excludedTags'],
    },
    {
      id: 'exclusions',
      title: t('promotions.form.panels.exclusions', 'Exclusions'),
      column: 1,
      fields: ['excludeFlags.excludePromotionalPrices'],
    },
  ]
}
