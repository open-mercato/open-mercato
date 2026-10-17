'use client'

// Inline benefit card (Step 1.7/1.8, SPEC-055 §UI/UX "Rule Group Tree Builder"): a
// filterable type dropdown restricted to the five Release 4 shipped benefit types,
// type-specific inline fields, the "Applies to" segmented control, the "Limits" row
// with its conditional "Which pieces" selector, a plain-language echo line, a
// collapsible Labels section (locale → string), and a delete button.
//
// Uses `border-status-info-border` / `bg-status-info-bg` as this module's chosen
// "accent/benefit" token (SPEC-055 rev A6/om-ds-guardian note: "never a hardcoded
// orange") — a real DS semantic token (`.ai/ds-rules.md` "Left-accent indicator" row),
// not an invented name.

import * as React from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Plus, X } from 'lucide-react'
import { Card, CardContent } from '@open-mercato/ui/primitives/card'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { CheckboxField } from '@open-mercato/ui/primitives/checkbox-field'
import { CollapsibleSection } from '@open-mercato/ui/backend/SectionHeader'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { getSupportedLocales } from '@open-mercato/shared/lib/i18n/locale-set'
import { RuleFieldInput } from './RuleFieldInput'
import { BENEFIT_FIELD_SPECS } from './ruleFieldSpecs'
import {
  applyAppliesToChange,
  applyCappedSelectorChange,
  applyNthPositionChange,
  applyNthToggleChange,
  applyQuantityCapChange,
  applyQuantityStepChange,
  resolveBenefitLimitsState,
  type CappedSelectorId,
} from './benefitLimits'
import { renderBenefitEcho } from './benefitEcho'
import {
  BENEFIT_APPLIES_TO,
  BENEFIT_TYPE_OPTIONS,
  discountTypeOptions,
  isBenefitLabelsEmpty,
  type AppliesToId,
  type BenefitTypeId,
  type DiscountTypeId,
  type LocalBenefitNode,
  type TierRow,
} from './ruleTreeTypes'

const APPLIES_TO_LABEL_KEYS: Record<AppliesToId, { key: string; fallback: string }> = {
  order: { key: 'promotions.benefits.appliesTo.order', fallback: 'Whole order' },
  line: { key: 'promotions.benefits.appliesTo.line', fallback: 'Order line' },
  unit: { key: 'promotions.benefits.appliesTo.unit', fallback: 'Each piece' },
}

const CAPPED_SELECTOR_LABEL_KEYS: Record<CappedSelectorId, { key: string; fallback: string }> = {
  cart_order: { key: 'promotions.benefits.selector.cartOrder', fallback: 'First added' },
  cheapest: { key: 'promotions.benefits.selector.cheapest', fallback: 'Cheapest' },
  most_expensive: { key: 'promotions.benefits.selector.mostExpensive', fallback: 'Most expensive' },
}

function parseOptionalPositiveInt(raw: string): number | null {
  if (raw.trim() === '') return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null
}

