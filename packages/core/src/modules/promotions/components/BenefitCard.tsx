'use client'

// Inline benefit card (Step 1.7, SPEC-055 §UI/UX "Rule Group Tree Builder"): a
// filterable type dropdown restricted to the five Release 4 shipped benefit types,
// type-specific inline fields, a collapsible Labels section (locale → string), and a
// delete button. This is the "basic inline card" placeholder the step's scope calls
// for — the "Applies to" segmented control, the Limits row, and the plain-language
// echo line are explicitly Step 1.8's job (not built here); the card's `config`/
// `labels` shape is already wired so Step 1.8 can enrich it without a data migration.
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
import { ComboboxInput, type ComboboxOption } from '@open-mercato/ui/backend/inputs/ComboboxInput'
import { CollapsibleSection } from '@open-mercato/ui/backend/SectionHeader'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { RuleFieldInput } from './RuleFieldInput'
import { BENEFIT_FIELD_SPECS } from './ruleFieldSpecs'
import {
  BENEFIT_TYPE_OPTIONS,
  discountTypeOptions,
  type BenefitTypeId,
  type DiscountTypeId,
  type LocalBenefitNode,
  type TierRow,
} from './ruleTreeTypes'

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

  return (
    <div className="space-y-2">
      {entries.map(([locale, text]) => (
        <div key={locale} className="grid grid-cols-[100px_1fr_auto] items-end gap-2">
          <span className="truncate text-xs text-muted-foreground">{locale}</span>
          <Input
            type="text"
            value={text}
            disabled={disabled}
            placeholder={t('promotions.benefits.labels.textPlaceholder', 'Label text')}
            onChange={(event) => onChange({ ...labels, [locale]: event.target.value })}
          />
          <IconButton
            type="button"
            variant="destructive"
            size="sm"
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
      <div className="grid grid-cols-[100px_1fr_auto] items-end gap-2">
        <Input
          type="text"
          value={newLocale}
          disabled={disabled}
          placeholder={t('promotions.benefits.labels.localePlaceholder', 'Locale code (e.g. en)')}
          onChange={(event) => setNewLocale(event.target.value)}
        />
        <span />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || !newLocale.trim() || Object.prototype.hasOwnProperty.call(labels, newLocale.trim())}
          onClick={() => {
            const locale = newLocale.trim()
            if (!locale) return
            onChange({ ...labels, [locale]: '' })
            setNewLocale('')
          }}
        >
          <Plus className="size-4" />
          {t('promotions.benefits.labels.addLocale', 'Add locale')}
        </Button>
      </div>
    </div>
  )
}

export type BenefitCardProps = {
  benefit: LocalBenefitNode
  disabled?: boolean
  onTypeChange: (benefitType: BenefitTypeId) => void
  onConfigChange: (config: Record<string, unknown>) => void
  onLabelsChange: (labels: Record<string, string>) => void
  onDelete: () => void
}

export function BenefitCard({ benefit, disabled, onTypeChange, onConfigChange, onLabelsChange, onDelete }: BenefitCardProps) {
  const t = useT()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: benefit.clientId,
    disabled,
  })
  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition }

  const typeOptions: ComboboxOption[] = BENEFIT_TYPE_OPTIONS.map((benefitType) => ({
    value: benefitType,
    label: t(BENEFIT_TYPE_LABEL_KEYS[benefitType].key, BENEFIT_TYPE_LABEL_KEYS[benefitType].fallback),
  }))

  const fieldSpecs = BENEFIT_FIELD_SPECS[benefit.benefitType]
  const tiers = Array.isArray(benefit.config.tiers) ? (benefit.config.tiers as TierRow[]) : []

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
                <ComboboxInput
                  value={benefit.benefitType}
                  onChange={(next) => onTypeChange(next as BenefitTypeId)}
                  suggestions={typeOptions}
                  allowCustomValues={false}
                  disabled={disabled}
                  placeholder={t('promotions.benefits.typePlaceholder', 'Select a benefit type...')}
                />
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
              <CollapsibleSection
                title={t('promotions.benefits.labels.title', 'Labels')}
                defaultCollapsed
              >
                <LabelsEditor labels={benefit.labels} disabled={disabled} onChange={onLabelsChange} />
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
