import Link from 'next/link'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { ChampionActivity, ChampionAuditEvent, ChampionContact, ChampionDeal, ChampionLead } from '../../../../data/entities'
import { createDealFromLeadAction, qualifyLeadAction } from '../../actions'

type DetailData = {
  lead: ChampionLead | null
  contact: ChampionContact | null
  deals: ChampionDeal[]
  activities: ChampionActivity[]
  auditEvents: ChampionAuditEvent[]
  error: string | null
}

async function loadLeadDetail(id: string): Promise<DetailData> {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromCookies()
    if (!auth?.tenantId) return emptyDetail('Unauthorized')
    const organizationId = auth.orgId
    if (!organizationId) return emptyDetail('Organization context is required')
    const scope = { tenantId: auth.tenantId, organizationId }
    const em = container.resolve('em') as EntityManager
    const lead = await findOneWithDecryption(
      em,
      ChampionLead,
      { id, tenantId: auth.tenantId, organizationId, deletedAt: null } as FilterQuery<ChampionLead>,
      {},
      scope,
    )
    if (!lead) return { ...emptyDetail(null), lead: null }
    const contact = lead.contactId
      ? await findOneWithDecryption(
        em,
        ChampionContact,
        { id: lead.contactId, tenantId: auth.tenantId, organizationId, deletedAt: null } as FilterQuery<ChampionContact>,
        {},
        scope,
      )
      : null
    const deals = contact
      ? await findWithDecryption(
        em,
        ChampionDeal,
        { contactId: contact.id, tenantId: auth.tenantId, organizationId, deletedAt: null } as FilterQuery<ChampionDeal>,
        { orderBy: { createdAt: 'desc' }, limit: 10 },
        scope,
      )
      : []
    const activities = await findWithDecryption(
      em,
      ChampionActivity,
      { leadId: lead.id, tenantId: auth.tenantId, organizationId, deletedAt: null } as FilterQuery<ChampionActivity>,
      { orderBy: { occurredAt: 'desc' }, limit: 20 },
      scope,
    )
    const auditEvents = await findWithDecryption(
      em,
      ChampionAuditEvent,
      { entityType: 'lead', entityId: lead.id, tenantId: auth.tenantId, organizationId } as FilterQuery<ChampionAuditEvent>,
      { orderBy: { createdAt: 'desc' }, limit: 20 },
      scope,
    )
    return { lead, contact, deals, activities, auditEvents, error: null }
  } catch (error) {
    console.error('champion_crm lead detail load failed', error)
    return emptyDetail('Failed to load Champion CRM lead.')
  }
}

