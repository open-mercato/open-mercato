"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { Progress } from '@open-mercato/ui/primitives/progress'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { chooseAssignee } from '../../../lib/engine/lead-routing.js'

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

  /**
   * Asked of the router itself, because a tie has exactly one answer.
   *
   * "Whoever has the fewest" is not a predicate every rep at the minimum satisfies: `chooseAssignee` breaks
   * the tie on the user id, so a screen that badged each of them promised the next lead to two people and was
   * wrong about one of them. The same function decides it here as decides it when the lead arrives.
   */
  const nextUpUserId = React.useMemo(() => {
    const decision = chooseAssignee({
      pool: rows.map((row) => row.userId),
      load: Object.fromEntries(rows.map((row) => [row.userId, row.totalOwned])),
    })
    return decision.assign ? decision.userId : null
  }, [rows])

  const load = React.useCallback(async () => {
    setLoading(true)
    setLoadFailed(false)
    try {
      const [routing, people] = await Promise.all([
        apiCall<{ items?: RepRow[]; windowDays?: number }>('/api/marketing_automation/lead-routing'),
        apiCall<{ items?: StaffRow[] }>('/api/staff/team-members/assignable?pageSize=100'),
      ])
      /**
       * A non-ok response is not an empty list.
       *
       * `apiCall` resolves rather than throwing on 401/403/500, so only the `catch` below was ever reached
       * by a transport error — an expired session or a server fault fell through to an empty array and the
       * page rendered its "nothing here yet" state, which is the most reassuring possible lie.
       */
      if (!routing.ok || !Array.isArray(routing.result?.items)) {
        setRows([])
        setLoadFailed(true)
        return
      }
      setRows(routing.result.items)
      if (typeof routing.result?.windowDays === 'number') setWindowDays(routing.result.windowDays)
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
        {/*
          * The error REPLACES the content rather than sitting above it.
          *
          * An empty-state card under the banner still says "no sales reps in the pool", which is a claim about
          * the data nobody managed to read.
          */}
        {loadFailed ? (
          <ErrorMessage
            label={t('marketing_automation.routing.loadFailed', 'Could not load lead routing.')}
            action={(
              <Button variant="outline" size="sm" onClick={() => { void load() }}>
                {t('marketing_automation.routing.retry', 'Try again')}
              </Button>
            )}
          />
        ) : rows.length === 0 ? (
          <ListEmptyState
            title={t('marketing_automation.routing.emptyTitle', 'No sales reps in the pool')}
            description={t('marketing_automation.routing.emptyBody', 'Pick the reps on the marketing settings screen. The "Assign to a sales rep" step then gives each new lead to whoever has the fewest.')}
          />
        ) : (
          <div className="space-y-4">
            <SectionHeader
              title={t('marketing_automation.routing.title', 'Lead routing')}
              help={{
                title: t('marketing_automation.routing.title', 'Lead routing'),
                body: t('marketing_automation.help.routing.page'),
              }}
            />
            <div className="text-xs text-muted-foreground">
              {t('marketing_automation.routing.hint', 'New leads from the last {days} days. Each new lead goes to whoever currently has the fewest.')
                .replace('{days}', String(windowDays))}
            </div>
            {/*
              * The load is the POINT of this screen, so it is drawn rather than described.
              *
              * Routing gives the next lead to whoever carries the fewest, and the previous version printed that
              * number as a grey sentence under a name — leaving the one comparison the screen exists to support
              * to be done in the reader's head, across however many reps there are. The bar is relative to the
              * busiest rep, because the question is never "how many is 14" but "who is free".
              */}
            <div className="grid gap-3 sm:grid-cols-2">
              {rows.map((row) => {
                const busiest = Math.max(...rows.map((entry) => entry.totalOwned), 1)
                const share = Math.round((row.totalOwned / busiest) * 100)
                const nextUp = row.userId === nextUpUserId
                return (
                  <div key={row.userId} className="rounded-md border border-border bg-card p-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="truncate text-sm font-medium text-foreground">
                        {staff.get(row.userId)?.displayName ?? row.userId}
                      </div>
                      {/* Who gets the next one, stated rather than left to be inferred from the bars. */}
                      {nextUp ? (
                        <Badge variant="muted" className="shrink-0 text-xs">
                          {t('marketing_automation.routing.nextUp', 'Next lead goes here')}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="mt-2 flex items-baseline gap-2">
                      <span className="text-2xl font-semibold tabular-nums text-foreground">{row.totalOwned}</span>
                      <span className="text-xs text-muted-foreground">
                        {t('marketing_automation.routing.ownedShort', 'leads in total')}
                      </span>
                    </div>
                    <Progress value={share} tone={nextUp ? 'success' : 'accent'} className="mt-2" />
                    <div className="mt-3">
                      <SectionHeader
                        title={t('marketing_automation.routing.newLeads', 'New this week')}
                        count={row.newLeads.length > 0 ? row.newLeads.length : undefined}
                        titleClassName="text-xs font-medium text-muted-foreground"
                      />
                    </div>
                    {row.newLeads.length === 0 ? (
                      <div className="text-sm text-muted-foreground">
                        {t('marketing_automation.routing.noNew', 'Nothing new this week.')}
                      </div>
                    ) : (
                      <ul className="mt-1 space-y-1">
                        {row.newLeads.map((lead) => (
                          <li key={lead.id} className="border-b border-border py-1 text-sm last:border-b-0">
                            <a className="underline" href={`/backend/marketing/customers/${lead.id}`}>{lead.displayName}</a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </PageBody>
    </Page>
  )
}
