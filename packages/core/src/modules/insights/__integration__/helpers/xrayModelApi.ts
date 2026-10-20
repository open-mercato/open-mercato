import { expect, type APIRequestContext } from '@playwright/test'
import { apiRequestWithSelectedOrg } from '@open-mercato/core/helpers/integration/authFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { expectId } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createQaDeal, uniqueSuffix, updateQaDeal } from './explainApi'
import { putXraySettings, runXrayBackfill } from './xrayApi'
import { xrayCall, type XrayAnalyticsFixture } from './xrayAnalyticsApi'

export const STAFF_TEAMS_PATH = '/api/staff/teams'
export const STAFF_TEAM_MEMBERS_PATH = '/api/staff/team-members'
export const WORKFLOW_DEFINITIONS_PATH = '/api/workflows/definitions'

/** Step ids of the designed deal workflow built by `buildDealConformanceWorkflowPayload`. */
export const DEAL_MODEL_STEPS = {
  start: 'start',
  open: 'deal-open',
  review: 'deal-qa-review',
  notify: 'notify-sales',
  win: 'deal-win',
  end: 'end',
} as const

/**
 * Conformance mapping of the deal process onto the designed workflow: the creation and the
 * `open` status are the open step, `qa_review` and `win` their own steps. `notify-sales` stays
 * unmapped (unobservable, passed through by the model).
 */
export const DEAL_ACTIVITY_STEP_MAP: Readonly<Record<string, string>> = {
  created: DEAL_MODEL_STEPS.open,
  'status:open': DEAL_MODEL_STEPS.open,
  'status:qa_review': DEAL_MODEL_STEPS.review,
  'status:win': DEAL_MODEL_STEPS.win,
}

/** A path of deal statuses (the first one is the status the deal is created with). */
export type DealVariant<TKey extends string = string> = {
  key: TKey
  statuses: readonly string[]
  dealsPerActor: number
}

/** Records created by these helpers, kept as soon as they exist so `finally` can remove them. */
export type XrayModelFixture = {
  staffTeams: Array<{ id: string; organizationId: string }>
  staffMembers: Array<{ id: string; organizationId: string }>
  workflowDefinitions: Array<{ id: string; organizationId: string }>
}

export function createXrayModelFixture(): XrayModelFixture {
  return { staffTeams: [], staffMembers: [], workflowDefinitions: [] }
}

/**
 * Seeds deals through the real API: every actor creates `dealsPerActor` deals of each variant
 * and walks its status path. The organization is configured for deterministic analytics first
 * (k = 5, no debounce, no per-person views) and backfilled once at the end. Returns the deal ids
 * per variant key.
 */
export async function seedDealVariants<TKey extends string>(
  request: APIRequestContext,
  fixture: XrayAnalyticsFixture,
  input: { organizationId: string; actorTokens: string[]; variants: ReadonlyArray<DealVariant<TKey>>; label: string },
): Promise<Record<TKey, string[]>> {
  const adminToken = fixture.adminToken as string
  const settings = await putXraySettings(request, adminToken, {
    kAnonymity: 5,
    debounceSeconds: 0,
    individualsEnabled: false,
  }, { selectedOrgId: input.organizationId })
  expect(settings.status, `PUT X-Ray settings of the fixture organization: ${settings.text}`).toBe(200)
  const dealIds = Object.fromEntries(input.variants.map((variant) => [variant.key, [] as string[]])) as Record<TKey, string[]>
  for (const [actorIndex, token] of input.actorTokens.entries()) {
    for (const variant of input.variants) {
      const [initialStatus, ...nextStatuses] = variant.statuses
      expect(initialStatus, `variant ${variant.key} needs at least one status`).toBeTruthy()
      for (let index = 0; index < variant.dealsPerActor; index += 1) {
        const dealId = await createQaDeal(request, token, {
          title: `QA ${input.label} ${variant.key} ${actorIndex}-${index} ${uniqueSuffix()}`,
          status: initialStatus,
        })
        fixture.deals.push({ id: dealId, organizationId: input.organizationId })
        dealIds[variant.key].push(dealId)
        for (const status of nextStatuses) await updateQaDeal(request, token, dealId, { status })
      }
    }
  }
  await runXrayBackfill(request, adminToken, { selectedOrgId: input.organizationId })
  return dealIds
}

/** A staff team of `organizationId`, created through the staff API with that organization selected. */
export async function createStaffTeamInOrganization(
  request: APIRequestContext,
  token: string,
  fixture: XrayModelFixture,
  input: { organizationId: string; name: string },
): Promise<string> {
  const created = await xrayCall<{ id?: string | null }>(request, token, 'POST', STAFF_TEAMS_PATH, {
    selectedOrgId: input.organizationId,
    data: { name: input.name },
  })
  expect(created.status, `POST ${STAFF_TEAMS_PATH}: ${created.text}`).toBe(201)
  const teamId = expectId(created.body?.id, 'staff team create response should include id')
  fixture.staffTeams.push({ id: teamId, organizationId: input.organizationId })
  return teamId
}

