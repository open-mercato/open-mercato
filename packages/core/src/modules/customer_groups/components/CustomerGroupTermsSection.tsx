"use client"

import * as React from 'react'
import { z } from 'zod'
import { FileText } from 'lucide-react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Button } from '@open-mercato/ui/primitives/button'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { LookupMultiPicker } from '@open-mercato/ui/backend/inputs/LookupPickers'
import type { LookupSource } from '@open-mercato/ui/backend/inputs/lookupSources'
import {
  categoryLookupSource,
  productLookupSource,
  tagLookupSource,
} from '@open-mercato/core/modules/catalog/components/lookupSources'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  decimalToString,
  isDecimalInput,
  isNegativeDecimal,
  resolveExactDecimal,
} from '@open-mercato/shared/lib/decimal'
import { CustomerGroupTermsPriceKindField } from './CustomerGroupTermsPriceKindField'
import {
  buildAssortmentScopePayload,
  mapAssortmentScopeToFormValues,
  type AssortmentScopeField,
  type AssortmentScopeFormValues,
  type GroupAssortmentScope,
} from './customerGroupAssortmentScope'

export type CustomerGroupTermsDTO = {
  id: string
  groupId: string
  organizationId: string | null
  tenantId: string
  priceKindId: string | null
  paymentTermsDays: number | null
  allowPurchaseOnAccount: boolean | null
  defaultCreditLimit: number | null
  defaultCreditLimitExact?: string | null
  creditCurrencyCode: string | null
  approvalRequiredAbove: number | null
  approvalRequiredAboveExact?: string | null
  minOrderValue: number | null
  minOrderValueExact?: string | null
  termsCurrencyCode?: string | null
  approvalPolicy?: ApprovalPolicy | null
  allowQuoteRequests?: boolean | null
  requiresPoNumber?: boolean | null
  assortmentScope?: GroupAssortmentScope | null
  metadata: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}

export type CustomerGroupInheritedTermsField =
  | 'paymentTermsDays'
  | 'allowPurchaseOnAccount'
  | 'approvalRequiredAbove'
  | 'minOrderValue'
  | 'termsCurrencyCode'
  | 'approvalPolicy'
  | 'allowQuoteRequests'
  | 'requiresPoNumber'

// What the group resolves to for a field it leaves unset (US-C1), as returned by the
// terms GET: the parent chain's value, or the tenant default / organization base currency.
export type CustomerGroupInheritedTermsDTO = Record<
  CustomerGroupInheritedTermsField,
  {
    value: string | number | boolean | null
    source: 'group' | 'tenant_default' | 'base_currency'
    sourceGroup: { id: string; code: string; name: string } | null
  }
>

// Lock token sent with the first save of a group that has no terms row yet. No real
// row can carry this `updated_at`, so if another editor created the row meanwhile the
// route's lock check against that row answers 409 instead of silently overwriting it.
export const TERMS_NOT_YET_CREATED_LOCK_TOKEN = new Date(0).toISOString()

// `inherit` maps to `null` on the wire: the field is left unset on this group and
// resolves from the parent chain / tenant default, like the other terms fields.
const PURCHASE_ON_ACCOUNT_VALUES = ['inherit', 'allow', 'deny'] as const
type PurchaseOnAccountValue = (typeof PURCHASE_ON_ACCOUNT_VALUES)[number]

function toPurchaseOnAccountValue(value: boolean | null | undefined): PurchaseOnAccountValue {
  if (value === true) return 'allow'
  if (value === false) return 'deny'
  return 'inherit'
}

function fromPurchaseOnAccountValue(value: string | undefined): boolean | null {
  if (value === 'allow') return true
  if (value === 'deny') return false
  return null
}

const APPROVAL_POLICIES = ['buyer', 'merchant', 'both'] as const
type ApprovalPolicy = (typeof APPROVAL_POLICIES)[number]
const APPROVAL_POLICY_VALUES = ['inherit', ...APPROVAL_POLICIES] as const
type ApprovalPolicyValue = (typeof APPROVAL_POLICY_VALUES)[number]

function toApprovalPolicyValue(value: ApprovalPolicy | null | undefined): ApprovalPolicyValue {
  return value && (APPROVAL_POLICIES as readonly string[]).includes(value) ? value : 'inherit'
}

