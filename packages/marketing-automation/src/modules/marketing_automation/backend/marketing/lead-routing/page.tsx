"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

type RepRow = {
  userId: string
  totalOwned: number
  newLeads: Array<{ id: string; displayName: string }>
}

type StaffRow = { userId?: string; displayName?: string; email?: string | null }

/**
 * Lead routing: who is carrying what.
 *
 * Names come from the staff directory, matched by user id — this module stores only ids, so a rep who changes
 * their name or address stays correct here without anything being copied into marketing configuration.
 */
export default function LeadRoutingPage() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()

  const [rows, setRows] = React.useState<RepRow[]>([])
  const [staff, setStaff] = React.useState<Map<string, StaffRow>>(new Map())
  const [windowDays, setWindowDays] = React.useState(7)
  const [loading, setLoading] = React.useState(true)
  const [loadFailed, setLoadFailed] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    setLoadFailed(false)
    try {
      const [routing, people] = await Promise.all([
        apiCall<{ items?: RepRow[]; windowDays?: number }>('/api/marketing_automation/lead-routing'),
        apiCall<{ items?: StaffRow[] }>('/api/staff/team-members/assignable?pageSize=100'),
      ])
      setRows(routing.ok && Array.isArray(routing.result?.items) ? routing.result.items : [])
      if (routing.ok && typeof routing.result?.windowDays === 'number') setWindowDays(routing.result.windowDays)
      const directory = new Map<string, StaffRow>()
      for (const member of (people.ok && Array.isArray(people.result?.items) ? people.result.items : [])) {
        if (member.userId) directory.set(member.userId, member)
      }
      setStaff(directory)
    } catch {
      setLoadFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { void load() }, [load, scopeVersion])

  if (loading) {
    return <Page><PageBody><LoadingMessage label={t('marketing_automation.routing.loading', 'Loading lead routing…')} /></PageBody></Page>
  }

  return (
    <Page>
      <PageBody>
        {loadFailed ? (
          <div className="mb-3">
            <ErrorMessage label={t('marketing_automation.routing.loadFailed', 'Could not load lead routing.')} />
          </div>
        ) : null}

        {rows.length === 0 ? (
          <ListEmptyState
            title={t('marketing_automation.routing.emptyTitle', 'No sales reps in the pool')}
            description={t('marketing_automation.routing.emptyBody', 'Pick the reps on the marketing settings screen. The "Assign to a sales rep" step then gives each new lead to whoever has the fewest.')}
          />
        ) : (
          <div className="space-y-6">
            <div className="text-xs text-muted-foreground">
              {t('marketing_automation.routing.hint', 'New leads from the last {days} days. Each new lead goes to whoever currently has the fewest.')
                .replace('{days}', String(windowDays))}
            </div>
            {rows.map((row) => (
              <div key={row.userId}>
                <SectionHeader
                  title={staff.get(row.userId)?.displayName ?? row.userId}
                  count={row.newLeads.length}
                />
                <div className="mb-1 text-xs text-muted-foreground">
                  {t('marketing_automation.routing.owned', 'Carrying {total} leads in total')
                    .replace('{total}', String(row.totalOwned))}
                </div>
                {row.newLeads.length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    {t('marketing_automation.routing.noNew', 'Nothing new this week.')}
                  </div>
                ) : (
                  <ul className="space-y-1">
                    {row.newLeads.map((lead) => (
                      <li key={lead.id} className="border-b border-border py-1 text-sm">
                        <a className="underline" href={`/backend/marketing/customers/${lead.id}`}>{lead.displayName}</a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </PageBody>
    </Page>
  )
}
