'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { CompanyCard, type EnrichedCompanyData } from './CompanyCard'
import { useCustomerDictionary } from './hooks/useCustomerDictionary'

type PersonCompaniesSectionProps = {
  personId: string
  personName: string
  onChanged?: () => void
}

export function PersonCompaniesSection({ personId, personName, onChanged }: PersonCompaniesSectionProps) {
  const t = useT()
  const [items, setItems] = React.useState<EnrichedCompanyData[]>([])
  const [loading, setLoading] = React.useState(true)

  const { data: statusDict } = useCustomerDictionary('statuses')
  const { data: lifecycleDict } = useCustomerDictionary('lifecycle-stages')
  const { data: temperatureDict } = useCustomerDictionary('temperature')
  const { data: renewalQuarterDict } = useCustomerDictionary('renewal-quarters')
  const { data: roleDict } = useCustomerDictionary('person-company-roles')

  const loadData = React.useCallback(async () => {
    setLoading(true)
    try {
      const payload = await readApiResultOrThrow<{ items?: EnrichedCompanyData[] }>(
        `/api/customers/people/${encodeURIComponent(personId)}/companies/enriched`,
        { cache: 'no-store' },
      )
      setItems(Array.isArray(payload?.items) ? payload.items : [])
    } catch (error) {
      const message = error instanceof Error ? error.message : t('customers.people.detail.companies.loadError', 'Failed to load companies.')
      flash(message, 'error')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [personId, t])

  React.useEffect(() => {
    loadData().catch(() => {})
  }, [loadData])

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2].map((i) => (
          <div key={i} className="h-[320px] animate-pulse rounded-[18px] border border-border/60 bg-muted/30" />
        ))}
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="rounded-[18px] border border-dashed border-border/60 px-6 py-12 text-center text-sm text-muted-foreground">
        {t('customers.people.detail.empty.companies', 'No company linked to this person.')}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {items.map((item) => (
        <CompanyCard
          key={item.companyId}
          data={item}
          personName={personName}
          statusMap={statusDict?.map}
          lifecycleMap={lifecycleDict?.map}
          temperatureMap={temperatureDict?.map}
          renewalQuarterMap={renewalQuarterDict?.map}
          roleMap={roleDict?.map}
        />
      ))}
    </div>
  )
}
