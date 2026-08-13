"use client"

/**
 * "Brief chief of sales" header trigger for the Company detail page
 * (`detail:customers.company:header`).
 *
 * Starts the seeded deal-briefing workflow for this company through
 * `POST /api/workflows/instances`, then follows the run live off the
 * `workflows.instance.*` lifecycle events the DOM Event Bridge delivers.
 *
 * ## Why this one asks before it acts
 *
 * The `agent_examples` research trigger on this same spot opens its sheet and
 * runs immediately, which is right for a read-only web search. Step 2 of THIS
 * workflow dials a real telephone and speaks to a person, on the tenant's bill,
 * and nothing downstream can undo it. So the button opens a confirmation first
 * and starts nothing until it is submitted — Cmd/Ctrl+Enter or the button,
 * Escape to abandon.
 *
 * ## Why the confirmation carries a phone number field
 *
 * The number is REQUIRED and this button is the only thing that can supply it.
 * The ElevenLabs `sales_chief_call` call profile carries the ElevenLabs agent id
 * and the phone number the call is placed FROM; the destination is the
 * connector's `toNumber`, which the workflow reads from
 * `{{context.chiefOfSalesPhone}}` and which B5 declares required on the
 * definition's `contextSchema`. There is no tenant setting holding it, so
 * leaving it out would mean every press starts a run that fails at the voice
 * step. Asking for it also makes the confirmation mean something specific: the
 * operator sees exactly which number is about to ring.
 *
 * The write goes through `useGuardedMutation` per the non-`CrudForm` contract,
 * and is optimistic-lock-exempt: it starts a workflow, it does not edit the
 * company record.
 */

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { FormField } from '@open-mercato/ui/primitives/form-field'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  DEAL_BRIEFING_ENTITY_TYPE,
  DEAL_BRIEFING_WORKFLOW_ID,
  resolveBriefRunPhase,
  type BriefRunPhase,
} from '../../../lib/deal-briefing-contract'

interface CompanyOverviewLike {
  company?: { id?: string | null; displayName?: string | null } | null
}

interface HostInjectionContext {
  companyId?: string | null
  resourceId?: string | null
  data?: CompanyOverviewLike | null
}

interface DealBriefTriggerProps {
  context?: HostInjectionContext
  data?: CompanyOverviewLike | null
}

interface StartInstanceResponse {
  data?: {
    instance?: { id?: string | null } | null
  } | null
}

interface InstanceLifecyclePayload {
  id?: unknown
  stepId?: unknown
}

