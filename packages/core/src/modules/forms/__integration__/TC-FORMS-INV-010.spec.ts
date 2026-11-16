import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createDistributionFixture,
  createInvitationsFixture,
  createPublishedFormFixture,
  deleteDistributionIfExists,
  deleteFormIfExists,
  listInvitations,
} from '@open-mercato/core/helpers/integration/formsFixtures'

/**
 * TC-FORMS-INV-010: bulk invitation creation returns each raw token exactly once.
 *
 * Only the SHA-256 `token_hash` is persisted, so the raw token in the create
 * response is the only copy that will ever exist — if the list route echoed it,
 * an admin read would be equivalent to handing out every recipient's credential.
 * The assertion that the list carries no `rawToken` is therefore the security
 * claim, not a cosmetic one.
 *
 * Recipient PII *is* returned by the list route on purpose (the route's own
 * OpenAPI says "recipient PII decrypted"), which is where this deviates from the
 * plan's expectation of a PII-free list. Asserting the decrypted values round-trip
 * is the more useful contract and it doubles as coverage for
 * `findWithDecryption` on `FormInvitation`.
 */
test.describe('TC-FORMS-INV-010: bulk invitation creation', () => {
  test('mints one raw token per recipient and never echoes it again', async ({ request }) => {
    test.slow()

    const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
    let adminToken: string | null = null
    let formId: string | null = null
    let distributionId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      const published = await createPublishedFormFixture(request, adminToken, { name: `QA INV010 ${stamp}` })
      formId = published.formId

      const distribution = await createDistributionFixture(request, adminToken, formId, {
        mode: 'personal',
      })
      distributionId = distribution.id

      const recipients = [
        { email: `qa-inv010-a-${stamp}@test.local`, name: 'Recipient A', ref: `ref-a-${stamp}` },
        { email: `qa-inv010-b-${stamp}@test.local`, name: 'Recipient B', ref: `ref-b-${stamp}` },
        { email: `qa-inv010-c-${stamp}@test.local`, name: 'Recipient C', role: 'participant' },
      ]

      const created = await createInvitationsFixture(request, adminToken, distributionId, recipients)
      expect(created.length, 'one invitation per recipient').toBe(3)

      const rawTokens = created.map((invitation) => invitation.rawToken)
      for (const [index, invitation] of created.entries()) {
        expect(invitation.id, `invitation ${index} carries an id`).toBeTruthy()
        expect(
          typeof invitation.rawToken === 'string' && invitation.rawToken.length >= 32,
          `invitation ${index} carries a high-entropy raw token`,
        ).toBe(true)
      }
      expect(new Set(rawTokens).size, 'every recipient gets a distinct token').toBe(3)

      const listed = await listInvitations(request, adminToken, distributionId)
      expect(listed?.total, 'the list reports all three invitations').toBe(3)
      const items = listed?.items ?? []
      expect(items.length).toBe(3)
      expect(
        items.map((item) => item.id as string).sort(),
        'the list returns the same ids the create returned',
      ).toEqual(created.map((invitation) => invitation.id).sort())

      const serialized = JSON.stringify(items)
      for (const token of rawTokens) {
        expect(
          serialized,
          'a raw invitation token must be returned exactly once, never again on a read',
        ).not.toContain(token as string)
      }
      for (const item of items) {
        expect(
          Object.prototype.hasOwnProperty.call(item, 'rawToken'),
          'the list projection has no rawToken field at all',
        ).toBe(false)
        expect(
          Object.prototype.hasOwnProperty.call(item, 'tokenHash'),
          'the list projection must not leak the token hash either',
        ).toBe(false)
        // `forms.invitation.create` mails the personal link inline for any
        // recipient that supplied an email — that is the ONLY point where the raw
        // token still exists — so such rows land on `sent`, not `pending`. A
        // recipient with no email stays `pending`. Both are correct; what must
        // hold is that the status and the send bookkeeping agree.
        expect(['pending', 'sent'], `unexpected fresh status ${item.status as string}`).toContain(item.status)
        if (item.status === 'sent') {
          expect(item.sentAt, 'a sent invitation records when it was sent').toBeTruthy()
          expect(
            typeof item.sendCount === 'number' && (item.sendCount as number) >= 1,
            'a sent invitation counts the send',
          ).toBe(true)
        } else {
          expect(item.sentAt, 'a pending invitation has not been sent').toBeNull()
          expect(item.sendCount, 'a pending invitation counts no sends').toBe(0)
        }
        expect(item.openedAt, 'nothing has been opened yet').toBeNull()
        expect(item.submittedAt, 'nothing has been submitted yet').toBeNull()
      }

      // Recipient PII round-trips through the encrypted column.
      const emails = items.map((item) => item.recipientEmail as string | null).sort()
      expect(emails, 'the list decrypts and returns the recipient emails').toEqual(
        recipients.map((recipient) => recipient.email).sort(),
      )
      const names = items
        .map((item) => item.recipientName as string | null)
        .filter((value): value is string => typeof value === 'string')
        .sort()
      expect(names, 'the list decrypts and returns the recipient names').toEqual(
        recipients.map((recipient) => recipient.name).sort(),
      )
    } finally {
      await deleteDistributionIfExists(request, adminToken, distributionId)
      await deleteFormIfExists(request, adminToken, formId)
    }
  })
})
