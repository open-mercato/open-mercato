import path from 'node:path'
import { config as loadEnv } from 'dotenv'
import { Client } from 'pg'
import { expect, test } from '@playwright/test'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/modules/core/__integration__/helpers/authFixtures'
import { getTokenContext } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import { deleteInboxEmail, submitTextExtraction } from '@open-mercato/core/modules/core/__integration__/helpers/inboxFixtures'
import {
  cancelThenDeleteClaimIfPossible,
  listClaims,
  uniqueLabel,
  type ClaimItem,
} from './helpers'

const APP_ROOT = process.env.OM_TEST_APP_ROOT?.trim()
  ? path.resolve(process.env.OM_TEST_APP_ROOT)
  : path.resolve(process.cwd(), 'apps/mercato')
const EVENTS_QUEUE = 'events'

if (!process.env.DATABASE_URL) {
  loadEnv({ path: path.resolve(APP_ROOT, '.env') })
}

type EmailClaimItem = ClaimItem & {
  contactEmail?: string | null
  intakeMessageRef?: string | null
}

type ModuleConfigSnapshot = {
  valueJson: unknown
  organizationId: string | null
}

let dbClient: Client | null = null

async function getDbClient(): Promise<Client> {
  if (dbClient) return dbClient
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL is required for TC-WC-022 to redeliver an inbox email fixture')
  }
  const client = new Client({ connectionString })
  await client.connect()
  dbClient = client
  return client
}

async function closeDbClient(): Promise<void> {
  const client = dbClient
  dbClient = null
  if (client) await client.end()
}

async function drainEventsQueue(): Promise<void> {
  await drainIntegrationQueue(EVENTS_QUEUE, { appRoot: APP_ROOT })
}

async function markInboxEmailRedeliverable(emailId: string): Promise<void> {
  const client = await getDbClient()
  await client.query(
    `
      update inbox_emails
      set status = 'failed',
          processing_error = 'TC-WC-022 redelivery fixture',
          updated_at = now()
      where id = $1
    `,
    [emailId],
  )
}

async function enableWarrantyEmailIntake(
  tenantId: string,
  organizationId: string,
): Promise<ModuleConfigSnapshot | null> {
  const client = await getDbClient()
  const existing = await client.query<ModuleConfigSnapshot>(
    `
      select value_json as "valueJson",
             organization_id as "organizationId"
      from module_configs
      where module_id = 'warranty_claims'
        and name = 'emailIntakeEnabled'
        and tenant_id = $1
      limit 1
    `,
    [tenantId],
  )
  await client.query(
    `
      insert into module_configs (module_id, name, value_json, organization_id, tenant_id, created_at, updated_at)
      values ('warranty_claims', 'emailIntakeEnabled', 'true'::jsonb, $2, $1, now(), now())
      on conflict (module_id, name, tenant_id) where tenant_id is not null
      do update set value_json = excluded.value_json,
                    organization_id = excluded.organization_id,
                    updated_at = now()
    `,
    [tenantId, organizationId],
  )
  return existing.rows[0] ?? null
}

async function restoreWarrantyEmailIntake(
  tenantId: string,
  previous: ModuleConfigSnapshot | null | undefined,
): Promise<void> {
  const client = await getDbClient()
  if (!previous) {
    await client.query(
      `
        delete from module_configs
        where module_id = 'warranty_claims'
          and name = 'emailIntakeEnabled'
          and tenant_id = $1
      `,
      [tenantId],
    )
    return
  }
  await client.query(
    `
      update module_configs
      set value_json = $2::jsonb,
          organization_id = $3,
          updated_at = now()
      where module_id = 'warranty_claims'
        and name = 'emailIntakeEnabled'
        and tenant_id = $1
    `,
    [tenantId, JSON.stringify(previous.valueJson), previous.organizationId],
  )
}

function toEmailClaim(item: ClaimItem): EmailClaimItem {
  return item as EmailClaimItem
}

async function findEmailClaims(
  request: Parameters<typeof listClaims>[0],
  token: string,
  senderEmail: string,
): Promise<EmailClaimItem[]> {
  const query = new URLSearchParams({
    channel: 'api',
    search: senderEmail,
    pageSize: '100',
  })
  const claims = await listClaims(request, token, query.toString())
  return claims
    .filter((claim) => claim.customerName === senderEmail)
    .map(toEmailClaim)
}

