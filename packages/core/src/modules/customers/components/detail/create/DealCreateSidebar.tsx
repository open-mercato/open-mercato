"use client"

import * as React from 'react'
import { Sparkles } from 'lucide-react'
import { DealSectionCard } from './DealSectionCard'
import { DealTipsCard } from './DealTipsCard'
import {
  DealCustomAttributes,
  type DealCustomAttributesLoadState,
} from './DealCustomAttributes'
import type { Translate } from './dealFormTypes'

export type DealCreateSidebarProps = {
  tr: Translate
  customValues: Record<string, unknown>
  onCustomChange: (key: string, value: unknown) => void
  errors: Record<string, string>
  disabled: boolean
  customCount: number
  manageHref: string
  onCustomLoaded: (state: DealCustomAttributesLoadState) => void
}

export function DealCreateSidebar({
  tr,
  customValues,
  onCustomChange,
  errors,
  disabled,
  customCount,
  manageHref,
  onCustomLoaded,
}: DealCreateSidebarProps) {
  return (
    <div className="space-y-4">
      <DealSectionCard
        icon={Sparkles}
        title={tr('customers.deals.create.sections.custom.title', 'Custom attributes')}
        subtitle={tr('customers.deals.create.sections.custom.subtitle', '{count} fields defined for this tenant', {
          count: customCount,
        })}
      >
        <DealCustomAttributes
          values={customValues}
          onChange={onCustomChange}
          errors={errors}
          disabled={disabled}
          manageHref={manageHref}
          labels={{
            manage: tr('customers.deals.create.sections.custom.manage', 'Manage fields'),
            empty: tr('customers.deals.create.sections.custom.empty', 'No custom fields defined for deals yet.'),
            loading: tr('customers.deals.create.sections.custom.loading', 'Loading custom fields…'),
          }}
          onLoaded={onCustomLoaded}
        />
      </DealSectionCard>

      <DealTipsCard
        title={tr('customers.deals.create.tips.title', 'Tips for better deals')}
        tips={[
          tr(
            'customers.deals.create.tips.item1',
            'Use the company name + short deliverable format in the title (e.g. "Copperleaf — Q3 Renewal")',
          ),
          tr(
            'customers.deals.create.tips.item2',
            'Set probability based on pipeline stage: Qual 10-25%, Proposal 30-50%, Negotiation 50-75%, Contract 75-90%',
          ),
          tr(
            'customers.deals.create.tips.item3',
            'Link primary decision maker as first person — they get default email CC on activities',
          ),
        ]}
      />
    </div>
  )
}

export default DealCreateSidebar