function fromApprovalPolicyValue(value: string | undefined): ApprovalPolicy | null {
  return value && (APPROVAL_POLICIES as readonly string[]).includes(value) ? (value as ApprovalPolicy) : null
}

const TERMS_CURRENCY_PATTERN = /^[A-Za-z]{3}$/

function normalizeCurrencyCode(value: string | undefined): string | null {
  return value && value.trim().length ? value.trim().toUpperCase() : null
}

type CustomerGroupTermsFormValues = AssortmentScopeFormValues & {
  priceKindId: string
  paymentTermsDays?: number
  allowPurchaseOnAccount: PurchaseOnAccountValue
  defaultCreditLimit?: string
  creditCurrencyCode: string
  approvalRequiredAbove?: string
  minOrderValue?: string
  termsCurrencyCode: string
  approvalPolicy: ApprovalPolicyValue
  allowQuoteRequests: PurchaseOnAccountValue
  requiresPoNumber: PurchaseOnAccountValue
}

function exactAmountOrUndefined(exact: string | null | undefined, legacy: number | null | undefined): string | undefined {
  return resolveExactDecimal(exact, legacy) ?? undefined
}

function amountOrNull(value: unknown): string | null {
  return isDecimalInput(value) ? decimalToString(value) : null
}

function isEmptyAmount(value: unknown): boolean {
  return value === undefined || value === null || value === ''
}

function mapTermsToFormValues(terms: CustomerGroupTermsDTO | null): CustomerGroupTermsFormValues {
  return {
    priceKindId: terms?.priceKindId ?? '',
    paymentTermsDays: terms?.paymentTermsDays ?? undefined,
    allowPurchaseOnAccount: toPurchaseOnAccountValue(terms?.allowPurchaseOnAccount),
    defaultCreditLimit: exactAmountOrUndefined(terms?.defaultCreditLimitExact, terms?.defaultCreditLimit),
    creditCurrencyCode: terms?.creditCurrencyCode ?? '',
    approvalRequiredAbove: exactAmountOrUndefined(terms?.approvalRequiredAboveExact, terms?.approvalRequiredAbove),
    minOrderValue: exactAmountOrUndefined(terms?.minOrderValueExact, terms?.minOrderValue),
    termsCurrencyCode: terms?.termsCurrencyCode ?? '',
    approvalPolicy: toApprovalPolicyValue(terms?.approvalPolicy),
    allowQuoteRequests: toPurchaseOnAccountValue(terms?.allowQuoteRequests),
    requiresPoNumber: toPurchaseOnAccountValue(terms?.requiresPoNumber),
    ...mapAssortmentScopeToFormValues(terms?.assortmentScope),
  }
}

const TERMS_FIELD_IDS = [
  'priceKindId',
  'paymentTermsDays',
  'allowPurchaseOnAccount',
  'defaultCreditLimit',
  'creditCurrencyCode',
  'approvalRequiredAbove',
  'minOrderValue',
  'termsCurrencyCode',
  'approvalPolicy',
  'allowQuoteRequests',
  'requiresPoNumber',
  'termsWarnings',
]