async function waitForEmailClaims(
  request: Parameters<typeof listClaims>[0],
  token: string,
  senderEmail: string,
  expectedCount: number,
): Promise<EmailClaimItem[]> {
  const deadline = Date.now() + 5_000
  let latest: EmailClaimItem[] = []
  while (Date.now() < deadline) {
    await drainEventsQueue()
    latest = await findEmailClaims(request, token, senderEmail)
    if (latest.length === expectedCount) return latest
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return latest
}

test.afterAll(async () => {
  await closeDbClient()
})

test.describe('TC-WC-022: warranty claim email-to-claim subscriber', () => {
  test('creates one unlinked API claim from inbound email and ignores redelivery of the same message id', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId, tenantId } = getTokenContext(adminToken)
    const stamp = uniqueLabel('tc-wc-022')
    const senderEmail = `${stamp}@test.invalid`
    const password = 'Valid1!Pass'

    let roleId: string | null = null
    let userId: string | null = null
    let inboxEmailId: string | null = null
    let claimId: string | null = null
    let previousEmailIntakeConfig: ModuleConfigSnapshot | null | undefined

    try {
      previousEmailIntakeConfig = await enableWarrantyEmailIntake(tenantId, organizationId)
      roleId = await createRoleFixture(request, adminToken, { name: `QA WC Email Intake ${stamp}` })
      await setRoleAclFeatures(request, adminToken, {
        roleId,
        features: [
          'inbox_ops.proposals.manage',
          'inbox_ops.log.view',
          'warranty_claims.claim.view',
        ],
        organizations: [organizationId],
      })
      userId = await createUserFixture(request, adminToken, {
        email: senderEmail,
        password,
        organizationId,
        roles: [roleId],
        name: `QA WC Email Intake ${stamp}`,
      })
      const senderToken = await getAuthToken(request, senderEmail, password)

      const submitResult = await submitTextExtraction(request, senderToken, {
        title: `Warranty request ${stamp}`,
        text: `Hello, please open a warranty claim for serial ${stamp}.`,
        metadata: { testCase: 'TC-WC-022' },
      })

      if (submitResult.status === 404) {
        const absentClaims = await findEmailClaims(request, senderToken, senderEmail)
        expect(absentClaims, 'inbox_ops absent path should not create warranty claims').toHaveLength(0)
        return
      }

      expect(submitResult.status, `POST /api/inbox_ops/extract should queue email: ${submitResult.error ?? ''}`).toBe(200)
      expect(submitResult.emailId, 'text extraction response should include emailId').toBeTruthy()
      inboxEmailId = submitResult.emailId ?? null

      let emailClaims = await waitForEmailClaims(request, senderToken, senderEmail, 1)
      expect(emailClaims, 'first inbound email delivery should create exactly one warranty claim').toHaveLength(1)
      const firstClaim = emailClaims[0]
      claimId = firstClaim.id
      expect(firstClaim.channel).toBe('api')
      expect(firstClaim.customerId).toBeNull()
      expect(firstClaim.customerName).toBe(senderEmail)
      expect(firstClaim.contactEmail).toBe(senderEmail)
      expect(firstClaim.intakeMessageRef).toBe(inboxEmailId)

      await markInboxEmailRedeliverable(inboxEmailId!)
      const redeliveryResponse = await apiRequest(
        request,
        'POST',
        `/api/inbox_ops/emails/${encodeURIComponent(inboxEmailId!)}/reprocess`,
        { token: senderToken },
      )
      expect(redeliveryResponse.status(), 'reprocessing the same inbox email should redeliver the same message id').toBe(200)

      emailClaims = await waitForEmailClaims(request, senderToken, senderEmail, 1)
      expect(emailClaims, 'redelivery should not create a duplicate warranty claim').toHaveLength(1)
      expect(emailClaims[0].id).toBe(claimId)
      expect(emailClaims[0].intakeMessageRef).toBe(inboxEmailId)
    } finally {
      await deleteInboxEmail(request, userId ? await getAuthToken(request, senderEmail, password).catch(() => adminToken) : adminToken, inboxEmailId ?? '')
        .catch(() => undefined)
      await cancelThenDeleteClaimIfPossible(request, adminToken, claimId)
      if (previousEmailIntakeConfig !== undefined) {
        await restoreWarrantyEmailIntake(tenantId, previousEmailIntakeConfig).catch(() => undefined)
      }
      await deleteUserIfExists(request, adminToken, userId)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })
})
