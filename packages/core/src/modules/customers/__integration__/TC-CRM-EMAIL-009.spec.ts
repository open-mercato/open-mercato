import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  deleteChannelIfExists,
  isChannelSeedingAvailable,
  purgeSeededInboundMessage,
  seedConnectedChannel,
  seedInboundMessage,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'
import { deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import { hashForLookup, looksLikeEncryptedPayload } from '@open-mercato/shared/lib/encryption/aes'
import { isTenantDataEncryptionEnabled } from '@open-mercato/shared/lib/encryption/toggles'
import { createPersonWithEmail, drainAndListEmailInteractions } from './helpers/inboundEmail'

export const integrationMeta = {
  dependsOnModules: ['communication_channels'],
}

test('TC-CRM-EMAIL-009: links inbound email to an encrypted person outside the recent-row scan', async ({ request }) => {
  test.skip(!isTenantDataEncryptionEnabled(), 'The app must run with tenant data encryption enabled.')
  const adminToken = await getAuthToken(request, 'admin')
  const { tenantId } = getTokenScope(adminToken)
  test.skip(
    !(await isChannelSeedingAvailable(request, adminToken)),
    'The channel test-seeding route must be enabled to emit inbound email.',
  )

  const runId = randomUUID()
  const roleName = `qa_crm_email_009_${runId}`
  const fixtureName = `TC-CRM-EMAIL-009 ${runId}`
  let organizationId: string | null = null
  let roleId: string | null = null
  let userId: string | null = null
  let userToken: string | null = null
  let personId: string | null = null
  let channelId: string | null = null
  let interactionId: string | null = null
  let seeded: Awaited<ReturnType<typeof seedInboundMessage>> | null = null

  try {
    organizationId = await createOrganizationFixture(request, adminToken, { name: fixtureName, tenantId })
    roleId = await createRoleFixture(request, adminToken, { name: roleName, tenantId })
    await setRoleAclFeatures(request, adminToken, {
      roleId,
      features: [
        'customers.people.view',
        'customers.people.manage',
        'customers.interactions.view',
        'customers.interactions.manage',
        'communication_channels.connect_user_channel',
      ],
      organizations: [organizationId],
    })
    const userEmail = `crm-009-${runId}@example.com`
    const password = `Fixture-${runId}-A1!`
    userId = await createUserFixture(request, adminToken, {
      email: userEmail,
      password,
      organizationId,
      roles: [roleName],
    })
    userToken = await getAuthToken(request, userEmail, password)
    expect(getTokenScope(userToken)).toEqual({ tenantId, organizationId, userId })

    const personEmail = `crm-009-person-${runId}@example.com`
    personId = await createPersonWithEmail(request, userToken, {
      firstName: 'Blind index',
      lastName: 'Contact',
      displayName: `${fixtureName} contact`,
      primaryEmail: personEmail,
    })
    await withClient(async (client) => {
      const map = await client.query(
        `select id from encryption_maps
         where tenant_id = $1 and organization_id = $2 and entity_id = 'customers:customer_entity'
           and is_active and deleted_at is null and fields_json @> $3::jsonb`,
        [tenantId, organizationId, JSON.stringify([{ field: 'primary_email', hashField: 'primary_email_hash' }])],
      )
      expect(map.rowCount, 'The organization must have the persisted lookup rule').toBe(1)

      const stored = await client.query<{ primary_email: string; primary_email_hash: string }>(
        `update customer_entities set created_at = now() - interval '1 day'
         where id = $1 and tenant_id = $2 and organization_id = $3
         returning primary_email, primary_email_hash`,
        [personId, tenantId, organizationId],
      )
      expect(looksLikeEncryptedPayload(stored.rows[0]?.primary_email), 'The API-created email must be encrypted').toBe(true)
      expect(stored.rows[0]?.primary_email_hash, 'The normal ORM write must store a context-free digest').toBe(hashForLookup(personEmail))
      const newer = await client.query(
        `insert into customer_entities (id, tenant_id, organization_id, kind, display_name, created_at, updated_at)
         select gen_random_uuid(), $1, $2, 'person', $3, now(), now() from generate_series(1, 500)`,
        [tenantId, organizationId, fixtureName],
      )
      expect(newer.rowCount, 'The fixture must fill the entire legacy fallback window').toBe(500)
    })

    const address = `tc-crm-email-009-${runId}@test-seed.local`
    channelId = await seedConnectedChannel(request, userToken, { displayName: fixtureName, externalIdentifier: address })
    seeded = await seedInboundMessage(request, userToken, {
      channelId,
      from: personEmail.toUpperCase(),
      to: [address],
      subject: fixtureName,
      bodyText: 'Fixture for encrypted contact matching.',
      messageId: `<inbound-009-${runId}@example.com>`,
    })
    const { channelLinkId } = seeded
    const interactions = await drainAndListEmailInteractions(request, userToken, personId)
    interactionId = interactions.find((interaction) => interaction.externalMessageId === channelLinkId)?.id ?? null
    expect(interactions).toEqual([expect.objectContaining({
      externalMessageId: channelLinkId,
      authorUserId: userId,
      interactionType: 'email',
    })])
  } finally {
    if (userToken) {
      await deleteEntityIfExists(request, userToken, '/api/customers/interactions', interactionId)
      await purgeSeededInboundMessage(request, userToken, channelId, seeded)
      await deleteChannelIfExists(request, userToken, channelId)
      await deleteEntityIfExists(request, userToken, '/api/customers/people', personId)
    }
    await deleteUserIfExists(request, adminToken, userId)
    await deleteRoleIfExists(request, adminToken, roleId)
    if (organizationId) {
      await withClient(async (client) => {
        await client.query(
          'delete from customer_entities where tenant_id = $1 and organization_id = $2 and display_name = $3',
          [tenantId, organizationId, fixtureName],
        )
        await client.query('delete from encryption_maps where tenant_id = $1 and organization_id = $2', [tenantId, organizationId])
      })
      await deleteOrganizationIfExists(request, adminToken, organizationId)
    }
  }
})