// Release 5 (spec §7.3, D-R5-CG4): warnings derived from the effective values — the
// value being edited, or the inherited one when the field is left unset. A threshold on
// the tenant's default group also applies to guests, who cannot be approved (D-R5-12,
// D-R5-29); a threshold or minimum without a terms currency falls back to the parent
// chain and then the organization's base currency (D-R5-37), and without either every
// cart requires approval and no minimum is checked (D-R5-4).
function CustomerGroupTermsWarnings({
  values,
  isDefaultGroup,
  inherited,
}: {
  values: Record<string, unknown> | undefined
  isDefaultGroup: boolean
  inherited: CustomerGroupInheritedTermsDTO | null
}) {
  const t = useT()
  const hasApprovalThreshold =
    !isEmptyAmount(values?.approvalRequiredAbove) || inherited?.approvalRequiredAbove.value != null
  const hasMinOrderValue = !isEmptyAmount(values?.minOrderValue) || inherited?.minOrderValue.value != null
  const ownCurrency = typeof values?.termsCurrencyCode === 'string' ? values.termsCurrencyCode.trim() : ''
  const hasCurrency = ownCurrency.length > 0 || inherited?.termsCurrencyCode.value != null
  const showDefaultGroupWarning = isDefaultGroup && hasApprovalThreshold
  const showMissingCurrencyWarning = (hasApprovalThreshold || hasMinOrderValue) && !hasCurrency
  if (!showDefaultGroupWarning && !showMissingCurrencyWarning) return null
  return (
    <div className="space-y-2">
      {showDefaultGroupWarning ? (
        <Alert status="warning" size="sm" data-testid="customer-group-terms-default-group-warning">
          {t(
            'customer_groups.groups.form.terms.warnings.defaultGroupApproval',
            'This is the default group, so its approval threshold also applies to guests. Guest orders and pay-link orders by guests above this amount are refused, because a guest cannot be asked for approval.',
          )}
        </Alert>
      ) : null}
      {showMissingCurrencyWarning ? (
        <Alert status="warning" size="sm" data-testid="customer-group-terms-missing-currency-warning">
          {inherited
            ? t(
                'customer_groups.groups.form.terms.warnings.unresolvedTermsCurrency',
                'No terms currency resolves for this group: none is set here, on a parent group or as the organization base currency. Every cart requires approval and no minimum order value is checked.',
              )
            : t(
                'customer_groups.groups.form.terms.warnings.missingTermsCurrency',
                'No terms currency is set on this group. The threshold and minimum order value use the currency inherited from a parent group or, failing that, the organization base currency. Without either, every cart requires approval and no minimum order value is checked.',
              )}
        </Alert>
      ) : null}
    </div>
  )
}

type Translate = ReturnType<typeof useT>

function formatInheritedValue(
  field: CustomerGroupInheritedTermsField,
  value: string | number | boolean | null,
  t: Translate,
): string {
  if (value === null) return t('customer_groups.groups.form.terms.inherited.notSet', 'not set')
  switch (field) {
    case 'allowPurchaseOnAccount':
      return value === true
        ? t('customer_groups.groups.form.terms.field.allowPurchaseOnAccountOptions.allow', 'Allow')
        : t('customer_groups.groups.form.terms.field.allowPurchaseOnAccountOptions.deny', 'Do not allow')
    case 'allowQuoteRequests':
      return value === true
        ? t('customer_groups.groups.form.terms.field.allowQuoteRequestsOptions.allow', 'Allow')
        : t('customer_groups.groups.form.terms.field.allowQuoteRequestsOptions.deny', 'Do not allow')
    case 'requiresPoNumber':
      return value === true
        ? t('customer_groups.groups.form.terms.field.requiresPoNumberOptions.require', 'Require')
        : t('customer_groups.groups.form.terms.field.requiresPoNumberOptions.notRequired', 'Do not require')
    case 'approvalPolicy':
      if (value === 'merchant') return t('customer_groups.groups.form.terms.field.approvalPolicyOptions.merchant', 'Merchant')
      if (value === 'both') return t('customer_groups.groups.form.terms.field.approvalPolicyOptions.both', 'Buyer and merchant')
      return t('customer_groups.groups.form.terms.field.approvalPolicyOptions.buyer', 'Buyer')
    default:
      return String(value)
  }
}

function InheritedTermHint({
  field,
  inherited,
}: {
  field: CustomerGroupInheritedTermsField
  inherited: CustomerGroupInheritedTermsDTO
}) {
  const t = useT()
  const entry = inherited[field]
  const source =
    entry.source === 'base_currency'
      ? t('customer_groups.groups.form.terms.inherited.source.baseCurrency', 'organization base currency')
      : entry.source === 'group' && entry.sourceGroup
        ? t('customer_groups.groups.form.terms.inherited.source.group', 'from {name}', { name: entry.sourceGroup.name })
        : t('customer_groups.groups.form.terms.inherited.source.tenantDefault', 'tenant default')
  return (
    <span className="block" data-testid={`customer-group-terms-inherited-${field}`}>
      {t('customer_groups.groups.form.terms.inherited.hint', 'Inherited: {value} ({source})', {
        value: formatInheritedValue(field, entry.value, t),
        source,
      })}
    </span>
  )
}