function BenefitLimitsEditor({
  benefit,
  disabled,
  onConfigChange,
}: {
  benefit: LocalBenefitNode
  disabled?: boolean
  onConfigChange: (config: Record<string, unknown>) => void
}) {
  const t = useT()
  const config = benefit.config
  const state = resolveBenefitLimitsState(benefit.appliesTo, config)
  if (!state.showLimitsRow) return null

  const maxQuantity = typeof config.maxQuantity === 'number' ? String(config.maxQuantity) : ''
  const maxLines = typeof config.maxLines === 'number' ? String(config.maxLines) : ''
  const quantityStep = typeof config.quantityStep === 'number' ? String(config.quantityStep) : ''
  const nthPosition = typeof config.nthPosition === 'number' ? String(config.nthPosition) : ''
  const selector = typeof config.selector === 'string' ? config.selector : ''

  return (
    <div className="space-y-2 rounded-md border border-border p-2">
      <span className="text-xs font-semibold text-muted-foreground">{t('promotions.benefits.limits.title', 'Limits')}</span>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">{t('promotions.benefits.limits.maxQuantity', 'Max quantity')}</span>
          <Input
            type="number"
            inputMode="numeric"
            value={maxQuantity}
            disabled={disabled || state.capInputsDisabled}
            onChange={(event) => onConfigChange(applyQuantityCapChange(config, 'maxQuantity', parseOptionalPositiveInt(event.target.value)))}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">{t('promotions.benefits.limits.maxLines', 'Max lines')}</span>
          <Input
            type="number"
            inputMode="numeric"
            value={maxLines}
            disabled={disabled || state.capInputsDisabled}
            onChange={(event) => onConfigChange(applyQuantityCapChange(config, 'maxLines', parseOptionalPositiveInt(event.target.value)))}
          />
        </label>
        {state.showQuantityStep ? (
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">{t('promotions.benefits.limits.quantityStep', 'Quantity step')}</span>
            <Input
              type="number"
              inputMode="numeric"
              value={quantityStep}
              disabled={disabled}
              onChange={(event) => onConfigChange(applyQuantityStepChange(config, parseOptionalPositiveInt(event.target.value)))}
            />
          </label>
        ) : null}
      </div>

      {state.mode === 'capped' ? (
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">{t('promotions.benefits.limits.whichPieces', 'Which pieces')}</span>
          <Select
            value={state.selectorOptions.includes(selector as CappedSelectorId) ? selector : state.selectorOptions[0]}
            disabled={disabled}
            onValueChange={(next) => onConfigChange(applyCappedSelectorChange(config, next as CappedSelectorId))}
          >
            <SelectTrigger size={36}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {state.selectorOptions.map((option) => (
                <SelectItem key={option} value={option}>
                  {t(CAPPED_SELECTOR_LABEL_KEYS[option].key, CAPPED_SELECTOR_LABEL_KEYS[option].fallback)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <CheckboxField
            label={t('promotions.benefits.limits.nthToggle', 'Limit to the Nth piece/line')}
            checked={state.mode === 'nth'}
            disabled={disabled || state.nthToggleDisabled}
            onCheckedChange={(checked) => onConfigChange(applyNthToggleChange(config, checked === true))}
          />
          {state.mode === 'nth' ? (
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">{t('promotions.benefits.limits.nthPosition', 'Position')}</span>
              <Input
                type="number"
                inputMode="numeric"
                value={nthPosition}
                disabled={disabled}
                onChange={(event) => onConfigChange(applyNthPositionChange(config, parseOptionalPositiveInt(event.target.value)))}
              />
            </label>
          ) : null}
        </div>
      )}
    </div>
  )
}

const BENEFIT_TYPE_LABEL_KEYS: Record<BenefitTypeId, { key: string; fallback: string }> = {
  product_discount: { key: 'promotions.benefits.types.product_discount', fallback: 'Product discount' },
  cart_discount: { key: 'promotions.benefits.types.cart_discount', fallback: 'Cart discount' },
  free_product: { key: 'promotions.benefits.types.free_product', fallback: 'Free product' },
  buy_x_get_y: { key: 'promotions.benefits.types.buy_x_get_y', fallback: 'Buy X get Y' },
  tiered_discount: { key: 'promotions.benefits.types.tiered_discount', fallback: 'Tiered discount' },
}

const DISCOUNT_TYPE_LABEL_KEYS: Record<DiscountTypeId, string> = {
  percentage: 'promotions.discountType.percentage',
  fixed: 'promotions.discountType.fixed',
}
const DISCOUNT_TYPE_FALLBACKS: Record<DiscountTypeId, string> = {
  percentage: 'Percentage',
  fixed: 'Fixed amount',
}

function TiersEditor({
  tiers,
  disabled,
  onChange,
}: {
  tiers: TierRow[]
  disabled?: boolean
  onChange: (next: TierRow[]) => void
}) {
  const t = useT()
  return (
    <div className="space-y-2">
      <span className="text-xs text-muted-foreground">{t('promotions.fields.tiers', 'Tiers')}</span>
      {tiers.map((tier, index) => (
        <div key={index} className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">{t('promotions.fields.tierThreshold', 'Threshold')}</span>
            <Input
              type="text"
              inputMode="decimal"
              value={tier.threshold}
              disabled={disabled}
              onChange={(event) => {
                const next = [...tiers]
                next[index] = { ...tier, threshold: event.target.value }
                onChange(next)
              }}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">{t('promotions.fields.tierDiscountType', 'Discount type')}</span>
            <Select
              value={tier.discountType}
              disabled={disabled}
              onValueChange={(next) => {
                const updated = [...tiers]
                updated[index] = { ...tier, discountType: next as DiscountTypeId }
                onChange(updated)
              }}
            >
              <SelectTrigger size={36}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {discountTypeOptions.map((dt) => (
                  <SelectItem key={dt} value={dt}>
                    {t(DISCOUNT_TYPE_LABEL_KEYS[dt], DISCOUNT_TYPE_FALLBACKS[dt])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">{t('promotions.fields.tierValue', 'Value')}</span>
            <Input
              type="text"
              inputMode="decimal"
              value={tier.value}
              disabled={disabled}
              onChange={(event) => {
                const next = [...tiers]
                next[index] = { ...tier, value: event.target.value }
                onChange(next)
              }}
            />
          </label>
          <IconButton
            type="button"
            variant="destructive"
            size="sm"
            aria-label={t('promotions.fields.removeTier', 'Remove tier')}
            disabled={disabled || tiers.length <= 1}
            onClick={() => onChange(tiers.filter((_, idx) => idx !== index))}
          >
            <X className="size-4" />
          </IconButton>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => onChange([...tiers, { threshold: '0', discountType: 'percentage', value: '0' }])}
      >
        <Plus className="size-4" />
        {t('promotions.fields.addTier', 'Add tier')}
      </Button>
    </div>
  )
}

function LabelsEditor({
  labels,
  disabled,
  onChange,
}: {
  labels: Record<string, string>
  disabled?: boolean
  onChange: (next: Record<string, string>) => void
}) {
  const t = useT()
  const entries = Object.entries(labels)
  const [newLocale, setNewLocale] = React.useState('')
  // Only offer locales this benefit does not already carry a row for — the
  // app's real supported-locale set (`getSupportedLocales()`) replaces the
  // former free-text locale `Input`, which silently accepted a typo like
  // `eng` with no validation against anything.
  const availableLocales = getSupportedLocales().filter(
    (locale) => !Object.prototype.hasOwnProperty.call(labels, locale),
  )

  return (
    <div className="space-y-2">
      {entries.map(([locale, text]) => (
        <div key={locale} className="flex items-end gap-2">
          <div className="w-28">
            <span className="truncate text-xs text-muted-foreground">{locale}</span>
          </div>
          <div className="flex-1">
            <Input
              type="text"
              value={text}
              disabled={disabled}
              placeholder={t('promotions.benefits.labels.textPlaceholder', 'Label text')}
              onChange={(event) => onChange({ ...labels, [locale]: event.target.value })}
            />
          </div>
          <IconButton
            type="button"
            variant="destructive"
            size="lg"
            aria-label={t('promotions.benefits.labels.remove', 'Remove label')}
            disabled={disabled}
            onClick={() => {
              const next = { ...labels }
              delete next[locale]
              onChange(next)
            }}
          >
            <X className="size-4" />
          </IconButton>
        </div>
      ))}
      {availableLocales.length > 0 ? (
        <div className="flex items-end gap-2">
          <div className="w-28">
            <Select value={newLocale} onValueChange={setNewLocale} disabled={disabled}>
              <SelectTrigger size={36} aria-label={t('promotions.benefits.labels.localePlaceholder', 'Locale code (e.g. en)')}>
                <SelectValue placeholder={t('promotions.benefits.labels.localePlaceholder', 'Locale code (e.g. en)')} />
              </SelectTrigger>
              <SelectContent>
                {availableLocales.map((locale) => (
                  <SelectItem key={locale} value={locale}>
                    {locale}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1" />
          <Button
            type="button"
            variant="outline"
            disabled={disabled || !newLocale}
            onClick={() => {
              if (!newLocale) return
              onChange({ ...labels, [newLocale]: '' })
              setNewLocale('')
            }}
          >
            <Plus className="size-4" />
            {t('promotions.benefits.labels.addLocale', 'Add locale')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

export type BenefitCardProps = {
  benefit: LocalBenefitNode
  disabled?: boolean
  onTypeChange: (benefitType: BenefitTypeId) => void
  onAppliesToChange: (appliesTo: AppliesToId, config: Record<string, unknown>) => void
  onConfigChange: (config: Record<string, unknown>) => void
  onLabelsChange: (labels: Record<string, string>) => void
  onDelete: () => void
}

export function BenefitCard({
  benefit,
  disabled,
  onTypeChange,
  onAppliesToChange,
  onConfigChange,
  onLabelsChange,
  onDelete,
}: BenefitCardProps) {
  const t = useT()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: benefit.clientId,
    disabled,
  })
  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition }

  const typeOptions = BENEFIT_TYPE_OPTIONS.map((benefitType) => ({
    value: benefitType,
    label: t(BENEFIT_TYPE_LABEL_KEYS[benefitType].key, BENEFIT_TYPE_LABEL_KEYS[benefitType].fallback),
  }))

  const fieldSpecs = BENEFIT_FIELD_SPECS[benefit.benefitType]
  const tiers = Array.isArray(benefit.config.tiers) ? (benefit.config.tiers as TierRow[]) : []
  const allowedAppliesTo = BENEFIT_APPLIES_TO[benefit.benefitType].allowed
  const echoLine = renderBenefitEcho(benefit, t)
  const labelsInvalid = isBenefitLabelsEmpty(benefit.labels)
  const [labelsCollapsed, setLabelsCollapsed] = React.useState(!labelsInvalid)
  React.useEffect(() => {
    if (labelsInvalid) setLabelsCollapsed(false)
  }, [labelsInvalid])

  return (
    <div ref={setNodeRef} style={style}>
      <Card className={isDragging ? 'border-status-info-border shadow-md' : 'border-status-info-border'}>
        <CardContent className="space-y-3 bg-status-info-bg p-3">
          <div className="flex items-start gap-2">
            {/* Raw <button> required: dnd-kit spreads `attributes`+`listeners` onto the
                activator; `IconButton`'s own prop/ref handling breaks the keyboard sensor
                — same precedent as `AdvancedFilterBuilder.tsx`'s drag handle. */}
            <button
              type="button"
              className="mt-2 inline-flex cursor-grab items-center text-muted-foreground outline-none focus-visible:shadow-focus active:cursor-grabbing"
              aria-label={t('promotions.tree.dragHandle', 'Reorder')}
              {...attributes}
              {...listeners}
            >
              <GripVertical className="size-4" />
            </button>
            <div className="min-w-0 flex-1 space-y-3">
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">{t('promotions.benefits.typeLabel', 'Benefit type')}</span>
                <Select
                  value={benefit.benefitType}
                  onValueChange={(next) => onTypeChange(next as BenefitTypeId)}
                  disabled={disabled}
                >
                  <SelectTrigger size={36}>
                    <SelectValue placeholder={t('promotions.benefits.typePlaceholder', 'Select a benefit type...')} />
                  </SelectTrigger>
                  <SelectContent>
                    {typeOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">{t('promotions.benefits.appliesTo.label', 'Applies to')}</span>
                <SegmentedControl
                  value={benefit.appliesTo}
                  onValueChange={(next) =>
                    onAppliesToChange(next as AppliesToId, applyAppliesToChange(next as AppliesToId, benefit.config))
                  }
                  aria-label={t('promotions.benefits.appliesTo.label', 'Applies to')}
                  size="sm"
                >
                  {allowedAppliesTo.map((option) => (
                    <SegmentedControlItem key={option} value={option} disabled={disabled}>
                      {t(APPLIES_TO_LABEL_KEYS[option].key, APPLIES_TO_LABEL_KEYS[option].fallback)}
                    </SegmentedControlItem>
                  ))}
                </SegmentedControl>
              </label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {fieldSpecs.map((spec) => (
                  <RuleFieldInput
                    key={spec.key}
                    spec={spec}
                    value={benefit.config[spec.key]}
                    disabled={disabled}
                    onChange={(next) => onConfigChange({ ...benefit.config, [spec.key]: next })}
                  />
                ))}
              </div>
              {benefit.benefitType === 'tiered_discount' ? (
                <TiersEditor
                  tiers={tiers}
                  disabled={disabled}
                  onChange={(next) => onConfigChange({ ...benefit.config, tiers: next })}
                />
              ) : null}
              <BenefitLimitsEditor benefit={benefit} disabled={disabled} onConfigChange={onConfigChange} />
              <p className="text-xs text-muted-foreground">{echoLine}</p>
              <CollapsibleSection
                title={t('promotions.benefits.labels.title', 'Labels')}
                collapsed={labelsCollapsed}
                onCollapsedChange={setLabelsCollapsed}
              >
                <div className="space-y-2">
                  {labelsInvalid ? (
                    <p className="text-xs text-status-error-text">
                      {t('promotions.benefits.labels.errorRequired', 'At least one label is required before this benefit can be saved.')}
                    </p>
                  ) : null}
                  <LabelsEditor labels={benefit.labels} disabled={disabled} onChange={onLabelsChange} />
                </div>
              </CollapsibleSection>
            </div>
            <IconButton
              type="button"
              variant="destructive"
              size="sm"
              aria-label={t('promotions.benefits.delete', 'Delete benefit')}
              disabled={disabled}
              onClick={onDelete}
            >
              <X className="size-4" />
            </IconButton>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
