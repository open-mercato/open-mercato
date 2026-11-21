import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  getAuthToken,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { deleteEntityByPathIfExists, expectId, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'
import {
  deleteChannelIfExists,
  inspectMessageChannelLinks,
  isChannelSeedingAvailable,
  seedConnectedChannel,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'

/**
 * TC-CHANNEL-EMAIL-HUB-004 — composing from a connected mailbox (#6258).
 *
 * The composer posts an optional `senderChannelId` to `POST /api/messages`. With
 * it the route delegates to the hub's send-as-user facade, so the message must
 * come out with the channel-side rows inbound threading matches on; without it
 * the platform path must stay exactly as it was.
 *
 * A connected channel can only be provisioned through the env-gated test-seed
 * fixture, so the suite skips when `OM_ENABLE_TEST_CHANNEL_SEEDING` is off.
 */
test.describe('TC-CHANNEL-EMAIL-HUB-004: compose from a connected mailbox', () => {
  test('sends a resumed draft through the selected mailbox and keeps its message ID', async ({ page, request }) => {
    test.slow()
    const stamp = randomUUID()
    const subject = `Resumed mailbox draft ${stamp}`
    const mailbox = `Draft mailbox ${stamp}`
    let token: string | null = null
    let channelId: string | null = null
    let draftPath: string | null = null

    try {
      token = await getAuthToken(request)
      test.skip(!await isChannelSeedingAvailable(request, token), 'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled.')
      channelId = await seedConnectedChannel(request, token, {
        displayName: mailbox,
        externalIdentifier: `draft-mailbox-${stamp}@example.com`,
      })

      const draft = await apiRequest(request, 'POST', '/api/messages', {
        token,
        data: {
          type: 'default',
          isDraft: true,
          visibility: 'public',
          externalEmail: `draft-recipient-${stamp}@example.com`,
          subject,
          body: 'Saved first and sent when reopened.',
          bodyFormat: 'text',
        },
      })
      expect(draft.status()).toBe(201)
      const draftId = expectId((await readJsonSafe<{ id: string }>(draft))?.id, 'The draft has its own ID')
      draftPath = `/api/messages/${draftId}`

      const rejected = await apiRequest(request, 'PATCH', draftPath, {
        token,
        data: { isDraft: false, senderChannelId: randomUUID() },
      })
      expect(rejected.status()).toBe(404)
      expect((await readJsonSafe<{ fieldErrors: Record<string, string> }>(rejected))?.fieldErrors.senderChannelId).toBeTruthy()
      const before = await apiRequest(request, 'GET', draftPath, { token })
      expect(await readJsonSafe(before)).toMatchObject({ isDraft: true, subject })
      expect((await inspectMessageChannelLinks(request, token, draftId)).links).toEqual([])

      await login(page, 'admin')
      await page.goto(`/backend/messages/${draftId}`)
      await page.getByRole('button', { name: 'Actions', exact: true }).hover()
      await page.getByRole('menuitem', { name: 'Edit', exact: true }).click()
      const composer = page.getByRole('dialog')
      await composer.getByLabel('Send from', { exact: true }).click()
      await page.getByRole('option', { name: new RegExp(mailbox) }).click()
      const sentResponse = page.waitForResponse((response) => (
        response.request().method() === 'PATCH' && new URL(response.url()).pathname === draftPath
      ))
      await composer.getByRole('button', { name: 'Send', exact: true }).click()
      const sent = await sentResponse
      expect(sent.status()).toBe(200)
      expect(await sent.json()).toMatchObject({ ok: true, id: draftId })
      await expect(composer).toBeHidden()

      const detail = await apiRequest(request, 'GET', draftPath, { token })
      expect(await readJsonSafe(detail)).toMatchObject({ isDraft: false, threadId: draftId, subject })
      const drafts = await apiRequest(request, 'GET', `/api/messages?folder=drafts&search=${encodeURIComponent(subject)}`, { token })
      expect(await readJsonSafe(drafts)).toMatchObject({ items: [] })
      const replay = await apiRequest(request, 'PATCH', draftPath, { token, data: { isDraft: false, senderChannelId: channelId } })
      expect(replay.status()).toBe(409)

      await drainIntegrationQueue('communication-channels-outbound')
      const { links, threadMappings } = await inspectMessageChannelLinks(request, token, draftId)
      expect(links).toHaveLength(1)
      expect(links[0]).toMatchObject({ direction: 'outbound', deliveryStatus: 'sent', channelType: 'email' })
      expect(threadMappings).toEqual([
        expect.objectContaining({ channelId, messageThreadId: draftId, externalConversationId: links[0].externalConversationId }),
      ])
    } finally {
      await deleteEntityByPathIfExists(request, token, draftPath)
      await deleteChannelIfExists(request, token, channelId)
    }
  })

  test('a chosen mailbox writes the outbound link and the thread mapping', async ({ request }) => {
    const stamp = Date.now()
    let token: string | null = null
    let channelId: string | null = null

    try {
      token = await getAuthToken(request)
      const seedingAvailable = await isChannelSeedingAvailable(request, token)
      test.skip(
        !seedingAvailable,
        'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled; cannot provision a connected channel.',
      )

      channelId = await seedConnectedChannel(request, token, {
        displayName: `Composer mailbox ${stamp}`,
        externalIdentifier: `composer-${stamp}@example.com`,
      })

      const response = await apiRequest(request, 'POST', '/api/messages', {
        token,
        data: {
          type: 'default',
          visibility: 'public',
          externalEmail: `client-${stamp}@example.com`,
          subject: `Composer mailbox send ${stamp}`,
          body: 'Sent from the employee mailbox.',
          bodyFormat: 'text',
          senderChannelId: channelId,
        },
      })
      expect(
        response.status(),
        'composing with a selected mailbox should be accepted',
      ).toBe(201)

      const created = await readJsonSafe<{ id?: string; threadId?: string }>(response)
      expect(created?.id, 'compose response should carry the message id').toBeTruthy()

      const inspected = await inspectMessageChannelLinks(request, token, created!.id!)
      const outbound = inspected.links.filter((link) => link.direction === 'outbound')
      expect(outbound.length, 'an outbound MessageChannelLink should exist').toBe(1)
      expect(outbound[0].externalConversationId).toBeTruthy()

      const mapping = inspected.threadMappings.find(
        (entry) => entry.externalConversationId === outbound[0].externalConversationId,
      )
      expect(mapping, 'a ChannelThreadMapping should exist for the thread').toBeTruthy()
      expect(mapping!.channelId).toBe(channelId)
      expect(mapping!.messageThreadId).toBeTruthy()
    } finally {
      await deleteChannelIfExists(request, token, channelId)
    }
  })

  test('no mailbox selected keeps the platform path free of channel rows', async ({ request }) => {
    const stamp = Date.now()
    const token = await getAuthToken(request)
    const seedingAvailable = await isChannelSeedingAvailable(request, token)
    test.skip(!seedingAvailable, 'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled.')

    const response = await apiRequest(request, 'POST', '/api/messages', {
      token,
      data: {
        type: 'default',
        visibility: 'public',
        externalEmail: `client-${stamp}@example.com`,
        subject: `Platform sender ${stamp}`,
        body: 'Sent from the platform sender.',
        bodyFormat: 'text',
      },
    })
    expect(response.status(), 'the platform-sender path should be unchanged').toBe(201)

    const created = await readJsonSafe<{ id?: string }>(response)
    expect(created?.id).toBeTruthy()

    const inspected = await inspectMessageChannelLinks(request, token, created!.id!)
    expect(inspected.links, 'no channel link should be written for a platform send').toEqual([])
  })

  test('a mailbox nobody has connected is refused as not found', async ({ request }) => {
    const stamp = Date.now()
    const token = await getAuthToken(request)
    const seedingAvailable = await isChannelSeedingAvailable(request, token)
    test.skip(!seedingAvailable, 'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled.')

    const response = await apiRequest(request, 'POST', '/api/messages', {
      token,
      data: {
        type: 'default',
        visibility: 'public',
        externalEmail: `client-${stamp}@example.com`,
        subject: `Unknown mailbox ${stamp}`,
        body: 'Should not be sent.',
        bodyFormat: 'text',
        senderChannelId: '00000000-0000-4000-8000-0000000000ff',
      },
    })

    expect(response.status(), 'a nonexistent channel id is a 404, not a silent success').toBe(404)
    const body = await readJsonSafe<{ fieldErrors?: Record<string, string> }>(response)
    expect(
      body?.fieldErrors?.senderChannelId,
      'the failure should land on the composer sender field',
    ).toBeTruthy()
  })

  test('a mailbox connected by a different employee is refused, not silently ignored', async ({ request }) => {
    const stamp = Date.now()
    let adminToken: string | null = null
    let ownerToken: string | null = null
    let ownerUserId: string | null = null
    let roleId: string | null = null
    let channelId: string | null = null

    try {
      adminToken = await getAuthToken(request)
      const seedingAvailable = await isChannelSeedingAvailable(request, adminToken)
      test.skip(!seedingAvailable, 'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled.')

      const scope = getTokenScope(adminToken)

      const roleName = `qa_channel_hub_004_owner_${stamp}`
      roleId = await createRoleFixture(request, adminToken, {
        name: roleName,
        tenantId: scope.tenantId,
      })
      const aclResp = await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
        token: adminToken,
        data: {
          roleId,
          features: ['communication_channels.connect_user_channel'],
        },
      })
      expect(aclResp.ok(), 'PUT /api/auth/roles/acl (channel owner) should succeed').toBeTruthy()

      const ownerEmail = `qa-channel-hub-004-owner-${stamp}@example.com`
      const ownerPassword = 'Valid1!Pass'
      ownerUserId = await createUserFixture(request, adminToken, {
        email: ownerEmail,
        password: ownerPassword,
        organizationId: scope.organizationId,
        roles: [roleName],
        name: 'QA Channel Hub 004 Owner',
      })
      ownerToken = await getAuthToken(request, ownerEmail, ownerPassword)

      channelId = await seedConnectedChannel(request, ownerToken, {
        displayName: `Someone else's mailbox ${stamp}`,
        externalIdentifier: `channel-owner-${stamp}@example.com`,
      })

      const response = await apiRequest(request, 'POST', '/api/messages', {
        token: adminToken,
        data: {
          type: 'default',
          visibility: 'public',
          externalEmail: `client-${stamp}@example.com`,
          subject: `Borrowed mailbox ${stamp}`,
          body: 'Should not be sent.',
          bodyFormat: 'text',
          senderChannelId: channelId,
        },
      })

      expect(response.status(), 'sending through a channel owned by someone else is a 403').toBe(403)
      const body = await readJsonSafe<{ fieldErrors?: Record<string, string> }>(response)
      expect(
        body?.fieldErrors?.senderChannelId,
        'the failure should land on the composer sender field',
      ).toBeTruthy()
    } finally {
      await deleteChannelIfExists(request, ownerToken, channelId)
      await deleteUserIfExists(request, adminToken, ownerUserId)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })
})
