"use client"

/**
 * The tenant's standing decision about unattended action.
 *
 * `resolveTenantAutoApprovalPolicy` has always read this record, and until now
 * nothing wrote it: every tenant ran the conservative default (`enabled`,
 * ceiling `medium`) with no way to see that, let alone change it. An operator
 * whose high-risk proposal was held had a queue that had simply stopped.
 *
 * The screen deliberately shows the OTHER gates too. Auto-approval is a policy,
 * not a threshold — a proposal also needs its guardrails passed, a readable
 * trace and a risk within the ceiling — and an admin who reads this page as
 * "confidence is the rule" is the person who later files the bug that it did not
 * fire.
 *
 * optimistic-lock-exempt — the target is a single ModuleConfigService value, not
 * a versioned entity: there is no `updatedAt` to send, and the surface is a
 * single-admin settings screen rather than a collaborative-edit record.
 */

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { Label } from '@open-mercato/ui/primitives/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { hasFeature } from '@open-mercato/shared/security/features'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const SETTINGS_URL = '/api/agent_orchestrator/auto-approval/settings'

type ActionRisk = 'low' | 'medium' | 'high'

type Policy = {
  enabled: boolean
  maxAutoApproveRisk: ActionRisk
}

type PolicyResponse = {
  policy: Policy
  source: 'tenant' | 'default'
}

const RISK_TIERS: readonly ActionRisk[] = ['low', 'medium', 'high']

function isPolicyResponse(value: unknown): value is PolicyResponse {
  if (typeof value !== 'object' || value === null || !('policy' in value)) return false
  const policy = (value as { policy: unknown }).policy
  return typeof policy === 'object' && policy !== null && 'enabled' in policy
}

function samePolicy(left: Policy, right: Policy): boolean {
  return left.enabled === right.enabled && left.maxAutoApproveRisk === right.maxAutoApproveRisk
}

/**
 * The gates a proposal clears BEFORE its confidence is ever compared, in the
 * order `evaluateAutoApproval` answers them.
 *
 * Rendered as plain copy rather than controls: none of them is tunable here, and
 * the reason an admin lands on this page is usually a proposal that was held by
 * one of them.
 */
function GateList() {
  const t = useT()
  const gates = [
    t(
      'agent_orchestrator.settings.autoApproval.gate.node',
      'The workflow step does not say "always ask".',
    ),
    t(
      'agent_orchestrator.settings.autoApproval.gate.guardrail',
      'Every guardrail check on the run passed.',
    ),
    t(
      'agent_orchestrator.settings.autoApproval.gate.trace',
      'The run left a trace an auditor can read.',
    ),
    t(
      'agent_orchestrator.settings.autoApproval.gate.risk',
      'The proposed action is within the risk ceiling set above.',
    ),
    t(
      'agent_orchestrator.settings.autoApproval.gate.confidence',
      'Only then: the confidence clears the step’s threshold and its margin over the runner-up.',
    ),
  ]
  return (
    <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
      {gates.map((gate) => (
        <li key={gate}>{gate}</li>
      ))}
    </ul>
  )
}

