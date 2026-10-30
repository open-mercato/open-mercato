// Shared Info/Settings/Exclusions panel config for the promotion create and detail
// pages (Step 1.7, SPEC-055 §UI/UX "Promotion Form"). Rev 9 dropped the unbacked
// "promotional-price-visibility toggle" — the real control lives in the Exclusions
// panel below as the `exclude_promotional_prices` flag inside `exclude_flags`. No
// fourth panel/toggle exists; the fourth spec panel ("Rules & Benefits") is the
// `RuleTreeBuilder` tree editor, rendered separately from this `CrudForm` config (see
// `backend/promotions/[id]/page.tsx`).

import { z } from 'zod'
import type { CrudField, CrudFieldOption, CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
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
  // Empty array means "all currencies" (mirrors `data/validators.ts`'s
  // `promotionBaseShape.eligibleCurrencies` comment) — required to be exactly
  // one entry whenever the rule tree holds an order_value/row_total rule or a
  // fixed-amount/tiered_discount benefit (D-R4-27, enforced server-side).
  eligibleCurrencies: string[]
  maxBudget?: string | null
  budgetCurrency?: string | null
}

type Translate = ReturnType<typeof useT>

type CurrencyOptionsResponse = { items?: { value: string; label: string }[] }

// Mirrors `catalog/components/prices/PriceScopeSelectors.tsx`'s `PriceCurrencySelect` —
// the `currencies` module's own `/api/currencies/currencies/options` contract is the
// established cross-module pattern for currency pickers (an FK-id reference over HTTP,
// never a direct import of the `currencies` module — see `packages/core/AGENTS.md` §
// Architecture and `catalog/__tests__/no-customers-import.test.ts`'s header comment for
// why a sibling module built its own currency source instead of importing another
// domain module directly).
async function loadCurrencyOptions(): Promise<CrudFieldOption[]> {
  const call = await apiCall<CurrencyOptionsResponse>(
    '/api/currencies/currencies/options?limit=100',
    undefined,
    { fallback: { items: [] } },
  )
  const items = Array.isArray(call.result?.items) ? call.result.items : []
  return items.map((item) => ({ value: item.value, label: item.label }))
}

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
      eligibleCurrencies: z.array(z.string()),
      maxBudget: z.string().nullable().optional(),
      budgetCurrency: z.string().nullable().optional(),
    })
    .superRefine((value, ctx) => {
      if (value.startsAt && value.endsAt && new Date(value.startsAt).getTime() > new Date(value.endsAt).getTime()) {
        ctx.addIssue({
          code: 'custom',
          message: t('promotions.form.errors.endBeforeStart', 'End date must be on or after the start date'),
          path: ['endsAt'],
        })
      }
      // Mirrors `promotionBudgetAndWindowRefine` in `data/validators.ts` — keep both in
      // sync so the client surfaces this 422 as a field error instead of a round trip.
      if (value.maxBudget != null && value.maxBudget !== '' && !value.budgetCurrency) {
        ctx.addIssue({
          code: 'custom',
          message: t('promotions.form.errors.budgetCurrencyRequired', 'Currency is required when a max budget is set'),
          path: ['budgetCurrency'],
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
      id: 'eligibleCurrencies',
      label: t('promotions.form.fields.eligibleCurrencies', 'Eligible currencies'),
      description: t(
        'promotions.form.fields.eligibleCurrencies.description',
        'Leave empty to allow every currency. Exactly one currency is required once a rule or benefit depends on a fixed amount (D-R4-27).',
      ),
      type: 'select',
      multiple: true,
      listbox: true,
      loadOptions: loadCurrencyOptions,
    },
    {
      id: 'maxBudget',
      label: t('promotions.form.fields.maxBudget', 'Max budget'),
      description: t(
        'promotions.form.fields.maxBudget.description',
        'Optional spend cap for this promotion. Setting it requires a budget currency.',
      ),
      type: 'text',
      layout: 'half',
    },
    {
      id: 'budgetCurrency',
      label: t('promotions.form.fields.budgetCurrency', 'Budget currency'),
      type: 'select',
      layout: 'half',
      loadOptions: loadCurrencyOptions,
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
      fields: ['active', 'cumulative', 'tags', 'excludedTags', 'eligibleCurrencies', 'maxBudget', 'budgetCurrency'],
    },
    {
      id: 'exclusions',
      title: t('promotions.form.panels.exclusions', 'Exclusions'),
      column: 1,
      fields: ['excludeFlags.excludePromotionalPrices'],
    },
  ]
}
