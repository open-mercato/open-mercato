import path from 'node:path'
import { config as loadEnv } from 'dotenv'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createRoleFixture, deleteRoleIfExists, setRoleAclFeatures } from '@open-mercato/core/helpers/integration/authFixtures'
import {
  createBusinessRuleFixture,
  deleteBusinessRuleIfExists,
} from '@open-mercato/core/helpers/integration/businessRulesFixtures'
import {
  createCompanyFixture,
  createPersonFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'
import {
  deleteGeneralEntityIfExists,
  expectId,
  getTokenContext,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'
import { buildBusinessRulePayload, listRuleLogs, type LogListItem } from './helpers/businessRulesApi'

export const integrationMeta = {
  dependsOnModules: ['business_rules', 'customers', 'api_keys', 'audit_logs'],
}

/**
 * TC-BR-013: business-rule HTTP loopback causation and CRUD-trigger entity id.
 * Spec: .ai/specs/2026-10-08-insights-causation-and-explain.md (D5, D7)
 *
 * A CRUD-triggered ACTION rule on `customers.person` / `updated` runs a
 * CALL_OPEN_MERCATO action that updates a company through the one-time API key
 * loopback. The loopback write must be attributed to the rule
 * (`causeKind: 'business_rule'`, `causeId` = the rule UUID, never the business
 * key), share the correlation id of the person update that triggered the rule,
 * and name the rule run as its innermost frame reference. The rule execution
 * log must carry the person id as `entityId` instead of `'unknown'` and expose
 * the run id.
 *
 * The rule fires on `updated` for one specific person id and writes a
 * different record, so neither other specs' records nor the loopback write can
 * re-trigger it.
 */

const APP_ROOT = process.env.OM_TEST_APP_ROOT?.trim()
  ? path.resolve(process.env.OM_TEST_APP_ROOT as string)
  : path.resolve(process.cwd(), 'apps/mercato')

if (!process.env.OM_TEST_APP_ROOT?.trim()) {
  loadEnv({ path: path.resolve(APP_ROOT, '.env') })
  process.env.QUEUE_BASE_DIR = path.resolve(APP_ROOT, '.mercato/queue')
}

const API_KEYS_PATH = '/api/api_keys/keys'
const COMPANIES_PATH = '/api/customers/companies'
const PEOPLE_PATH = '/api/customers/people'
const AUDIT_ACTIONS_PATH = '/api/audit_logs/audit-logs/actions'
const RULE_LOG_POLL_TIMEOUT_MS = 12_000
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type AuditCausationFrame = {
  kind?: string
  id?: string | null
  ref?: string | null
}

type AuditActionItem = {
  id: string
  commandId: string
  resourceKind: string | null
  resourceId: string | null
  causeKind?: string | null
  causeId?: string | null
  correlationId?: string | null
  context?: { causation?: { frames?: AuditCausationFrame[] } | null } | null
}

async function drainEventsThen<T>(probe: () => Promise<T>): Promise<T> {
  await drainIntegrationQueue('events', { appRoot: APP_ROOT })
  return probe()
}

function innermostCausationFrame(item: AuditActionItem | null): AuditCausationFrame | null {
  const frames = item?.context?.causation?.frames ?? []
  return frames.length > 0 ? frames[frames.length - 1] : null
}

async function findRuleLogForEntity(
  request: APIRequestContext,
  token: string,
  ruleUuid: string,
  entityId: string,
): Promise<LogListItem | null> {
  const query = `?ruleId=${encodeURIComponent(ruleUuid)}&entityId=${encodeURIComponent(entityId)}&pageSize=20`
  const { status, items } = await listRuleLogs(request, token, query)
  if (status !== 200) return null
  return items.find((item) => item.entityId === entityId) ?? null
}

async function listResourceAuditEntries(
  request: APIRequestContext,
  token: string,
  resourceKind: string,
  resourceId: string,
): Promise<AuditActionItem[]> {
  const query = `?resourceKind=${encodeURIComponent(resourceKind)}&resourceId=${encodeURIComponent(resourceId)}&pageSize=50`
  const response = await apiRequest(request, 'GET', `${AUDIT_ACTIONS_PATH}${query}`, { token })
  if (response.status() !== 200) return []
  const body = await readJsonSafe<{ items?: AuditActionItem[] }>(response)
  return body?.items ?? []
}

async function findRuleCausedAuditEntry(
  request: APIRequestContext,
  token: string,
  companyId: string,
): Promise<AuditActionItem | null> {
  const items = await listResourceAuditEntries(request, token, 'customers.company', companyId)
  return items.find((item) => item.causeKind === 'business_rule') ?? null
}

async function findPersonUpdateAuditEntry(
  request: APIRequestContext,
  token: string,
  personId: string,
): Promise<AuditActionItem | null> {
  const items = await listResourceAuditEntries(request, token, 'customers.person', personId)
  return items.find((item) => item.commandId === 'customers.people.update') ?? null
}

test.describe('TC-BR-013: business rule loopback causation', () => {
  test('attributes the CALL_OPEN_MERCATO loopback write to the rule and logs the triggering record id', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { organizationId, tenantId } = getTokenContext(token)
    const stamp = Date.now()
    const ruleKey = `TC_BR_013_${stamp}`
    const marker = `QA BR013 Legal ${stamp}`

    let roleId: string | null = null
    let apiKeyId: string | null = null
    let companyId: string | null = null
    let personId: string | null = null
    let ruleUuid: string | null = null

    try {
      roleId = await createRoleFixture(request, token, {
        name: `QA BR013 Loopback Caller ${stamp}`,
        tenantId: tenantId || undefined,
      })
      await setRoleAclFeatures(request, token, {
        roleId,
        features: ['customers.companies.view', 'customers.companies.manage'],
        organizations: organizationId ? [organizationId] : null,
      })

      const apiKeyResponse = await apiRequest(request, 'POST', API_KEYS_PATH, {
        token,
        data: {
          name: `QA BR013 Loopback Profile ${stamp}`,
          description: 'Temporary profile for business-rule causation coverage',
          roles: [roleId],
          organizationId,
        },
      })
      expect(apiKeyResponse.status(), `create api key failed: ${apiKeyResponse.status()}`).toBe(201)
      const apiKeyBody = await readJsonSafe<{ id?: string }>(apiKeyResponse)
      apiKeyId = expectId(apiKeyBody?.id, 'api key profile creation should return id')

      companyId = await createCompanyFixture(request, token, `QA BR013 Company ${stamp}`)
      personId = await createPersonFixture(request, token, {
        firstName: 'Causation',
        lastName: `Rule${stamp}`,
        displayName: `QA BR013 Person ${stamp}`,
      })

      const optionsResponse = await apiRequest(request, 'GET', '/api/business_rules/openmercato-call-options', { token })
      expect(optionsResponse.status(), 'OpenMercato options should load').toBe(200)
      const optionsBody = await readJsonSafe<{ endpoints?: Array<{ id?: string }>; apiKeys?: Array<{ id?: string }> }>(optionsResponse)
      expect(optionsBody?.endpoints?.map((endpoint) => endpoint.id)).toContain(`PUT ${COMPANIES_PATH}`)
      expect(optionsBody?.apiKeys?.map((apiKey) => apiKey.id)).toContain(apiKeyId)

      ruleUuid = await createBusinessRuleFixture(
        request,
        token,
        buildBusinessRulePayload(stamp, {
          ruleId: ruleKey,
          ruleType: 'ACTION',
          entityType: 'customers.person',
          eventType: 'updated',
          conditionExpression: { field: 'id', operator: '=', value: personId },
          successActions: [
            {
              type: 'CALL_OPEN_MERCATO',
              config: {
                endpoint: COMPANIES_PATH,
                method: 'PUT',
                apiKeyId,
                body: JSON.stringify({ id: companyId, legalName: marker }),
              },
            },
          ],
        }),
      )

      const updateResponse = await apiRequest(request, 'PUT', PEOPLE_PATH, {
        token,
        data: { id: personId, jobTitle: `QA BR013 Trigger ${stamp}` },
      })
      expect(updateResponse.status(), `person update failed: ${updateResponse.status()}`).toBe(200)

      const triggeredPersonId = personId
      const triggeredRuleUuid = ruleUuid
      const updatedCompanyId = companyId

      await expect
        .poll(
          () => drainEventsThen(() => findRuleLogForEntity(request, token, triggeredRuleUuid, triggeredPersonId)),
          { timeout: RULE_LOG_POLL_TIMEOUT_MS, message: 'CRUD-triggered rule should log an execution for the person id' },
        )
        .not.toBeNull()
      const ruleLog = await findRuleLogForEntity(request, token, triggeredRuleUuid, triggeredPersonId)
      expect(ruleLog?.entityId).toBe(personId)
      expect(ruleLog?.entityId).not.toBe('unknown')
      expect(ruleLog?.entityType).toBe('customers.person')
      expect(
        ruleLog?.executionResult,
        `rule execution should succeed: ${JSON.stringify(ruleLog?.outputContext ?? null)}`,
      ).toBe('SUCCESS')
      expect(ruleLog?.outputContext?.actionsExecuted).toEqual([
        expect.objectContaining({ type: 'CALL_OPEN_MERCATO', success: true }),
      ])
      const runId = ruleLog?.runId ?? null
      expect(runId, 'the rule log exposes the run id of the execution').toMatch(UUID_PATTERN)

      const auditEntry = await findRuleCausedAuditEntry(request, token, updatedCompanyId)
      expect(
        auditEntry,
        'the loopback company update is audited with a business_rule cause before the rule run is logged',
      ).not.toBeNull()
      expect(auditEntry?.resourceId).toBe(companyId)
      expect(auditEntry?.causeKind).toBe('business_rule')
      expect(auditEntry?.causeId).toBe(ruleUuid)
      expect(auditEntry?.causeId).not.toBe(ruleKey)
      expect(innermostCausationFrame(auditEntry), 'the loopback write names the rule run').toEqual(
        expect.objectContaining({ kind: 'business_rule', id: ruleUuid, ref: runId }),
      )

      const personUpdateEntry = await findPersonUpdateAuditEntry(request, token, triggeredPersonId)
      expect(personUpdateEntry?.causeKind, 'the triggering person update is a user write').toBe('user')
      expect(personUpdateEntry?.correlationId, 'the person update carries a correlation id').toMatch(UUID_PATTERN)
      expect(
        auditEntry?.correlationId,
        'the loopback write shares the correlation id of the person update that triggered the rule',
      ).toBe(personUpdateEntry?.correlationId)
    } finally {
      await deleteBusinessRuleIfExists(request, token, ruleUuid)
      await deleteEntityIfExists(request, token, PEOPLE_PATH, personId)
      await deleteEntityIfExists(request, token, COMPANIES_PATH, companyId)
      await deleteGeneralEntityIfExists(request, token, API_KEYS_PATH, apiKeyId)
      await deleteRoleIfExists(request, token, roleId)
    }
  })
})
