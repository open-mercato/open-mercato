"use client"
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { FeatureToggleItem } from "@open-mercato/core/modules/feature_toggles/components/hooks/useFeatureToggleItem"

type FeatureToggleDetailsCardProps = {
  featureToggleItem?: FeatureToggleItem
}

export function FeatureToggleDetailsCard({ featureToggleItem }: FeatureToggleDetailsCardProps) {
  const t = useT()
  return (
    <div className="space-y-6">
    <div className="rounded-lg border bg-card p-4">
      <h2 className="mb-4 text-sm font-semibold uppercase text-muted-foreground">
        {t('feature_toggles.detail.details', 'Details')}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">
            {t('feature_toggles.detail.fields.name', 'Name')}
          </p>
          <p className="text-base font-semibold text-foreground">{featureToggleItem?.name ?? '-'}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">
            {t('feature_toggles.detail.fields.identifier', 'Identifier')}
          </p>
          <p className="text-base font-semibold text-foreground">{featureToggleItem?.identifier ?? '-'}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">
            {t('feature_toggles.detail.fields.category', 'Category')}
          </p>
          <p className="text-base text-foreground">{featureToggleItem?.category ?? '-'}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">
            {t('feature_toggles.detail.fields.defaultState', 'Default State')}
          </p>
          <p className="text-base text-foreground">
            {featureToggleItem?.default_state === undefined
              ? '-'
              : featureToggleItem.default_state
                ? t('feature_toggles.list.filters.defaultState.enabled', 'Enabled')
                : t('feature_toggles.list.filters.defaultState.disabled', 'Disabled')}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">
            {t('feature_toggles.detail.fields.failMode', 'Fail Mode')}
          </p>
          <p className="text-base text-foreground">{featureToggleItem?.fail_mode ?? '-'}</p>
        </div>
      </div>
    </div>
    <div className="rounded-lg border bg-card p-4">
      <h2 className="mb-4 text-sm font-semibold uppercase text-muted-foreground">{t('feature_toggles.detail.description', 'Description')}</h2>
      <p className="text-base text-foreground">{featureToggleItem?.description ?? '-'}</p>
      </div>
    </div>
  );
}