function emptyDetail(error: string | null): DetailData {
  return { lead: null, contact: null, deals: [], activities: [], auditEvents: [], error }
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

export default async function ChampionCrmLeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { t } = await resolveTranslations()
  const { id } = await params
  const data = await loadLeadDetail(id)
  if (data.error) {
    return (
      <Page>
        <PageHeader title={t('champion_crm.leads.detail.title', 'Lead detail')} />
        <PageBody><ErrorMessage label={data.error} /></PageBody>
      </Page>
    )
  }
  if (!data.lead) {
    return (
      <Page>
        <PageHeader title={t('champion_crm.leads.detail.notFoundTitle', 'Lead not found')} />
        <PageBody>
          <ErrorMessage label={t('champion_crm.leads.detail.notFound', 'The requested lead was not found.')} />
          <Link className="text-primary underline-offset-4 hover:underline" href="/backend/champion-crm/leads">
            {t('champion_crm.leads.detail.back', 'Back to leads')}
          </Link>
        </PageBody>
      </Page>
    )
  }

  const lead = data.lead
  const title = lead.nameRaw || lead.emailNormalized || lead.phoneE164 || t('champion_crm.leads.unnamed', 'Unnamed lead')
  return (
    <Page>
      <PageHeader title={title} description={t('champion_crm.leads.detail.description', 'Contact 360 shell for qualification, deal, investment, apartment, activity, and audit context.')} />
      <PageBody>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="space-y-4">
            <div className="rounded-md border bg-background p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-base font-semibold">{t('champion_crm.leads.detail.lead', 'Lead')}</h2>
                <div className="flex flex-wrap gap-2">
                  <form action={qualifyLeadAction}>
                    <input name="leadId" type="hidden" value={lead.id} />
                    <Button type="submit" size="sm" variant="outline">{t('champion_crm.actions.qualify', 'Qualify')}</Button>
                  </form>
                  <form action={createDealFromLeadAction}>
                    <input name="leadId" type="hidden" value={lead.id} />
                    <Button type="submit" size="sm">{lead.dealId ? t('champion_crm.actions.openDeal', 'Open deal') : t('champion_crm.actions.createDeal', 'Create deal')}</Button>
                  </form>
                </div>
              </div>
              <dl className="mt-4 grid gap-4 md:grid-cols-3">
                <Field label={t('champion_crm.fields.source', 'Source')} value={lead.source} />
                <Field label={t('champion_crm.fields.formType', 'Form type')} value={lead.formType} />
                <Field label={t('champion_crm.fields.email', 'Email')} value={lead.emailNormalized} />
                <Field label={t('champion_crm.fields.phone', 'Phone')} value={lead.phoneE164} />
                <Field label={t('champion_crm.fields.investmentId', 'Investment')} value={lead.investmentId} />
                <Field label={t('champion_crm.fields.techStatus', 'Dedup status')} value={lead.techStatus} />
                <Field label={t('champion_crm.fields.qualificationStatus', 'Qualification')} value={lead.qualificationStatus} />
                <Field label={t('champion_crm.fields.createdAt', 'Created')} value={formatDate(lead.createdAt)} />
              </dl>
              {lead.message ? (
                <div className="mt-4 rounded-md bg-muted/30 p-3 text-sm">
                  <div className="text-xs font-medium uppercase text-muted-foreground">{t('champion_crm.fields.message', 'Message')}</div>
                  <p className="mt-1 whitespace-pre-wrap">{lead.message}</p>
                </div>
              ) : null}
            </div>
            <div className="rounded-md border bg-background p-4">
              <h2 className="text-base font-semibold">{t('champion_crm.leads.detail.activity', 'Activity')}</h2>
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
              <h2 className="text-base font-semibold">{t('champion_crm.leads.detail.contact360', 'Contact 360')}</h2>
              {data.contact ? (
                <>
                  <dl className="mt-4 grid gap-3">
                    <Field label={t('champion_crm.fields.name', 'Name')} value={data.contact.displayName} />
                    <Field label={t('champion_crm.fields.lifecycle', 'Lifecycle')} value={data.contact.lifecycle} />
                    <Field label={t('champion_crm.fields.email', 'Email')} value={data.contact.primaryEmail} />
                    <Field label={t('champion_crm.fields.phone', 'Phone')} value={data.contact.primaryPhoneE164} />
                  </dl>
                  <Link className="mt-4 inline-flex text-sm text-primary underline-offset-4 hover:underline" href={`/backend/champion-crm/contacts/${data.contact.id}`}>
                    {t('champion_crm.contacts.open360', 'Open Contact 360')}
                  </Link>
                </>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">{t('champion_crm.contacts.empty', 'No contact linked yet.')}</p>
              )}
            </div>
            <div className="rounded-md border bg-background p-4">
              <h2 className="text-base font-semibold">{t('champion_crm.leads.detail.deals', 'Deals')}</h2>
              <div className="mt-3 divide-y">
                {data.deals.length === 0 ? (
                  <p className="py-3 text-sm text-muted-foreground">{t('champion_crm.deals.empty', 'No deals yet.')}</p>
                ) : data.deals.map((deal) => (
                  <div key={deal.id} className="py-3 text-sm">
                    <Link className="font-medium text-primary underline-offset-4 hover:underline" href={`/backend/champion-crm/deals/${deal.id}`}>
                      {deal.title}
                    </Link>
                    <div className="text-xs text-muted-foreground">{deal.dealNumber || deal.status} · {deal.stage || deal.status}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-md border bg-background p-4">
              <h2 className="text-base font-semibold">{t('champion_crm.leads.detail.audit', 'Audit')}</h2>
              <div className="mt-3 divide-y">
                {data.auditEvents.length === 0 ? (
                  <p className="py-3 text-sm text-muted-foreground">{t('champion_crm.audit.empty', 'No audit events yet.')}</p>
                ) : data.auditEvents.map((event) => (
                  <div key={event.id} className="py-3 text-sm">
                    <div className="font-medium">{event.action}</div>
                    <div className="text-xs text-muted-foreground">{formatDate(event.createdAt)}</div>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
      </PageBody>
    </Page>
  )
}