type BriefMutationContext = {
  entityType: string
  entityId: string
  retryLastMutation: () => Promise<boolean>
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

interface CompanyTarget {
  companyId: string
  companyName: string | null
}

/**
 * The company the run is about.
 *
 * ONE id: `companyId` is `customer_entities.id`, which is both the id in the
 * detail route and the id the workflow's `contextSchema` names — the same value
 * the ensure-task command uses as the timeline parent. There is no second
 * company id to keep straight.
 */
function readCompanyTarget(
  context: HostInjectionContext | undefined,
  data: CompanyOverviewLike | null | undefined,
): CompanyTarget | null {
  const overview = data ?? context?.data ?? null
  const companyId =
    readString(overview?.company?.id) ??
    readString(context?.companyId) ??
    readString(context?.resourceId)
  if (!companyId) return null
  return { companyId, companyName: readString(overview?.company?.displayName) }
}

/**
 * Accept a number a person typed and hand the workflow something ElevenLabs can
 * dial, or `null` when it is not dialable.
 *
 * Spaces, dashes, dots and parentheses are how humans write phone numbers and
 * are stripped rather than rejected; a leading `00` is the other way half the
 * world writes an international prefix. What is NOT accepted is a national
 * number with no country code — the call is placed from the tenant's ElevenLabs
 * number, whose country the browser cannot know, so guessing one would dial a
 * stranger.
 */
export function normalizeChiefOfSalesPhone(value: string): string | null {
  const compact = value.replace(/[\s().-]/g, '')
  const normalized = compact.startsWith('00') ? `+${compact.slice(2)}` : compact
  return /^\+[1-9]\d{6,14}$/.test(normalized) ? normalized : null
}

const phaseVariants: Record<BriefRunPhase, StatusBadgeVariant> = {
  started: 'info',
  briefing: 'info',
  calling: 'info',
  extracting: 'info',
  completed: 'success',
  failed: 'error',
}

export default function DealBriefTriggerWidget({ context, data }: DealBriefTriggerProps) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [phone, setPhone] = React.useState('')
  const [formError, setFormError] = React.useState<string | null>(null)
  const [isStarting, setIsStarting] = React.useState(false)
  const [instanceId, setInstanceId] = React.useState<string | null>(null)
  const [phase, setPhase] = React.useState<BriefRunPhase | null>(null)
  const instanceIdRef = React.useRef<string | null>(null)

  const target = React.useMemo(() => readCompanyTarget(context, data), [context, data])

  const { runMutation, retryLastMutation } = useGuardedMutation<BriefMutationContext>({
    contextId: 'sales_call_planner:deal-brief',
  })

  // Live status without polling. `workflows.instance.started` is re-emitted on
  // every step advance carrying the DESTINATION stepId, and all six lifecycle
  // events are `clientBroadcast: true`, so the run reports its own progress to
  // this page. Everything is filtered to the instance this widget started:
  // another operator's briefing on another company must not move this line.
  useAppEvent('workflows.instance.*', (event) => {
    const active = instanceIdRef.current
    if (!active) return
    const payload = event.payload as InstanceLifecyclePayload | undefined
    if (!payload || readString(payload.id) !== active) return
    const next = resolveBriefRunPhase(event.id, readString(payload.stepId))
    if (next) setPhase(next)
  })

  const messageForFailure = React.useCallback(
    (status: number): string => {
      switch (status) {
        case 400:
          return t(
            'sales_call_planner.brief.error.selectOrg',
            'Select a single organization before starting a briefing call.',
          )
        case 403:
          return t(
            'sales_call_planner.brief.error.forbidden',
            'You need permission to start workflow instances to brief the chief of sales.',
          )
        case 404:
          return t(
            'sales_call_planner.brief.error.notFound',
            'The deal briefing workflow is not available on this tenant yet.',
          )
        default:
          return t('sales_call_planner.brief.error.generic', 'Failed to start the briefing call.')
      }
    },
    [t],
  )

  const handleStart = React.useCallback(async () => {
    if (!target || isStarting) return
    const toNumber = normalizeChiefOfSalesPhone(phone)
    if (!toNumber) {
      setFormError(
        t(
          'sales_call_planner.brief.error.missingPhone',
          'No phone number is configured for the chief of sales.',
        ),
      )
      return
    }
    setFormError(null)
    setIsStarting(true)
    try {
      await runMutation({
        context: {
          entityType: DEAL_BRIEFING_ENTITY_TYPE,
          entityId: target.companyId,
          retryLastMutation,
        },
        mutationPayload: {
          workflowId: DEAL_BRIEFING_WORKFLOW_ID,
          companyId: target.companyId,
        },
        operation: async () => {
          // optimistic-lock-exempt: starts a workflow run, not a record edit
          const call = await apiCall<StartInstanceResponse>('/api/workflows/instances', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              workflowId: DEAL_BRIEFING_WORKFLOW_ID,
              initialContext: {
                companyId: target.companyId,
                chiefOfSalesPhone: toNumber,
                ...(target.companyName ? { companyName: target.companyName } : {}),
              },
              // `initiatedBy` is deliberately absent: the route overwrites it
              // from the session, which is what makes the run traceable and is
              // what the external-agent ACL check reads.
              metadata: {
                entityType: DEAL_BRIEFING_ENTITY_TYPE,
                entityId: target.companyId,
              },
            }),
          })
          if (!call.ok) {
            setFormError(messageForFailure(call.status))
            return
          }
          const startedId = readString(call.result?.data?.instance?.id)
          instanceIdRef.current = startedId
          setInstanceId(startedId)
          setPhase('started')
          setOpen(false)
        },
      })
    } catch {
      setFormError((prev) =>
        prev ?? t('sales_call_planner.brief.error.generic', 'Failed to start the briefing call.'),
      )
    } finally {
      setIsStarting(false)
    }
  }, [isStarting, messageForFailure, phone, retryLastMutation, runMutation, t, target])

  const handleDialogKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        void handleStart()
      }
    },
    [handleStart],
  )

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (!next && isStarting) return
      if (next) setFormError(null)
      setOpen(next)
    },
    [isStarting],
  )

  if (!target) return null

  const phaseLabels: Record<BriefRunPhase, string> = {
    started: t(
      'sales_call_planner.brief.started',
      'Briefing started. The chief of sales will be called shortly.',
    ),
    briefing: t('sales_call_planner.brief.status.briefing', 'Preparing the deal brief…'),
    calling: t('sales_call_planner.brief.status.calling', 'Calling the chief of sales…'),
    extracting: t('sales_call_planner.brief.status.extracting', 'Turning the call into tasks…'),
    completed: t('sales_call_planner.brief.status.completed', 'Briefing completed.'),
    failed: t('sales_call_planner.brief.status.failed', 'The briefing did not complete.'),
  }
  // Same fallback the notification subscriber uses for a company whose display
  // name is missing: the id. Ugly to read aloud, unambiguous to act on, and it
  // keeps one convention across the feature instead of two.
  const companyName = target.companyName ?? target.companyId
  const confirmDescription = t(
    'sales_call_planner.brief.confirm.description',
    'This places an outbound phone call to the chief of sales, reads them a summary of {company}’s open deals, and turns their reply into tasks.',
  ).replace('{company}', companyName)

  return (
    <div className="flex flex-wrap items-center gap-2" data-deal-brief-trigger="">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => handleOpenChange(true)}
        aria-label={t(
          'sales_call_planner.brief.trigger.ariaLabel',
          'Brief the chief of sales about this company by phone',
        )}
      >
        {t('sales_call_planner.brief.trigger.label', 'Brief chief of sales')}
      </Button>

      {phase ? (
        <span className="flex items-center gap-2 text-sm" data-deal-brief-status="">
          <StatusBadge variant={phaseVariants[phase]} dot>
            {phaseLabels[phase]}
          </StatusBadge>
          {instanceId ? (
            <a
              href={`/backend/instances/${encodeURIComponent(instanceId)}`}
              className="text-xs text-primary hover:underline"
            >
              {t('sales_call_planner.brief.startedLink', 'View the run →')}
            </a>
          ) : null}
        </span>
      ) : null}

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md" onKeyDown={handleDialogKeyDown}>
          <DialogHeader>
            <DialogTitle>
              {t('sales_call_planner.brief.confirm.title', 'Start a briefing call?')}
            </DialogTitle>
            <DialogDescription>{confirmDescription}</DialogDescription>
          </DialogHeader>

          <FormField
            label={t('sales_call_planner.brief.confirm.phoneLabel', 'Chief of sales phone number')}
            required
            description={t(
              'sales_call_planner.brief.confirm.phoneHint',
              'Use the international format, for example +48123456789.',
            )}
            error={formError ?? undefined}
          >
            <Input
              type="tel"
              autoComplete="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              disabled={isStarting}
              data-deal-brief-phone=""
            />
          </FormField>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleOpenChange(false)}
              disabled={isStarting}
            >
              {t('sales_call_planner.brief.confirm.cancel', 'Cancel')}
            </Button>
            <Button type="button" size="sm" onClick={() => void handleStart()} disabled={isStarting}>
              {isStarting ? <Spinner className="size-4" /> : null}
              <span>
                {isStarting
                  ? t('sales_call_planner.brief.starting', 'Starting the briefing…')
                  : t('sales_call_planner.brief.confirm.submit', 'Start the call')}
              </span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
