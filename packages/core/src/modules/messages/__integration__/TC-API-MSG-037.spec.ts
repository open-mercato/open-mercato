import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { composeMessageWithToken, decodeJwtSubject, deleteMessageIfExists } from './helpers'
import { listMessageIds, QA_RECIPIENTS, useRaisedExternalEmailBudget } from './scheduledSendFixtures'

type Detail = {
  externalParticipants?: Array<{ id: string; email: string; role: string }>
  _channelPayload?: { channelMetadata?: Record<string, unknown> | null } | null
}

/**
 * TC-API-MSG-037: blind-copy recipients are the author's business. A thread viewer who is not
 * the author sees neither the BCC addresses in the message detail nor a hit when filtering the
 * list by a BCC address; the author sees both. The same holds for the enriched mailbox link
 * metadata (including a legacy link that still stores BCC) while delivery is pending or failed.
 */
test.describe('TC-API-MSG-037: BCC recipients stay with the author', () => {
  useRaisedExternalEmailBudget()
  test('hides BCC participants and BCC filter matches from a non-author viewer', async ({ request }) => {
    const authorToken = await getAuthToken(request, 'admin')
    const viewerToken = await getAuthToken(request, 'employee')
    const addresses = [QA_RECIPIENTS[0], QA_RECIPIENTS[1]]
    let messageId: string | null = null
    let linkId: string | null = null

    try {
      messageId = await composeMessageWithToken(request, authorToken, {
        visibility: 'public',
        externalEmails: addresses,
        recipients: [],
        subject: `QA TC-API-MSG-037 ${Date.now()}`,
        body: 'Blind copy coverage.',
        sendViaEmail: true,
      })
      const readDetail = async (token: string): Promise<Detail> => {
        const response = await apiRequest(request, 'GET', `/api/messages/${messageId}?skipMarkRead=1`, { token })
        expect(response.ok()).toBeTruthy()
        return (await readJsonSafe<Detail>(response)) ?? {}
      }
      const [toAddress, blindAddress] = addresses
      const blindParticipant = (await readDetail(authorToken)).externalParticipants?.find((participant) => participant.email === blindAddress)
      expect(blindParticipant, 'the second address is stored as a participant').toBeTruthy()
      await withClient(async (client) => {
        await client.query(`update message_external_participants set role = 'bcc' where id = $1`, [blindParticipant?.id])
        // The viewer reads the thread the way a routed colleague does: through a recipient row.
        await client.query(
          `insert into message_recipients (message_id, recipient_user_id, recipient_type, status, created_at)
           values ($1, $2, 'to', 'unread', now())`,
          [messageId, decodeJwtSubject(viewerToken)],
        )
      })

      const authorParticipants = (await readDetail(authorToken)).externalParticipants ?? []
      expect(authorParticipants.map((participant) => [participant.email, participant.role])).toEqual(expect.arrayContaining([[toAddress, 'to'], [blindAddress, 'bcc']]))
      expect(authorParticipants).toHaveLength(2)
      const viewerParticipants = (await readDetail(viewerToken)).externalParticipants ?? []
      expect(viewerParticipants.map((participant) => [participant.email, participant.role])).toEqual([[toAddress, 'to']])

      expect(await listMessageIds(request, authorToken, { folder: 'sent', externalEmail: blindAddress })).toContain(messageId)
      expect(await listMessageIds(request, viewerToken, { folder: 'inbox', externalEmail: toAddress })).toContain(messageId)
      expect(await listMessageIds(request, viewerToken, { folder: 'inbox', externalEmail: blindAddress })).not.toContain(messageId)

      linkId = await withClient(async (client) => {
        const inserted = await client.query<{ id: string }>(
          `insert into message_channel_links
             (message_id, external_conversation_id, provider_key, channel_type, direction, delivery_status,
              channel_payload, channel_content_type, channel_metadata, tenant_id, organization_id, created_at)
           select id, gen_random_uuid(), 'imap', 'email', 'outbound', 'pending',
                  '{"text":"Blind copy coverage."}'::jsonb, 'text/plain', $2::jsonb, tenant_id, organization_id, now()
           from messages where id = $1
           returning id`,
          [messageId, JSON.stringify({ to: [toAddress], cc: [], bcc: [blindAddress], subject: 'Legacy link' })],
        )
        return inserted.rows[0]?.id ?? null
      })
      expect(linkId, 'a legacy mailbox link holding BCC metadata was created').toBeTruthy()
      for (const deliveryStatus of ['pending', 'failed']) {
        await withClient((client) => client.query(`update message_channel_links set delivery_status = $2 where id = $1`, [linkId, deliveryStatus]))
        const authorMetadata = (await readDetail(authorToken))._channelPayload?.channelMetadata
        expect(authorMetadata?.bcc, `author sees BCC while ${deliveryStatus}`).toEqual([blindAddress])
        const viewerDetail = await readDetail(viewerToken)
        expect(viewerDetail._channelPayload?.channelMetadata, `viewer gets the ${deliveryStatus} link metadata`).toBeTruthy()
        expect(viewerDetail._channelPayload?.channelMetadata).not.toHaveProperty('bcc')
        expect(JSON.stringify(viewerDetail._channelPayload), `viewer never sees the BCC address while ${deliveryStatus}`).not.toContain(blindAddress)
      }
    } finally {
      if (linkId) await withClient((client) => client.query(`delete from message_channel_links where id = $1`, [linkId]))
      await deleteMessageIfExists(request, authorToken, messageId)
    }
  })
})
