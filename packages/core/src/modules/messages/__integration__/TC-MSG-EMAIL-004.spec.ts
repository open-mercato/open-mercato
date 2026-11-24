import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { acknowledgeGlobalNotices } from '@open-mercato/core/helpers/integration/auth'
import { createUserFixture, deleteUserIfExists } from '@open-mercato/core/helpers/integration/authFixtures'
import { deleteUserAclInDb, setUserAclInDb, withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { htmlToPlainText } from '@open-mercato/shared/lib/html/htmlToPlainText'
import { messageRowBySubject } from './helpers'

const systemSenderId = '00000000-0000-0000-0000-000000000000'
const externalConversationType = 'communication_channels.external_conversation'
const externalSender = { name: 'Jane Doe', email: 'jane@example.test' }
const assignedAgentName = 'QA Assigned Agent'
const inboxPath = '/backend/messages?folder=inbox'

test('TC-MSG-EMAIL-004: inbound email identifies the customer and displays the converted body', async ({ page, request, baseURL }) => {
  const adminToken = await getAuthToken(request, 'admin')
  const { tenantId, organizationId } = getTokenScope(adminToken)
  const stamp = randomUUID()
  const recipientEmail = `qa-recipient-${stamp}@example.test`
  const password = `QA-9!${randomUUID()}`
  const prose = 'Your booking confirmation is ready.'
  const linkTarget = 'https://example.test/booking'
  const rawHtml = [
    '<!DOCTYPE html><html><head>',
    '<style>.email-style-marker { display: none; }</style>',
    '<script>email-script-marker</script></head>',
    `<body><p>${prose}</p><p><a href="${linkTarget}">View booking</a></p></body></html>`,
  ].join('')

  const raw = { id: randomUUID(), subject: `Raw email ${stamp}`, body: rawHtml }
  const converted = { id: randomUUID(), subject: `Converted email ${stamp}`, body: htmlToPlainText(rawHtml) }
  const fallback = { id: randomUUID(), subject: `No external sender ${stamp}`, body: 'Fallback body' }
  const reply = { id: randomUUID(), subject: `Email reply ${stamp}`, body: 'Reply body' }
  const assigned = { id: randomUUID(), subject: `Assigned email ${stamp}`, body: 'Assigned original body' }
  const assignedReply = { id: randomUUID(), subject: `Assigned reply ${stamp}`, body: 'Assigned reply body' }
  const messageIds = [raw.id, converted.id, fallback.id, reply.id, assigned.id, assignedReply.id]
  let recipientId: string | null = null
  let agentId: string | null = null

  try {
    recipientId = await createUserFixture(request, adminToken, {
      email: recipientEmail, password, organizationId, roles: [],
    })
    await setUserAclInDb({ userId: recipientId, tenantId, organizations: [organizationId], features: ['messages.view'] })
    agentId = await createUserFixture(request, adminToken, {
      email: `qa-agent-${stamp}@example.test`, password, organizationId, roles: [], name: assignedAgentName,
    })

    const fixtures = [
      { ...raw, senderId: systemSenderId, identity: externalSender, parentId: null },
      { ...converted, senderId: systemSenderId, identity: externalSender, parentId: null },
      { ...fallback, senderId: systemSenderId, identity: null, parentId: null },
      { ...reply, senderId: systemSenderId, identity: externalSender, parentId: converted.id },
      { ...assigned, senderId: agentId, identity: externalSender, parentId: null },
      { ...assignedReply, senderId: agentId, identity: externalSender, parentId: assigned.id },
    ]
    const sentAt = Date.now() - fixtures.length * 1000
    await withClient(async (client) => {
      for (const [index, fixture] of fixtures.entries()) {
        await client.query(
          `insert into messages
             (id, type, sender_user_id, subject, body, body_format, status, is_draft, visibility,
              external_name, external_email, source_entity_type, thread_id, parent_message_id,
              sent_at, tenant_id, organization_id, created_at, updated_at)
           values ($1, 'default', $2, $3, $4, 'text', 'sent', false, 'internal',
                   $5, $6, $7, $8, $9, $10, $11, $12, now(), now())`,
          [
            fixture.id, fixture.senderId, fixture.subject, fixture.body,
            fixture.identity?.name ?? null, fixture.identity?.email ?? null,
            fixture.identity ? externalConversationType : null,
            fixture.parentId ?? fixture.id, fixture.parentId,
            new Date(sentAt + index * 1000), tenantId, organizationId,
          ],
        )
        await client.query(
          `insert into message_recipients (message_id, recipient_user_id, recipient_type, status, created_at)
           values ($1, $2, 'to', 'unread', now())`,
          [fixture.id, recipientId],
        )
      }
    })

    const recipientToken = await getAuthToken(page.request, recipientEmail, password)
    const cookieUrl = new URL(inboxPath, baseURL).origin
    await page.context().addCookies([
      { name: 'locale', value: 'en', url: cookieUrl },
      { name: 'om_selected_tenant', value: tenantId, url: cookieUrl },
      { name: 'om_selected_org', value: organizationId, url: cookieUrl },
    ])
    await acknowledgeGlobalNotices(page)

    const expectInboxLabels = async () => {
      for (const fixture of fixtures) {
        const expectedSender = fixture.identity?.name ?? systemSenderId
        await expect(messageRowBySubject(page, fixture.subject).getByText(expectedSender, { exact: true })).toBeVisible()
      }
    }
    const collapsedRows = page.getByRole('button', { name: /^Open message from / })
    const collapsedExternalRow = page.getByRole('button', { name: `Open message from ${externalSender.name}`, exact: true })
    const externalHeader = page.getByText(`From: ${externalSender.name}`, { exact: true })

    await test.step('the inbox labels every sender, including the UUID fallback', async () => {
      await page.goto(inboxPath)
      await expectInboxLabels()
    })

    await test.step('the thread labels the external sender and expands the converted email as text', async () => {
      await page.goto(`/backend/messages/${reply.id}`)
      await expect(externalHeader).toBeVisible()
      await expect(collapsedRows).toHaveCount(1)
      await expect(collapsedExternalRow).toBeVisible()
      await collapsedExternalRow.click()
      await expect(externalHeader).toHaveCount(2)
      const renderedBody = page.getByText(prose)
      await expect(renderedBody).toBeVisible()
      await expect(renderedBody).toContainText(linkTarget)
      await expect(renderedBody).not.toContainText(/<!doctype|<style|<script|email-style-marker|email-script-marker/i)
    })

    await test.step('the raw HTML and missing-identity controls still render', async () => {
      await page.goto(`/backend/messages/${raw.id}`)
      await expect(externalHeader).toBeVisible()
      await expect(page.getByText('<!DOCTYPE html>')).toBeVisible()
      await page.goto(`/backend/messages/${fallback.id}`)
      await expect(page.getByText(`From: ${systemSenderId}`, { exact: true })).toBeVisible()
    })

    await test.step('an assigned thread labels the customer even when the API resolves the agent', async () => {
      const response = await apiRequest(request, 'GET', `/api/messages/${assignedReply.id}?skipMarkRead=1`, { token: recipientToken })
      expect(response.status()).toBe(200)
      const agentSender = { senderName: assignedAgentName, sourceEntityType: externalConversationType }
      expect(await readJsonSafe(response)).toMatchObject({
        ...agentSender,
        thread: [{ id: assigned.id, ...agentSender }, { id: assignedReply.id, ...agentSender }],
      })

      await page.goto(`/backend/messages/${assignedReply.id}`)
      await expect(externalHeader).toBeVisible()
      await expect(collapsedRows).toHaveCount(1)
      await expect(collapsedExternalRow).toBeVisible()
    })

    await test.step('the same inbox labels are visible at 390×844', async () => {
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto(inboxPath)
      await expectInboxLabels()
    })
  } finally {
    try {
      await withClient(async (client) => {
        await client.query('delete from message_recipients where message_id = any($1::uuid[])', [messageIds])
        await client.query('delete from messages where id = any($1::uuid[])', [messageIds])
      })
    } finally {
      try {
        if (recipientId) await deleteUserAclInDb(recipientId)
      } finally {
        await Promise.all([
          deleteUserIfExists(request, adminToken, recipientId),
          deleteUserIfExists(request, adminToken, agentId),
        ])
      }
    }
  }
})