export default function AutoApprovalSettingsPage() {
  const t = useT()
  const [policy, setPolicy] = React.useState<Policy | null>(null)
  const [baseline, setBaseline] = React.useState<Policy | null>(null)
  const [source, setSource] = React.useState<'tenant' | 'default'>('default')
  const [isLoading, setIsLoading] = React.useState(true)
  const [isSaving, setIsSaving] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const { runMutation } = useGuardedMutation({ contextId: 'agent_orchestrator.auto_approval.settings' })

  const { payload: chromePayload } = useBackendChrome()
  const canManage = hasFeature(chromePayload?.grantedFeatures, 'agent_orchestrator.agents.manage')

  const load = React.useCallback(async () => {
    setIsLoading(true)
    try {
      const call = await apiCall<unknown>(SETTINGS_URL)
      if (!call.ok || !isPolicyResponse(call.result)) {
        setLoadError(
          t('agent_orchestrator.settings.autoApproval.loadError', 'Could not load the auto-approval policy.'),
        )
        return
      }
      setPolicy(call.result.policy)
      setBaseline(call.result.policy)
      setSource(call.result.source)
      setLoadError(null)
    } catch {
      setLoadError(
        t('agent_orchestrator.settings.autoApproval.loadError', 'Could not load the auto-approval policy.'),
      )
    } finally {
      setIsLoading(false)
    }
  }, [t])

  React.useEffect(() => {
    void load()
  }, [load])

  const save = React.useCallback(async () => {
    if (!policy) return
    setIsSaving(true)
    await runMutation({
      context: { contextId: 'agent_orchestrator.auto_approval.settings' },
      operation: async () => {
        const call = await apiCall(SETTINGS_URL, { method: 'PUT', body: JSON.stringify(policy) })
        if (!call.ok) {
          flash(
            t('agent_orchestrator.settings.autoApproval.saveError', 'Could not save the auto-approval policy.'),
            'error',
          )
          return
        }
        setBaseline(policy)
        setSource('tenant')
        flash(t('agent_orchestrator.settings.autoApproval.saved', 'Saved.'), 'success')
      },
    })
    setIsSaving(false)
  }, [policy, runMutation, t])

  if (isLoading) {
    return (
      <Page>
        <PageBody>
          <div className="flex justify-center py-16">
            <Spinner className="size-5" />
          </div>
        </PageBody>
      </Page>
    )
  }
  if (loadError) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={loadError} />
        </PageBody>
      </Page>
    )
  }
  if (!policy || !baseline) return null

  const isDirty = !samePolicy(policy, baseline)
  const riskLabel = (tier: ActionRisk): string =>
    t(`agent_orchestrator.settings.autoApproval.risk.${tier}`, tier)

  return (
    <Page>
      <PageHeader
        title={t('agent_orchestrator.settings.autoApproval.title', 'Auto-approval')}
        description={t(
          'agent_orchestrator.settings.autoApproval.description',
          'What an agent may do to this tenant without a person approving it first.',
        )}
        actions={
          isDirty ? (
            <StatusBadge variant="warning" dot>
              {t('agent_orchestrator.settings.autoApproval.unsaved', 'Unsaved changes')}
            </StatusBadge>
          ) : source === 'tenant' ? (
            <StatusBadge variant="info" dot>
              {t('agent_orchestrator.settings.autoApproval.sourceTenant', 'Saved for this tenant')}
            </StatusBadge>
          ) : (
            <StatusBadge variant="neutral" dot>
              {t('agent_orchestrator.settings.autoApproval.sourceDefault', 'Inherited default')}
            </StatusBadge>
          )
        }
      />

      <PageBody>
        <Card>
          <CardHeader>
            <CardTitle>{t('agent_orchestrator.settings.autoApproval.policy', 'Policy')}</CardTitle>
            <CardDescription>
              {t(
                'agent_orchestrator.settings.autoApproval.policyHint',
                'Applies to every workflow step that invokes an agent. A step can still be stricter by asking for a human every time.',
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-start gap-3">
              <Switch
                checked={policy.enabled}
                disabled={!canManage}
                onCheckedChange={(next) => setPolicy({ ...policy, enabled: next })}
              />
              <div className="min-w-0">
                <Label>
                  {t('agent_orchestrator.settings.autoApproval.enabled', 'Allow unattended approval')}
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t(
                    'agent_orchestrator.settings.autoApproval.enabledHint',
                    'Off sends every proposal to the caseload, however confident the agent is.',
                  )}
                </p>
              </div>
            </div>

            <div className="max-w-xs space-y-1.5">
              <Label>
                {t('agent_orchestrator.settings.autoApproval.maxRisk', 'Highest risk that may run unattended')}
              </Label>
              <Select
                value={policy.maxAutoApproveRisk}
                disabled={!canManage || !policy.enabled}
                onValueChange={(next) => setPolicy({ ...policy, maxAutoApproveRisk: next as ActionRisk })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RISK_TIERS.map((tier) => (
                    <SelectItem key={tier} value={tier}>
                      {riskLabel(tier)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t(
                  'agent_orchestrator.settings.autoApproval.maxRiskHint',
                  'An action whose risk is not declared counts as medium. Anything above this goes to a person.',
                )}
              </p>
            </div>

            {canManage ? (
              <div className="flex justify-end">
                <Button onClick={() => void save()} disabled={!isDirty || isSaving}>
                  {isSaving ? <Spinner className="mr-2 size-4" /> : null}
                  {t('agent_orchestrator.settings.autoApproval.save', 'Save')}
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                {t(
                  'agent_orchestrator.settings.autoApproval.readOnly',
                  'You can see this policy but not change it.',
                )}
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle>
              {t('agent_orchestrator.settings.autoApproval.gates', 'What else a proposal must clear')}
            </CardTitle>
            <CardDescription>
              {t(
                'agent_orchestrator.settings.autoApproval.gatesHint',
                'Confidence is evidence, not authorization. A proposal is approved unattended only when all of this holds.',
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <GateList />
          </CardContent>
        </Card>
      </PageBody>
    </Page>
  )
}
