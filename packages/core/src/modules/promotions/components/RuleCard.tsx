'use client'

// Inline rule card (Step 1.7, SPEC-055 §UI/UX "Rule Group Tree Builder"): a filterable
// type dropdown restricted to the shipped rule types (Release 4's eight plus
// `delivery_method`, un-hidden in Release 5 by D-R5-17), plus type-specific inline fields
// driven by `ruleFieldSpecs.ts`, plus a delete button.

import * as React from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, X } from 'lucide-react'
import { Card, CardContent } from '@open-mercato/ui/primitives/card'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { RuleFieldInput } from './RuleFieldInput'
import { RULE_FIELD_SPECS } from './ruleFieldSpecs'
import { RULE_TYPE_OPTIONS, type LocalRuleNode, type RuleTypeId } from './ruleTreeTypes'

const RULE_TYPE_LABEL_KEYS: Record<RuleTypeId, { key: string; fallback: string }> = {
  order_value: { key: 'promotions.rules.types.order_value', fallback: 'Order value' },
  order_date: { key: 'promotions.rules.types.order_date', fallback: 'Order date' },
  product_count: { key: 'promotions.rules.types.product_count', fallback: 'Product count' },
  row_total: { key: 'promotions.rules.types.row_total', fallback: 'Row total' },
  product: { key: 'promotions.rules.types.product', fallback: 'Specific product' },
  category: { key: 'promotions.rules.types.category', fallback: 'Category' },
  customer_group: { key: 'promotions.rules.types.customer_group', fallback: 'Customer group' },
  code: { key: 'promotions.rules.types.code', fallback: 'Promotion code' },
  delivery_method: { key: 'promotions.rules.types.delivery_method', fallback: 'Delivery method' },
}

export type RuleCardProps = {
  rule: LocalRuleNode
  disabled?: boolean
  onTypeChange: (ruleType: RuleTypeId) => void
  onConfigChange: (config: Record<string, unknown>) => void
  onDelete: () => void
}

export function RuleCard({ rule, disabled, onTypeChange, onConfigChange, onDelete }: RuleCardProps) {
  const t = useT()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: rule.clientId,
    disabled,
  })
  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition }

  const typeOptions = RULE_TYPE_OPTIONS.map((ruleType) => ({
    value: ruleType,
    label: t(RULE_TYPE_LABEL_KEYS[ruleType].key, RULE_TYPE_LABEL_KEYS[ruleType].fallback),
  }))

  const fieldSpecs = RULE_FIELD_SPECS[rule.ruleType] ?? []

  return (
    <div ref={setNodeRef} style={style}>
      <Card className={isDragging ? 'border-primary shadow-md' : undefined}>
        <CardContent className="space-y-3 p-3">
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
                <span className="text-muted-foreground">{t('promotions.rules.typeLabel', 'Rule type')}</span>
                <Select
                  value={rule.ruleType}
                  onValueChange={(next) => onTypeChange(next as RuleTypeId)}
                  disabled={disabled}
                >
                  <SelectTrigger size={36}>
                    <SelectValue placeholder={t('promotions.rules.typePlaceholder', 'Select a rule type...')} />
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
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {fieldSpecs.map((spec) => (
                  <RuleFieldInput
                    key={spec.key}
                    spec={spec}
                    value={rule.config[spec.key]}
                    disabled={disabled}
                    onChange={(next) => onConfigChange({ ...rule.config, [spec.key]: next })}
                  />
                ))}
              </div>
            </div>
            <IconButton
              type="button"
              variant="destructive"
              size="sm"
              aria-label={t('promotions.rules.delete', 'Delete rule')}
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