/** An active member of `teamId` linked to the user `userId` (the X-Ray team dimension of that actor). */
export async function createStaffTeamMemberInOrganization(
  request: APIRequestContext,
  token: string,
  fixture: XrayModelFixture,
  input: { organizationId: string; teamId: string; userId: string; displayName: string },
): Promise<string> {
  const created = await xrayCall<{ id?: string | null }>(request, token, 'POST', STAFF_TEAM_MEMBERS_PATH, {
    selectedOrgId: input.organizationId,
    data: { teamId: input.teamId, userId: input.userId, displayName: input.displayName, isActive: true },
  })
  expect(created.status, `POST ${STAFF_TEAM_MEMBERS_PATH}: ${created.text}`).toBe(201)
  const memberId = expectId(created.body?.id, 'staff team member create response should include id')
  fixture.staffMembers.push({ id: memberId, organizationId: input.organizationId })
  return memberId
}

/**
 * A disabled workflow definition modelling the deal process:
 * START → open → QA review → notify sales (automated, unmapped) → won → END, plus an error
 * route open → won that is not part of the designed flow.
 */
export function buildDealConformanceWorkflowPayload(workflowId: string) {
  const steps = DEAL_MODEL_STEPS
  return {
    workflowId,
    workflowName: `QA X-Ray deal process ${workflowId}`,
    description: 'Designed deal process for Process X-Ray conformance (integration test)',
    version: 1,
    enabled: false,
    definition: {
      steps: [
        { stepId: steps.start, stepName: 'Start', stepType: 'START' },
        { stepId: steps.open, stepName: 'Open', stepType: 'AUTOMATED' },
        { stepId: steps.review, stepName: 'QA review', stepType: 'AUTOMATED' },
        { stepId: steps.notify, stepName: 'Notify sales', stepType: 'AUTOMATED' },
        { stepId: steps.win, stepName: 'Won', stepType: 'AUTOMATED' },
        { stepId: steps.end, stepName: 'End', stepType: 'END' },
      ],
      transitions: [
        { transitionId: 'start-to-open', fromStepId: steps.start, toStepId: steps.open, trigger: 'auto' },
        { transitionId: 'open-to-review', fromStepId: steps.open, toStepId: steps.review, trigger: 'auto' },
        { transitionId: 'review-to-notify', fromStepId: steps.review, toStepId: steps.notify, trigger: 'auto' },
        { transitionId: 'notify-to-win', fromStepId: steps.notify, toStepId: steps.win, trigger: 'auto' },
        { transitionId: 'win-to-end', fromStepId: steps.win, toStepId: steps.end, trigger: 'auto' },
        { transitionId: 'open-error-to-win', fromStepId: steps.open, toStepId: steps.win, trigger: 'auto', kind: 'error' },
      ],
    },
  }
}

/** Creates a workflow definition in `organizationId` through `POST /api/workflows/definitions`. */
export async function createWorkflowDefinitionInOrganization(
  request: APIRequestContext,
  token: string,
  fixture: XrayModelFixture,
  input: { organizationId: string; payload: Record<string, unknown> },
): Promise<string> {
  const created = await xrayCall<{ data?: { id?: string | null } }>(request, token, 'POST', WORKFLOW_DEFINITIONS_PATH, {
    selectedOrgId: input.organizationId,
    data: input.payload,
  })
  expect(created.status, `POST ${WORKFLOW_DEFINITIONS_PATH}: ${created.text}`).toBe(201)
  const definitionId = expectId(created.body?.data?.id, 'workflow definition create response should include data.id')
  fixture.workflowDefinitions.push({ id: definitionId, organizationId: input.organizationId })
  return definitionId
}

async function deleteInOrganization(request: APIRequestContext, token: string, organizationId: string, path: string): Promise<void> {
  await apiRequestWithSelectedOrg(request, 'DELETE', path, { token, selectedOrgId: organizationId }).catch(() => undefined)
}

/**
 * Removes what the model helpers created: staff members before their team (a team with members
 * cannot be deleted), each through its API with the owning organization selected and, when the
 * API left a row behind, straight from the database; workflow definitions through the API and
 * then from the database (as TC-INS-X05 does).
 */
export async function cleanupXrayModelFixture(request: APIRequestContext, token: string | null, fixture: XrayModelFixture): Promise<void> {
  if (token) {
    for (const member of fixture.staffMembers) {
      await deleteInOrganization(request, token, member.organizationId, `${STAFF_TEAM_MEMBERS_PATH}?id=${encodeURIComponent(member.id)}`)
    }
    for (const team of fixture.staffTeams) {
      await deleteInOrganization(request, token, team.organizationId, `${STAFF_TEAMS_PATH}?id=${encodeURIComponent(team.id)}`)
    }
    for (const definition of fixture.workflowDefinitions) {
      await deleteInOrganization(request, token, definition.organizationId, `${WORKFLOW_DEFINITIONS_PATH}/${encodeURIComponent(definition.id)}`)
    }
  }
  const memberIds = fixture.staffMembers.map((member) => member.id)
  const teamIds = fixture.staffTeams.map((team) => team.id)
  const definitionIds = fixture.workflowDefinitions.map((definition) => definition.id)
  if (memberIds.length === 0 && teamIds.length === 0 && definitionIds.length === 0) return
  await withClient(async (client) => {
    if (memberIds.length > 0) {
      await client.query('delete from staff_team_members where id = any($1::uuid[]) and deleted_at is null', [memberIds])
    }
    if (teamIds.length > 0) {
      await client.query('delete from staff_teams where id = any($1::uuid[]) and deleted_at is null', [teamIds])
    }
    if (definitionIds.length > 0) {
      await client.query('delete from workflow_definitions where id = any($1::uuid[])', [definitionIds])
    }
  }).catch(() => undefined)
}
