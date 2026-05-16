import Link from 'next/link'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import {
  ChampionActivity,
  ChampionApartment,
  ChampionContact,
  ChampionDeal,
  ChampionInvestment,
  ChampionLead,
} from '../../../../data/entities'

type ContactData = {
  contact: ChampionContact | null
  leads: ChampionLead[]
  deals: ChampionDeal[]
  investments: ChampionInvestment[]
  apartments: ChampionApartment[]
  activities: ChampionActivity[]
  error: string | null
}

async function loadContact360(id: string): Promise<ContactData> {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromCookies()
    if (!auth?.tenantId) return emptyDetail('Unauthorized')
    const organizationId = auth.orgId
    if (!organizationId) return emptyDetail('Organization context is required')
    const scope = { tenantId: auth.tenantId, organizationId }
    const em = container.resolve('em') as EntityManager
    const contact = await findOneWithDecryption(
      em,
      ChampionContact,
      { id, tenantId: auth.tenantId, organizationId, deletedAt: null } as FilterQuery<ChampionContact>,
      {},
      scope,
    )
    if (!contact) return emptyDetail(null)
    const [leads, deals, activities] = await Promise.all([
      findWithDecryption(em, ChampionLead, { contactId: contact.id, tenantId: auth.tenantId, organizationId, deletedAt: null } as FilterQuery<ChampionLead>, { orderBy: { createdAt: 'desc' }, limit: 20 }, scope),
      findWithDecryption(em, ChampionDeal, { contactId: contact.id, tenantId: auth.tenantId, organizationId, deletedAt: null } as FilterQuery<ChampionDeal>, { orderBy: { createdAt: 'desc' }, limit: 20 }, scope),
      findWithDecryption(em, ChampionActivity, { contactId: contact.id, tenantId: auth.tenantId, organizationId, deletedAt: null } as FilterQuery<ChampionActivity>, { orderBy: { occurredAt: 'desc' }, limit: 30 }, scope),
    ])
    const investmentIds = Array.from(new Set(deals.map((deal) => deal.investmentId).filter((value): value is string => Boolean(value))))
    const apartmentIds = Array.from(new Set(deals.map((deal) => deal.apartmentId).filter((value): value is string => Boolean(value))))
    const investments = investmentIds.length
      ? await findWithDecryption(em, ChampionInvestment, { id: { $in: investmentIds }, tenantId: auth.tenantId, organizationId, deletedAt: null } as FilterQuery<ChampionInvestment>, {}, scope)
      : []
    const apartments = apartmentIds.length
      ? await findWithDecryption(em, ChampionApartment, { id: { $in: apartmentIds }, tenantId: auth.tenantId, organizationId, deletedAt: null } as FilterQuery<ChampionApartment>, {}, scope)
      : []
    return { contact, leads, deals, investments, apartments, activities, error: null }
  } catch (error) {
    console.error('champion_crm contact 360 load failed', error)
    return emptyDetail('Failed to load Champion CRM Contact 360.')
  }
}

function emptyDetail(error: string | null): ContactData {
  return { contact: null, leads: [], deals: [], investments: [], apartments: [], activities: [], error }
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

export default async function ChampionCrmContact360Page({ params }: { params: Promise<{ id: string }> }) {
  const { t } = await resolveTranslations()
  const { id } = await params
  const data = await loadContact360(id)
  if (data.error) {
    return (
      <Page>
        <PageHeader title={t('champion_crm.contacts.detail.title', 'Contact 360')} />
        <PageBody><ErrorMessage label={data.error} /></PageBody>
      </Page>
    )
  }
  if (!data.contact) {
    return (
      <Page>
        <PageHeader title={t('champion_crm.contacts.detail.notFoundTitle', 'Contact not found')} />
        <PageBody><ErrorMessage label={t('champion_crm.contacts.detail.notFound', 'The requested contact was not found.')} /></PageBody>
      </Page>
    )
  }

  const contact = data.contact
  const investmentById = new Map(data.investments.map((investment) => [investment.id, investment]))
  const apartmentById = new Map(data.apartments.map((apartment) => [apartment.id, apartment]))
  return (
    <Page>
      <PageHeader title={contact.displayName} description={t('champion_crm.contacts.detail.description', 'Champion CRM Contact 360: leads, deals, investment, apartment, and timeline.')} />
      <PageBody>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="space-y-4">
            <div className="rounded-md border bg-background p-4">
              <h2 className="text-base font-semibold">{t('champion_crm.contacts.title', 'Contact')}</h2>
              <dl className="mt-4 grid gap-4 md:grid-cols-4">
                <Field label={t('champion_crm.fields.lifecycle', 'Lifecycle')} value={contact.lifecycle} />
                <Field label={t('champion_crm.fields.email', 'Email')} value={contact.primaryEmail} />
                <Field label={t('champion_crm.fields.phone', 'Phone')} value={contact.primaryPhoneE164} />
                <Field label={t('champion_crm.fields.lastLeadSource', 'Last lead source')} value={contact.lastLeadSource} />
              </dl>
            </div>

            <div className="rounded-md border bg-background p-4">
              <h2 className="text-base font-semibold">{t('champion_crm.leads.inbox.title', 'Lead inbox')}</h2>
              <div className="mt-3 divide-y">
                {data.leads.length === 0 ? <p className="py-3 text-sm text-muted-foreground">-</p> : data.leads.map((lead) => (
                  <div key={lead.id} className="py-3 text-sm">
                    <Link className="font-medium text-primary underline-offset-4 hover:underline" href={`/backend/champion-crm/leads/${lead.id}`}>
                      {lead.nameRaw || lead.emailNormalized || lead.id}
                    </Link>
                    <div className="text-xs text-muted-foreground">{lead.qualificationStatus} · {lead.source || '-'}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-md border bg-background p-4">
              <h2 className="text-base font-semibold">{t('champion_crm.leads.detail.deals', 'Deals')}</h2>
              <div className="mt-3 divide-y">
                {data.deals.length === 0 ? <p className="py-3 text-sm text-muted-foreground">-</p> : data.deals.map((deal) => {
                  const investment = deal.investmentId ? investmentById.get(deal.investmentId) : null
                  const apartment = deal.apartmentId ? apartmentById.get(deal.apartmentId) : null
                  return (
                    <div key={deal.id} className="py-3 text-sm">
                      <Link className="font-medium text-primary underline-offset-4 hover:underline" href={`/backend/champion-crm/deals/${deal.id}`}>
                        {deal.title}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {deal.stage || deal.status} · {investment?.name || '-'} · {apartment?.unitNumber || '-'}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </section>

          <aside className="rounded-md border bg-background p-4">
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
          </aside>
        </div>
      </PageBody>
    </Page>
  )
}
