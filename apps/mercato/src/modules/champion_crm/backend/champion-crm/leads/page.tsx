import Link from 'next/link'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { ChampionLead } from '../../../data/entities'

async function loadLeads(): Promise<{ items: ChampionLead[]; error: string | null }> {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromCookies()
    if (!auth?.tenantId) return { items: [], error: 'Unauthorized' }
    const organizationId = auth.orgId
    if (!organizationId) return { items: [], error: 'Organization context is required' }
    const em = container.resolve('em') as EntityManager
    const items = await findWithDecryption(
      em,
      ChampionLead,
      {
        tenantId: auth.tenantId,
        organizationId,
        deletedAt: null,
      } as FilterQuery<ChampionLead>,
      { orderBy: { createdAt: 'desc' }, limit: 50 },
      { tenantId: auth.tenantId, organizationId },
    )
    return { items, error: null }
  } catch (error) {
    console.error('champion_crm lead inbox load failed', error)
    return { items: [], error: 'Failed to load Champion CRM leads.' }
  }
}

function formatDate(value: Date | null | undefined): string {
  if (!value) return '-'
  return value.toLocaleString()
}

export default async function ChampionCrmLeadsPage() {
  const { t } = await resolveTranslations()
  const { items, error } = await loadLeads()
  return (
    <Page>
      <PageHeader
        title={t('champion_crm.leads.inbox.title', 'Lead inbox')}
        description={t('champion_crm.leads.inbox.description', 'Inbound Champion CRM leads awaiting deduplication and qualification.')}
      />
      <PageBody>
        {error ? <ErrorMessage label={error} /> : null}
        <div className="overflow-hidden rounded-md border bg-background">
          <table className="w-full table-fixed text-sm">
            <thead className="bg-muted/40 text-left text-muted-foreground">
              <tr>
                <th className="w-[24%] px-3 py-2 font-medium">{t('champion_crm.leads.table.lead', 'Lead')}</th>
                <th className="w-[18%] px-3 py-2 font-medium">{t('champion_crm.leads.table.source', 'Source')}</th>
                <th className="w-[16%] px-3 py-2 font-medium">{t('champion_crm.leads.table.dedup', 'Dedup')}</th>
                <th className="w-[18%] px-3 py-2 font-medium">{t('champion_crm.leads.table.qualification', 'Qualification')}</th>
                <th className="w-[16%] px-3 py-2 font-medium">{t('champion_crm.leads.table.created', 'Created')}</th>
                <th className="w-[8%] px-3 py-2 font-medium">{t('common.open', 'Open')}</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td className="px-3 py-8 text-center text-muted-foreground" colSpan={6}>
                    {t('champion_crm.leads.empty', 'No leads yet.')}
                  </td>
                </tr>
              ) : items.map((lead) => (
                <tr key={lead.id} className="border-t">
                  <td className="truncate px-3 py-2">
                    <div className="truncate font-medium">{lead.nameRaw || lead.emailNormalized || lead.phoneE164 || t('champion_crm.leads.unnamed', 'Unnamed lead')}</div>
                    <div className="truncate text-xs text-muted-foreground">{lead.emailNormalized || lead.phoneE164 || lead.id}</div>
                  </td>
                  <td className="truncate px-3 py-2">{lead.source || '-'}</td>
                  <td className="truncate px-3 py-2">{lead.techStatus}</td>
                  <td className="truncate px-3 py-2">{lead.qualificationStatus}</td>
                  <td className="truncate px-3 py-2">{formatDate(lead.createdAt)}</td>
                  <td className="px-3 py-2">
                    <Link className="text-primary underline-offset-4 hover:underline" href={`/backend/champion-crm/leads/${lead.id}`}>
                      {t('common.open', 'Open')}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PageBody>
    </Page>
  )
}

