import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { E } from '#generated/entities.ids.generated'
import { CustomFieldValuesList } from '../../../../components/detail/CustomFieldValuesList'
import { useCustomFieldDisplay } from '../../../../components/detail/hooks/useCustomFieldDisplay'
import type { DealDetailPayload } from './hooks/types'

export function ReadOnlyDealDetails({
  deal,
  customFields,
  canViewDictionaries,
}: Pick<DealDetailPayload, 'deal' | 'customFields'> & { canViewDictionaries: boolean }) {
  const t = useT()
  const locale = useLocale()
  const hasCustomFields = Object.keys(customFields).length > 0
  const customFieldResources = useCustomFieldDisplay(hasCustomFields ? E.customers.customer_deal : null, {
    includeDictionaryEntries: canViewDictionaries,
  })

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-5">
      <section className="space-y-3">
        <h2 className="text-base font-semibold">
          {t('customers.people.detail.deals.form.details', 'Deal details')}
        </h2>
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="font-medium">{t('customers.people.detail.deals.fields.probability', 'Probability (%)')}</dt>
            <dd className="text-muted-foreground">{deal.probability?.toLocaleString(locale) ?? '—'}</dd>
          </div>
          <div>
            <dt className="font-medium">{t('customers.people.detail.deals.fields.description', 'Description')}</dt>
            <dd className="whitespace-pre-wrap break-words text-muted-foreground">{deal.description || '—'}</dd>
          </div>
        </dl>
      </section>
      {hasCustomFields ? (
        <section className="space-y-3">
          <h2 className="text-base font-semibold">
            {t('customers.people.detail.deals.form.customFields', 'Custom fields')}
          </h2>
          <CustomFieldValuesList values={customFields} resources={customFieldResources} />
        </section>
      ) : null}
    </div>
  )
}
