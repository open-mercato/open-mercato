import Link from 'next/link'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  ChampionActivity,
  ChampionApartment,
  ChampionContact,
  ChampionDeal,
  ChampionInvestment,
  ChampionLead,
} from '../../../../data/entities'
import { advanceDealStageAction, assignApartmentAction, markDealWonAction } from '../../actions'

type DealData = {
  deal: ChampionDeal | null
  contact: ChampionContact | null
  lead: ChampionLead | null
  investment: ChampionInvestment | null
  apartment: ChampionApartment | null
  apartments: ChampionApartment[]
  activities: ChampionActivity[]
  error: string | null
}

async function loadDealDetail(id: string): Promise<DealData> {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromCookies()
    if (!auth?.tenantId) return emptyDetail('Unauthorized')
    const organizationId = auth.orgId
    if (!organizationId) return emptyDetail('Organization context is required')
    const scope = { tenantId: auth.tenantId, organizationId }
    const em = container.resolve('em') as EntityManager
    const deal = await findOneWithDecryption(
      em,
      ChampionDeal,
      { id, tenantId: auth.tenantId, organizationId, deletedAt: null } as FilterQuery<ChampionDeal>,
      {},
      scope,
    )
    if (!deal) return emptyDetail(null)
    const [contact, lead, investment, apartment, activities] = await Promise.all([
      findOneWithDecryption(em, ChampionContact, { id: deal.contactId, tenantId: auth.tenantId, organizationId, deletedAt: null } as FilterQuery<ChampionContact>, {}, scope),
      deal.sourceLeadId || deal.leadId
        ? findOneWithDecryption(em, ChampionLead, { id: deal.sourceLeadId ?? deal.leadId, tenantId: auth.tenantId, organizationId, deletedAt: null } as FilterQuery<ChampionLead>, {}, scope)
        : Promise.resolve(null),
      deal.investmentId
        ? findOneWithDecryption(em, ChampionInvestment, { id: deal.investmentId, tenantId: auth.tenantId, organizationId, deletedAt: null } as FilterQuery<ChampionInvestment>, {}, scope)
        : Promise.resolve(null),
      deal.apartmentId
        ? findOneWithDecryption(em, ChampionApartment, { id: deal.apartmentId, tenantId: auth.tenantId, organizationId, deletedAt: null } as FilterQuery<ChampionApartment>, {}, scope)
        : Promise.resolve(null),
      findWithDecryption(em, ChampionActivity, { dealId: deal.id, tenantId: auth.tenantId, organizationId, deletedAt: null } as FilterQuery<ChampionActivity>, { orderBy: { occurredAt: 'desc' }, limit: 20 }, scope),
    ])
    const apartments = await findWithDecryption(
      em,
      ChampionApartment,
      {
        tenantId: auth.tenantId,
        organizationId,
        deletedAt: null,
        ...(deal.investmentId ? { investmentId: deal.investmentId } : {}),
      } as FilterQuery<ChampionApartment>,
      { orderBy: { unitNumber: 'asc' }, limit: 50 },
      scope,
    )
    return { deal, contact, lead, investment, apartment, apartments, activities, error: null }
  } catch (error) {
    console.error('champion_crm deal detail load failed', error)
    return emptyDetail('Failed to load Champion CRM deal.')
  }
}

function emptyDetail(error: string | null): DealData {
  return { deal: null, contact: null, lead: null, investment: null, apartment: null, apartments: [], activities: [], error }
}

function formatMoney(amount: string | null | undefined, currency: string | null | undefined): string {
  if (!amount) return '-'
  return `${amount} ${currency || 'PLN'}`
}

function formatDate(value: Date | null | undefined): string {
  if (!value) return '-'
  return value.toLocaleString()
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate text-sm">{value || '-'}</dd>
    </div>
  )
}