function withInheritedHint(
  field: CustomerGroupInheritedTermsField,
  inherited: CustomerGroupInheritedTermsDTO | null,
  description?: string,
): React.ReactNode {
  if (!inherited) return description
  return (
    <>
      {description ? <span className="block">{description}</span> : null}
      <InheritedTermHint field={field} inherited={inherited} />
    </>
  )
}

function toIdList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function scopePickerField(
  id: AssortmentScopeField,
  label: string,
  placeholder: string,
  source: LookupSource,
  readOnly: boolean,
): CrudField {
  return {
    id,
    type: 'custom',
    label,
    disabled: readOnly,
    component: ({ value, setValue, disabled }) => (
      <LookupMultiPicker
        source={source}
        value={toIdList(value)}
        onChange={(next) => setValue(next)}
        placeholder={placeholder}
        disabled={disabled || readOnly}
      />
    ),
  }
}

export function CustomerGroupTermsSection({
  groupId,
  terms,
  loading,
  loadError,
  canManage,
  isDefaultGroup = false,
  inherited = null,
  onSaved,
}: {
  groupId: string
  // `undefined` = still loading, `null` = confirmed no terms row for this group
  // (spec: "No terms set — inheriting from parent / tenant defaults"), object = loaded row.
  terms: CustomerGroupTermsDTO | null | undefined
  loading: boolean
  // Set when the terms GET failed for a reason other than "no row" — the form is
  // then withheld so a save can never overwrite terms it could not read.
  loadError?: string | null
  // Without `customer_groups.terms.manage` the terms stay viewable but the form is
  // read-only and the empty state offers no "set terms" action — a save would 403.
  canManage: boolean
  // The tenant's default group also resolves guests' terms (spec §7.3 warning).
  isDefaultGroup?: boolean
  // `null` when unknown: no inherited hints, and the currency warning judges own values only.
  inherited?: CustomerGroupInheritedTermsDTO | null
  onSaved: (next: CustomerGroupTermsDTO) => void
}) {
  const t = useT()
  // Once the user starts filling out terms for a group that has none yet, keep the
  // form mounted even while the in-flight save briefly leaves `terms` as `null` —
  // otherwise the empty state would flash back before `onSaved` lands.
  const [editing, setEditing] = React.useState(false)
  const hasTerms = terms != null
  const showForm = hasTerms || editing

  const negativeMessage = t('customer_groups.groups.form.terms.errors.negative', 'Must be zero or greater.')

  const schema = React.useMemo(() => {
    const amountSchema = z
      .union([z.string(), z.number()])
      .optional()
      .refine(
        (value) => isEmptyAmount(value) || (isDecimalInput(value) && !isNegativeDecimal(value)),
        negativeMessage,
      )
      .transform((value) => (isEmptyAmount(value) ? undefined : amountOrNull(value) ?? undefined))
    return z.object({
        priceKindId: z.string().trim(),
        paymentTermsDays: z.coerce.number().int().min(0, negativeMessage).optional(),
        allowPurchaseOnAccount: z.enum(PURCHASE_ON_ACCOUNT_VALUES),
        defaultCreditLimit: amountSchema,
        creditCurrencyCode: z
          .string()
          .trim()
          .max(4, t('customer_groups.groups.form.terms.errors.currencyLength', 'Use up to 4 characters.')),
        approvalRequiredAbove: amountSchema,
        minOrderValue: amountSchema,
        termsCurrencyCode: z
          .string()
          .trim()
          .refine(
            (value) => value.length === 0 || TERMS_CURRENCY_PATTERN.test(value),
            t('customer_groups.groups.form.terms.errors.termsCurrencyCode', 'Use a three-letter ISO 4217 code, e.g., EUR.'),
          ),
        approvalPolicy: z.enum(APPROVAL_POLICY_VALUES),
        allowQuoteRequests: z.enum(PURCHASE_ON_ACCOUNT_VALUES),
        requiresPoNumber: z.enum(PURCHASE_ON_ACCOUNT_VALUES),
        categoryIds: z.array(z.string()).default([]),
        tagIds: z.array(z.string()).default([]),
        excludeProductIds: z.array(z.string()).default([]),
        excludeCategoryIds: z.array(z.string()).default([]),
        excludeTagIds: z.array(z.string()).default([]),
      })
  }, [negativeMessage, t])

  const fields = React.useMemo<CrudField[]>(
    () => [
      {
        id: 'priceKindId',
        label: t('customer_groups.groups.form.terms.field.priceKind', 'Price kind'),
        type: 'custom',
        component: ({ value, setValue, disabled }) => (
          <CustomerGroupTermsPriceKindField
            value={typeof value === 'string' ? value : ''}
            onChange={setValue}
            disabled={disabled}
          />
        ),
      },
      {
        id: 'paymentTermsDays',
        label: t('customer_groups.groups.form.terms.field.paymentTermsDays', 'Payment terms (days)'),
        type: 'number',
        layout: 'half',
        description: withInheritedHint('paymentTermsDays', inherited),
      },
      {
        id: 'allowPurchaseOnAccount',
        label: t('customer_groups.groups.form.terms.field.allowPurchaseOnAccount', 'Allow purchase on account'),
        type: 'select',
        layout: 'half',
        required: true,
        description: withInheritedHint('allowPurchaseOnAccount', inherited),
        options: [
          {
            value: 'inherit',
            label: t('customer_groups.groups.form.terms.field.allowPurchaseOnAccountOptions.inherit', 'Inherit'),
          },
          {
            value: 'allow',
            label: t('customer_groups.groups.form.terms.field.allowPurchaseOnAccountOptions.allow', 'Allow'),
          },
          {
            value: 'deny',
            label: t('customer_groups.groups.form.terms.field.allowPurchaseOnAccountOptions.deny', 'Do not allow'),
          },
        ],
      },
      {
        id: 'defaultCreditLimit',
        label: t('customer_groups.groups.form.terms.field.defaultCreditLimit', 'Default credit limit'),
        type: 'decimal',
        layout: 'half',
      },
      {
        id: 'creditCurrencyCode',
        label: t('customer_groups.groups.form.terms.field.creditCurrencyCode', 'Credit currency'),
        type: 'text',
        layout: 'half',
        placeholder: t('customer_groups.groups.form.terms.field.creditCurrencyCodePlaceholder', 'e.g., USD'),
        maxLength: 4,
      },
      {
        id: 'approvalRequiredAbove',
        label: t('customer_groups.groups.form.terms.field.approvalRequiredAbove', 'Approval required above'),
        type: 'decimal',
        layout: 'half',
        description: withInheritedHint('approvalRequiredAbove', inherited),
      },
      {
        id: 'minOrderValue',
        label: t('customer_groups.groups.form.terms.field.minOrderValue', 'Minimum order value'),
        type: 'decimal',
        layout: 'half',
        description: withInheritedHint('minOrderValue', inherited),
      },
      {
        id: 'termsCurrencyCode',
        label: t('customer_groups.groups.form.terms.field.termsCurrencyCode', 'Terms currency'),
        type: 'text',
        layout: 'half',
        placeholder: t('customer_groups.groups.form.terms.field.termsCurrencyCodePlaceholder', 'Inherit (e.g., EUR)'),
        description: withInheritedHint(
          'termsCurrencyCode',
          inherited,
          t(
            'customer_groups.groups.form.terms.field.termsCurrencyCodeHint',
            'Currency of the approval threshold and the minimum order value. Carts in another currency always require approval.',
          ),
        ),
        maxLength: 3,
      },
      {
        id: 'approvalPolicy',
        label: t('customer_groups.groups.form.terms.field.approvalPolicy', 'Approval policy'),
        type: 'select',
        layout: 'half',
        required: true,
        description: withInheritedHint(
          'approvalPolicy',
          inherited,
          t('customer_groups.groups.form.terms.field.approvalPolicyHint', 'Who signs a purchase approval request.'),
        ),
        options: [
          { value: 'inherit', label: t('customer_groups.groups.form.terms.field.approvalPolicyOptions.inherit', 'Inherit') },
          { value: 'buyer', label: t('customer_groups.groups.form.terms.field.approvalPolicyOptions.buyer', 'Buyer') },
          { value: 'merchant', label: t('customer_groups.groups.form.terms.field.approvalPolicyOptions.merchant', 'Merchant') },
          { value: 'both', label: t('customer_groups.groups.form.terms.field.approvalPolicyOptions.both', 'Buyer and merchant') },
        ],
      },
      {
        id: 'allowQuoteRequests',
        label: t('customer_groups.groups.form.terms.field.allowQuoteRequests', 'Allow quote requests'),
        type: 'select',
        layout: 'half',
        required: true,
        description: withInheritedHint('allowQuoteRequests', inherited),
        options: [
          { value: 'inherit', label: t('customer_groups.groups.form.terms.field.allowQuoteRequestsOptions.inherit', 'Inherit') },
          { value: 'allow', label: t('customer_groups.groups.form.terms.field.allowQuoteRequestsOptions.allow', 'Allow') },
          { value: 'deny', label: t('customer_groups.groups.form.terms.field.allowQuoteRequestsOptions.deny', 'Do not allow') },
        ],
      },
      {
        id: 'requiresPoNumber',
        label: t('customer_groups.groups.form.terms.field.requiresPoNumber', 'Require PO number'),
        type: 'select',
        layout: 'half',
        required: true,
        description: withInheritedHint('requiresPoNumber', inherited),
        options: [
          { value: 'inherit', label: t('customer_groups.groups.form.terms.field.requiresPoNumberOptions.inherit', 'Inherit') },
          { value: 'allow', label: t('customer_groups.groups.form.terms.field.requiresPoNumberOptions.require', 'Require') },
          { value: 'deny', label: t('customer_groups.groups.form.terms.field.requiresPoNumberOptions.notRequired', 'Do not require') },
        ],
      },
      {
        id: 'termsWarnings',
        label: '',
        type: 'custom',
        component: ({ values }) => <CustomerGroupTermsWarnings values={values} isDefaultGroup={isDefaultGroup} inherited={inherited} />,
      },
      scopePickerField(
        'categoryIds',
        t('customer_groups.groups.form.terms.assortment.field.categoryIds', 'Categories'),
        t('customer_groups.groups.form.terms.assortment.placeholder.category', 'Search categories'),
        categoryLookupSource,
        !canManage,
      ),
      scopePickerField(
        'tagIds',
        t('customer_groups.groups.form.terms.assortment.field.tagIds', 'Tags'),
        t('customer_groups.groups.form.terms.assortment.placeholder.tag', 'Search tags'),
        tagLookupSource,
        !canManage,
      ),
      scopePickerField(
        'excludeProductIds',
        t('customer_groups.groups.form.terms.assortment.field.excludeProductIds', 'Products'),
        t('customer_groups.groups.form.terms.assortment.placeholder.product', 'Search products'),
        productLookupSource,
        !canManage,
      ),
      scopePickerField(
        'excludeCategoryIds',
        t('customer_groups.groups.form.terms.assortment.field.excludeCategoryIds', 'Categories'),
        t('customer_groups.groups.form.terms.assortment.placeholder.category', 'Search categories'),
        categoryLookupSource,
        !canManage,
      ),
      scopePickerField(
        'excludeTagIds',
        t('customer_groups.groups.form.terms.assortment.field.excludeTagIds', 'Tags'),
        t('customer_groups.groups.form.terms.assortment.placeholder.tag', 'Search tags'),
        tagLookupSource,
        !canManage,
      ),
    ],
    [canManage, inherited, isDefaultGroup, t],
  )

  const groups = React.useMemo<CrudFormGroup[]>(
    () => [
      { id: 'terms', fields: TERMS_FIELD_IDS },
      {
        id: 'assortmentInclude',
        title: t('customer_groups.groups.form.terms.assortment.includeTitle', 'Assortment scope: show only products in'),
        description: t(
          'customer_groups.groups.form.terms.assortment.includeHint',
          "A product is visible to this group when it is in any of the chosen categories and carries any of the chosen tags. An empty picker does not filter, so leave both empty for no restriction; clearing a picker never hides everything. The storefront assortment a buyer sees is the channel's scope narrowed by this group's scope, and a buyer in several groups sees the union of their scopes.",
        ),
        fields: ['categoryIds', 'tagIds'],
      },
      {
        id: 'assortmentExclude',
        title: t('customer_groups.groups.form.terms.assortment.excludeTitle', 'Always hide from this group'),
        description: t(
          'customer_groups.groups.form.terms.assortment.excludeHint',
          'Hidden products, categories and tags win over the selection above.',
        ),
        fields: ['excludeProductIds', 'excludeCategoryIds', 'excludeTagIds'],
      },
    ],
    [t],
  )

  const initialValues = React.useMemo(() => mapTermsToFormValues(terms ?? null), [terms])

  const handleSubmit = React.useCallback(
    async (values: CustomerGroupTermsFormValues) => {
      const payload: Record<string, unknown> = {
        priceKindId: values.priceKindId && values.priceKindId.trim().length ? values.priceKindId : null,
        paymentTermsDays: typeof values.paymentTermsDays === 'number' ? values.paymentTermsDays : null,
        allowPurchaseOnAccount: fromPurchaseOnAccountValue(values.allowPurchaseOnAccount),
        defaultCreditLimit: amountOrNull(values.defaultCreditLimit),
        creditCurrencyCode:
          values.creditCurrencyCode && values.creditCurrencyCode.trim().length
            ? values.creditCurrencyCode.trim().toUpperCase()
            : null,
        approvalRequiredAbove: amountOrNull(values.approvalRequiredAbove),
        minOrderValue: amountOrNull(values.minOrderValue),
        termsCurrencyCode: normalizeCurrencyCode(values.termsCurrencyCode),
        approvalPolicy: fromApprovalPolicyValue(values.approvalPolicy),
        allowQuoteRequests: fromPurchaseOnAccountValue(values.allowQuoteRequests),
        requiresPoNumber: fromPurchaseOnAccountValue(values.requiresPoNumber),
        assortmentScope: buildAssortmentScopePayload(values),
      }
      // `updateCrud` PUTs to `/api/customer_groups/customer-groups/{groupId}/terms`, matching the
      // upsert route (Step 2.4). `optimisticLockUpdatedAt` below is
      // `TERMS_NOT_YET_CREATED_LOCK_TOKEN` on the first save (no `terms` row yet).
      const call = await updateCrud<{ terms: CustomerGroupTermsDTO }>(`customer_groups/customer-groups/${groupId}/terms`, payload, {
        errorMessage: t('customer_groups.groups.form.terms.errors.save', 'Failed to save commercial terms.'),
      })
      if (call.result?.terms) onSaved(call.result.terms)
      flash(t('customer_groups.groups.form.terms.flash.saved', 'Commercial terms saved.'), 'success')
    },
    [groupId, onSaved, t],
  )

  return (
    <div className="rounded-md border border-border bg-card p-4 space-y-4">
      <SectionHeader title={t('customer_groups.groups.form.terms.title', 'Commercial terms')} />
      {loading ? (
        <LoadingMessage label={t('customer_groups.groups.form.terms.loading', 'Loading commercial terms…')} />
      ) : loadError ? (
        <ErrorMessage label={loadError} />
      ) : !showForm ? (
        <EmptyState
          size="sm"
          variant="subtle"
          icon={<FileText className="h-5 w-5" aria-hidden />}
          title={t(
            'customer_groups.groups.form.terms.empty.title',
            'No terms set — inheriting from parent / tenant defaults',
          )}
          description={t(
            'customer_groups.groups.form.terms.empty.description',
            'This group currently uses commercial terms inherited from its parent group or the tenant defaults. Set explicit terms to override them for this group.',
          )}
          actions={canManage ? (
            <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
              {t('customer_groups.groups.form.terms.empty.action', 'Set terms for this group')}
            </Button>
          ) : undefined}
          className="border border-dashed border-border"
        />
      ) : (
        <CrudForm<CustomerGroupTermsFormValues>
          key={terms?.updatedAt ?? 'new'}
          embedded
          disableInitialFocus
          schema={schema}
          fields={fields}
          groups={groups}
          initialValues={initialValues}
          optimisticLockUpdatedAt={terms?.updatedAt ?? TERMS_NOT_YET_CREATED_LOCK_TOKEN}
          readOnly={!canManage}
          readOnlyOverlay={(
            <div className="rounded-xl border border-border/70 bg-background/95 px-4 py-3 text-sm text-muted-foreground shadow-sm">
              {t(
                'customer_groups.groups.form.terms.readOnly',
                'You do not have permission to change commercial terms.',
              )}
            </div>
          )}
          submitLabel={t('customer_groups.groups.form.terms.action.save', 'Save terms')}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  )
}

export default CustomerGroupTermsSection
