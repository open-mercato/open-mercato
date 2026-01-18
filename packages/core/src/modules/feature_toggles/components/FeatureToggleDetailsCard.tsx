"use client"
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { FeatureToggle } from '../data/validators'

type FeatureToggleDetailsCardProps = {
  featureToggleItem?: FeatureToggle
}

function DefaultValueDisplay({ featureToggleItem }: { featureToggleItem?: FeatureToggle }) {

  if (!featureToggleItem?.defaultValue) {
    return <p className="text-base text-muted-foreground">-</p>
  }

  switch (featureToggleItem.type) {
    case 'boolean':
      return (
        <p className="text-base font-semibold text-foreground">
          {featureToggleItem.defaultValue ? useT()('feature_toggles.values.true', 'True') : useT()('feature_toggles.values.false', 'False')}
        </p>
      )

    case 'string':
      return (
        <p className="text-base font-semibold text-foreground">
          {featureToggleItem.defaultValue}
        </p>
      )

    case 'number':
      return (
        <p className="text-base font-semibold text-foreground">
          {featureToggleItem.defaultValue}
        </p>
      )

    case 'json':
      return (
        <div className="text-base font-semibold text-foreground">
          <pre className="bg-muted/30 p-2 rounded text-sm font-mono overflow-x-auto whitespace-pre-wrap">
            {typeof featureToggleItem.defaultValue === 'object'
              ? JSON.stringify(featureToggleItem.defaultValue, null, 2)
              : featureToggleItem.defaultValue}
          </pre>
        </div>
      )

    default:
      return <p className="text-base text-muted-foreground">-</p>
  }
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
        </div>
      </div>
      <div className="rounded-lg border bg-card p-4">
        <h2 className="mb-4 text-sm font-semibold uppercase text-muted-foreground">{t('feature_toggles.detail.description', 'Description')}</h2>
        <p className="text-base text-foreground">{featureToggleItem?.description ?? '-'}</p>
      </div>
      <div className="rounded-lg border bg-card p-4">
        <h2 className="mb-4 text-sm font-semibold uppercase text-muted-foreground">{t('feature_toggles.detail.defaultValue', 'Default Value')}</h2>
        <DefaultValueDisplay featureToggleItem={featureToggleItem} />
      </div>
    </div>
  );
}