export default async function ChampionCrmDealDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { t } = await resolveTranslations()
  const { id } = await params
  const data = await loadDealDetail(id)
  if (data.error) {
    return (
      <Page>
        <PageHeader title={t('champion_crm.deals.detail.title', 'Deal detail')} />
        <PageBody><ErrorMessage label={data.error} /></PageBody>
      </Page>
    )
  }
  if (!data.deal) {
    return (
      <Page>
        <PageHeader title={t('champion_crm.deals.detail.notFoundTitle', 'Deal not found')} />
        <PageBody><ErrorMessage label={t('champion_crm.deals.detail.notFound', 'The requested deal was not found.')} /></PageBody>
      </Page>
    )
  }

  const deal = data.deal
  const assignableApartments = data.apartments.filter((apartment) => apartment.status !== 'sold' || apartment.id === deal.apartmentId)
  return (
    <Page>
      <PageHeader title={deal.title} description={`${deal.dealNumber || deal.id} · ${deal.stage || deal.status}`} />
      <PageBody>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="space-y-4">
            <div className="rounded-md border bg-background p-4">
              <h2 className="text-base font-semibold">{t('champion_crm.deals.detail.pipeline', 'Pipeline')}</h2>
              <dl className="mt-4 grid gap-4 md:grid-cols-4">
                <Field label={t('champion_crm.fields.status', 'Status')} value={deal.status} />
                <Field label={t('champion_crm.fields.stage', 'Stage')} value={deal.stage} />
                <Field label={t('champion_crm.fields.valueGross', 'Value')} value={formatMoney(deal.valueGross ?? deal.budgetAmount, deal.currency ?? deal.budgetCurrency)} />
                <Field label={t('champion_crm.fields.stageChangedAt', 'Stage changed')} value={formatDate(deal.stageChangedAt)} />
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                {['qualified', 'offer_open', 'reservation_agreement'].map((stage) => (
                  <form key={stage} action={advanceDealStageAction}>
                    <input name="dealId" type="hidden" value={deal.id} />
                    <input name="stage" type="hidden" value={stage} />
                    <Button type="submit" size="sm" variant={deal.stage === stage ? 'default' : 'outline'}>{stage}</Button>
                  </form>
                ))}
                <form action={markDealWonAction}>
                  <input name="dealId" type="hidden" value={deal.id} />
                  <Button type="submit" size="sm">{t('champion_crm.actions.markWon', 'Mark won')}</Button>
                </form>
              </div>
            </div>

            <div className="rounded-md border bg-background p-4">
              <h2 className="text-base font-semibold">{t('champion_crm.deals.detail.apartment', 'Apartment')}</h2>
              <dl className="mt-4 grid gap-4 md:grid-cols-4">
                <Field label={t('champion_crm.fields.investment', 'Investment')} value={data.investment?.name} />
                <Field label={t('champion_crm.fields.unitNumber', 'Unit')} value={data.apartment?.unitNumber} />
                <Field label={t('champion_crm.fields.apartmentStatus', 'Unit status')} value={data.apartment?.status} />
                <Field label={t('champion_crm.fields.listPriceGross', 'List price')} value={formatMoney(data.apartment?.listPriceGross ?? data.apartment?.priceAmount, data.apartment?.priceCurrency)} />
              </dl>
              <form action={assignApartmentAction} className="mt-4 flex flex-wrap items-end gap-2">
                <input name="dealId" type="hidden" value={deal.id} />
                <label className="grid gap-1 text-sm">
                  <span className="text-xs font-medium uppercase text-muted-foreground">{t('champion_crm.fields.assignUnit', 'Assign unit')}</span>
                  <select name="apartmentId" className="h-9 rounded-md border bg-background px-3 text-sm" defaultValue={deal.apartmentId ?? assignableApartments[0]?.id ?? ''}>
                    {assignableApartments.map((apartment) => (
                      <option key={apartment.id} value={apartment.id}>
                        {apartment.unitNumber} · {apartment.status} · {formatMoney(apartment.listPriceGross ?? apartment.priceAmount, apartment.priceCurrency)}
                      </option>
                    ))}
                  </select>
                </label>
                <Button type="submit" size="sm" disabled={assignableApartments.length === 0}>
                  {t('champion_crm.actions.assignReserve', 'Assign / reserve')}
                </Button>
              </form>
            </div>

            <div className="rounded-md border bg-background p-4">
              <h2 className="text-base font-semibold">{t('champion_crm.activities.title', 'Timeline')}</h2>
              <div className="mt-3 divide-y">
                {data.activities.length === 0 ? (
                  <p className="py-3 text-sm text-muted-foreground">{t('champion_crm.activities.empty', 'No activity yet.')}</p>
                ) : data.activities.map((activity) => (
                  <div key={activity.id} className="py-3">
                    <div className="text-sm font-medium">{activity.title}</div>
                    <div className="text-xs text-muted-foreground">{activity.type} · {formatDate(activity.occurredAt)}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <aside className="space-y-4">
            <div className="rounded-md border bg-background p-4">
              <h2 className="text-base font-semibold">{t('champion_crm.contacts.title', 'Contact')}</h2>
              {data.contact ? (
                <div className="mt-3 text-sm">
                  <Link className="font-medium text-primary underline-offset-4 hover:underline" href={`/backend/champion-crm/contacts/${data.contact.id}`}>
                    {data.contact.displayName}
                  </Link>
                  <div className="mt-1 text-xs text-muted-foreground">{data.contact.lifecycle}</div>
                </div>
              ) : <p className="mt-3 text-sm text-muted-foreground">-</p>}
            </div>
            <div className="rounded-md border bg-background p-4">
              <h2 className="text-base font-semibold">{t('champion_crm.leads.detail.lead', 'Lead')}</h2>
              {data.lead ? (
                <Link className="mt-3 inline-flex text-sm text-primary underline-offset-4 hover:underline" href={`/backend/champion-crm/leads/${data.lead.id}`}>
                  {data.lead.nameRaw || data.lead.emailNormalized || data.lead.id}
                </Link>
              ) : <p className="mt-3 text-sm text-muted-foreground">-</p>}
            </div>
          </aside>
        </div>
      </PageBody>
    </Page>
  )
}
