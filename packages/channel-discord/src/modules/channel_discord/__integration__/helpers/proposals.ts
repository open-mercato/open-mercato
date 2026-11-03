import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import type { Message } from '@open-mercato/core/modules/messages/data/entities'
import { createDiscordProposalOriginKey } from '../../lib/ai-proposal-origin'

export async function stampSystemProposalFixture(
  token: string,
  messageId: string,
  proposal: Pick<Message, 'type' | 'visibility' | 'sourceEntityType' | 'sourceEntityId' | 'bodyFormat' | 'body'>,
): Promise<void> {
  const { tenantId, organizationId, userId } = getTokenScope(token)
  const idempotencyKey = createDiscordProposalOriginKey({
    ...proposal, tenantId, organizationId, senderUserId: userId,
  })
  await withClient(async (client) => {
    const result = await client.query(
      'update messages set idempotency_key = $1 where id = $2 and tenant_id = $3 and organization_id = $4',
      [idempotencyKey, messageId, tenantId, organizationId],
    )
    if (result.rowCount !== 1) throw new Error('[internal] System proposal fixture not found')
  })
}
