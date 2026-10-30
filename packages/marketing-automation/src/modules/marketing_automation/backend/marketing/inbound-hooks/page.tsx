"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { RowActions, type RowActionItem } from '@open-mercato/ui/backend/RowActions'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { ContextHelp } from '@open-mercato/ui/backend/ContextHelp'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader, extractOptimisticLockConflict } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useMarketingMutation } from '../../../components/useMarketingMutation'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { formatDateTime } from '@open-mercato/shared/lib/time'

const LIST_LIMIT = 100

const HOOKS_PATH = '/api/marketing_automation/inbound-hooks'

type HookRow = {
  id: string
  campaignId: string
  campaignName: string | null
  name: string
  url: string | null
  hasUrl: boolean
  revokedAt: string | null
  receivedCount: number
  lastReceivedAt: string | null
  lastOutcome: string | null
  updatedAt: string
}

/**
 * Inbound hooks: the URLs other systems post to.
 *
 * This screen is also where an integrator debugs, on purpose: the endpoint answers the same thing to every
 * caller so a leaked URL cannot be used to probe which addresses exist, which means the only place the
 * outcome of the last post is visible is behind a login — here.
 */
export default function InboundHooksPage() {
  const t = useT()
  const runMutation = useMarketingMutation('inbound_hooks')
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const [rows, setRows] = React.useState<HookRow[]>([])
  const [truncated, setTruncated] = React.useState(false)
  const [campaigns, setCampaigns] = React.useState<Array<{ id: string; name: string }>>([])
  const [loading, setLoading] = React.useState(true)
  const [loadFailed, setLoadFailed] = React.useState(false)
  const [draft, setDraft] = React.useState<{ campaignId: string; name: string }>({ campaignId: '', name: '' })
  const [creating, setCreating] = React.useState(false)
  // Off until the list says otherwise: a control briefly offered and then withdrawn is worse than one that appears.
  const [canManage, setCanManage] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    setLoadFailed(false)
    try {
      const [hooks, campaignList] = await Promise.all([
        apiCall<{ items?: HookRow[]; canManage?: boolean }>(`${HOOKS_PATH}?pageSize=100`),
        apiCall<{ items?: Array<{ id?: unknown; name?: unknown }> }>('/api/marketing_automation/campaigns?pageSize=100'),
      ])
      /**
       * A non-ok response is not an empty list.
       *
       * `apiCall` resolves rather than throwing on 401/403/500, so only the `catch` below was ever reached
       * by a transport error — an expired session or a server fault fell through to an empty array and the
       * page rendered its "nothing here yet" state, which is the most reassuring possible lie.
       */
      if (!hooks.ok || !Array.isArray(hooks.result?.items)) {
        setRows([])
        setLoadFailed(true)
        return
      }
      setRows(hooks.result.items)
      setTruncated(hooks.result.items.length >= LIST_LIMIT)
      setCanManage(hooks.result?.canManage === true)
      setCampaigns((campaignList.ok && Array.isArray(campaignList.result?.items) ? campaignList.result.items : [])
        .flatMap((item) => (typeof item.id === 'string' && typeof item.name === 'string' ? [{ id: item.id, name: item.name }] : [])))
    } catch {
      setLoadFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { void load() }, [load, scopeVersion])

  const create = async () => {
    setCreating(true)
    try {
      await runMutation(
        () => apiCallOrThrow(HOOKS_PATH, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(draft),
        }),
      )
      setDraft({ campaignId: '', name: '' })
      await load()
    } catch {
      flash(t('marketing_automation.hooks.createFailed', 'Could not create the hook.'), 'error')
    } finally {
      setCreating(false)
    }
  }

  const setRevoked = async (row: HookRow, revoked: boolean) => {
    if (revoked) {
      const confirmed = await confirm({
        text: t('marketing_automation.hooks.confirmRevoke', 'Revoke this hook? Anything still posting to its URL will stop working immediately.'),
        variant: 'destructive',
      })
      if (!confirmed) return
    }
    try {
      await runMutation(
        () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(row.updatedAt),
          () => apiCallOrThrow(`${HOOKS_PATH}/${row.id}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ updatedAt: row.updatedAt, revoked }),
          }),
        ),
      )
      await load()
    } catch (error) {
      if (!extractOptimisticLockConflict(error)) {
        flash(t('marketing_automation.hooks.saveFailed', 'Could not update the hook.'), 'error')
      }
    }
  }

  /**
   * The exact call, with this hook's own URL already in it.
   *
   * The page described the contract in a sentence and left the reader to assemble the request — and the one
   * thing they cannot assemble is the URL, which is shown once and never recoverable. Two identifying fields
   * are offered because either works and neither is required: a `customerId` the sender already holds is
   * exact, an `email` is what a form actually collects.
   */
  const buildCurl = (url: string) => [
    `curl -X POST '${url}' \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -d '{`,
    `    "email": "customer@example.com",`,
    `    "plan": "pro",`,
    `    "source": "webinar-form"`,
    `  }'`,
  ].join('\n')

  const copyCurl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(buildCurl(url))
      flash(t('marketing_automation.hooks.curlCopied', 'Command copied.'), 'success')
    } catch {
      flash(t('marketing_automation.hooks.copyFailed', 'Could not copy — select the URL and copy it manually.'), 'error')
    }
  }

  const copyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      flash(t('marketing_automation.hooks.copied', 'URL copied.'), 'success')
    } catch {
      flash(t('marketing_automation.hooks.copyFailed', 'Could not copy — select the URL and copy it manually.'), 'error')
    }
  }

  const columns = React.useMemo<ColumnDef<HookRow>[]>(() => [
    { accessorKey: 'name', header: t('marketing_automation.hooks.columns.name', 'Name') },
    {
      accessorKey: 'campaignName',
      header: t('marketing_automation.hooks.columns.campaign', 'Campaign'),
      cell: ({ row }) => (
        <a className="underline" href={`/backend/marketing/campaigns/${row.original.campaignId}`}>
          {row.original.campaignName ?? row.original.campaignId}
        </a>
      ),
    },
    {
      id: 'state',
      header: t('marketing_automation.hooks.columns.state', 'State'),
      cell: ({ row }) => (
        <StatusBadge variant={row.original.revokedAt ? 'error' : 'success'}>
          {row.original.revokedAt
            ? t('marketing_automation.hooks.revoked', 'Revoked')
            : t('marketing_automation.hooks.live', 'Live')}
        </StatusBadge>
      ),
    },
    {
      id: 'activity',
      header: t('marketing_automation.hooks.columns.activity', 'Activity'),
      meta: { truncate: true, maxWidth: '260px' },
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {row.original.receivedCount === 0
            ? t('marketing_automation.hooks.neverUsed', 'Never used')
            : `${row.original.receivedCount} — ${row.original.lastReceivedAt ? formatDateTime(row.original.lastReceivedAt) : ''}`}
          {row.original.lastOutcome ? ` — ${row.original.lastOutcome}` : ''}
        </span>
      ),
    },
    {
      id: 'actions',
      header: '',
      /**
       * The actions go through `RowActions`; the two EXPLANATIONS stay as text.
       *
       * "URL hidden — needs campaign management rights" and "No signing secret configured" are not actions and
       * must not become menu items somebody can click: they are why there is nothing to click. Three distinct
       * states, because "you may not see it" and "it does not exist" are different facts, and hiding either
       * inside a dropdown would answer neither.
       */
      cell: ({ row }) => {
        const actions: RowActionItem[] = []
        if (row.original.url) {
          actions.push({
            id: 'copy',
            label: t('marketing_automation.hooks.copyUrl', 'Copy URL'),
            onSelect: () => { void copyUrl(row.original.url as string) },
          })
          actions.push({
            id: 'requests',
            label: t('marketing_automation.hooks.showRequests', 'Show what arrived'),
            onSelect: () => { window.location.href = `/backend/marketing/inbound-requests?hookId=${row.original.id}` },
          })
          actions.push({
            id: 'copy-curl',
            label: t('marketing_automation.hooks.copyCurl', 'Copy curl command'),
            onSelect: () => { void copyCurl(row.original.url as string) },
          })
        }
        if (canManage) {
          actions.push({
            id: 'revoked',
            label: row.original.revokedAt
              ? t('marketing_automation.hooks.restore', 'Restore')
              : t('marketing_automation.hooks.revoke', 'Revoke'),
            // Revoking stops every caller posting to that URL immediately; restoring does not.
            destructive: !row.original.revokedAt,
            onSelect: () => { void setRevoked(row.original, !row.original.revokedAt) },
          })
        }
        return (
          <div className="flex items-center justify-end gap-2">
            {!row.original.url ? (
              <span className="text-xs text-muted-foreground">
                {row.original.hasUrl
                  ? t('marketing_automation.hooks.urlHidden', 'URL hidden — needs campaign management rights')
                  : t('marketing_automation.hooks.noSecret', 'No signing secret configured')}
              </span>
            ) : null}
            {actions.length > 0 ? <RowActions items={actions} /> : null}
          </div>
        )
      },
    },
  ], [t, canManage])

  return (
    <Page>
      <PageBody>
        {ConfirmDialogElement}
        {/*
          * The retry matters here: the create form below is useless without the campaign list, which came
          * from the same failed pass.
          */}
        {loadFailed ? (
          <div className="mb-3">
            <ErrorMessage
              label={t('marketing_automation.hooks.loadFailed', 'Could not load the hooks.')}
              action={(
                <Button variant="outline" size="sm" onClick={() => { void load() }}>
                  {t('marketing_automation.hooks.retry', 'Try again')}
                </Button>
              )}
            />
          </div>
        ) : null}

        {canManage ? (
        <div className="mb-6 space-y-2">
          <SectionHeader
            title={t('marketing_automation.hooks.new', 'New hook')}
            help={{
              title: t('marketing_automation.hooks.title', 'Inbound hooks'),
              body: t('marketing_automation.help.hooks.editor'),
            }}
          />
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-64 space-y-1">
              <Label htmlFor="hook-campaign">{t('marketing_automation.hooks.columns.campaign', 'Campaign')}</Label>
              <Select
                value={draft.campaignId || undefined}
                onValueChange={(value) => setDraft({ ...draft, campaignId: value })}
              >
                <SelectTrigger id="hook-campaign" className="w-full">
                  <SelectValue placeholder={t('marketing_automation.hooks.pickCampaign', 'Pick a campaign')} />
                </SelectTrigger>
                <SelectContent>
                  {campaigns.map((campaign) => (
                    <SelectItem key={campaign.id} value={campaign.id}>{campaign.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-64 space-y-1">
              <Label htmlFor="hook-name">{t('marketing_automation.hooks.columns.name', 'Name')}</Label>
              <Input
                id="hook-name"
                value={draft.name}
                placeholder={t('marketing_automation.hooks.namePlaceholder', 'Warehouse system')}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </div>
            <Button disabled={creating || !draft.campaignId || !draft.name.trim()} onClick={() => void create()}>
              {creating ? <Spinner /> : t('marketing_automation.hooks.create', 'Create hook')}
            </Button>
          </div>
          <div className="text-xs text-muted-foreground">
            {t(
              'marketing_automation.hooks.hint',
              'POST JSON with customerId or email to the hook URL. Every other field is available to the campaign as trigger.<field>. The campaign must be triggered by "Inbound hook received".',
            )}
          </div>

          {/*
            The contract in full, next to the thing it describes.
            
            Collapsed by default: somebody who has wired one hook does not need it again, and somebody wiring
            their first one needs all of it rather than a sentence. The URL is deliberately a placeholder here —
            a real one is shown once and never recoverable, so it belongs on the row's "Copy curl command"
            action, not in a block that would print somebody's live credential onto the screen.
          */}
          <ContextHelp
            bulb={false}
            title={t('marketing_automation.hooks.reference.title', 'How another system posts to a hook')}
          >
            <div className="space-y-3">
              <pre className="overflow-x-auto rounded-md border border-border bg-muted p-3 text-xs leading-relaxed">
{`curl -X POST 'https://your-shop.example/api/marketing_automation/inbound?t=<token>' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "email": "customer@example.com",
    "plan": "pro",
    "source": "webinar-form"
  }'`}
              </pre>
              <ul className="space-y-1 text-xs text-muted-foreground">
                <li>
                  <code className="text-foreground">customerId</code>
                  {' — '}
                  {t('marketing_automation.hooks.reference.customerId', "The customer this is about. The id arrives from outside, so it is checked against this installation before it is trusted — nobody can start a campaign for somebody else's customer.")}
                </li>
                <li>
                  <code className="text-foreground">email</code>
                  {' — '}
                  {t('marketing_automation.hooks.reference.email', 'Used to find the customer when the sender has no id. One of the two is needed; both are accepted.')}
                </li>
                <li>
                  <code className="text-foreground">{'<anything else>'}</code>
                  {' — '}
                  {t('marketing_automation.hooks.reference.rest', 'Every other field reaches the campaign as trigger.<field>, so a step can interpolate it or an audience can compare it.')}
                </li>
              </ul>
              <div className="text-xs text-muted-foreground">
                {t(
                  'marketing_automation.hooks.reference.limits',
                  'The token is already in the URL, so no header authenticates the call. Bodies over 16 KB are refused rather than truncated. A verified signature always answers 202, whether or not the customer was found — otherwise the URL could be used to test who is on your list. What actually happened appears on the hook row here.',
                )}
              </div>
            </div>
          </ContextHelp>
        </div>
        ) : null}

        {/* Not under the error: an empty table there would still claim there are no hooks. */}
        {loadFailed ? null : (
          <DataTable
            title={t('marketing_automation.hooks.title', 'Inbound hooks')}
            titleHeadingLevel={1}
            titleHelp={{
              title: t('marketing_automation.hooks.title', 'Inbound hooks'),
              body: t('marketing_automation.help.page.hooks'),
            }}
            columns={columns}
            data={rows}
            isLoading={loading}
            emptyState={(
              <ListEmptyState
                title={t('marketing_automation.hooks.emptyTitle', 'No inbound hooks yet')}
                description={t('marketing_automation.hooks.emptyBody', 'A hook is a signed URL another system posts to in order to start a campaign.')}
              />
            )}
          />
        )}
        {truncated ? (
          <div className="mt-2 text-xs text-muted-foreground">
            {t('marketing_automation.list.truncated', 'This screen lists at most {count} — there are probably more. Narrow what you are looking for rather than scrolling.')
              .replace('{count}', String(LIST_LIMIT))}
          </div>
        ) : null}
      </PageBody>
    </Page>
  )
}
