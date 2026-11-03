import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { ownerPolicyRequest } from '@open-mercato/core/helpers/integration/attachmentAccessFixtures'

export const integrationMeta = { dependsOnModules: ['entities'] }

test('TC-ATT-021: generic entity records and all export formats cannot disclose attachments', async ({ request }) => {
  const token = await getAuthToken(request, 'admin')
  for (const format of ['', 'csv', 'json', 'xml', 'markdown']) {
    const response = await ownerPolicyRequest<{ code: string; entityId: string }>('GET', `/api/entities/records?entityId=attachments%3Aattachment${format ? `&format=${format}` : ''}`, token)
    expect(response.status).toBe(400)
    expect(response.body).toMatchObject({ code: 'system_entity_records_blocked', entityId: 'attachments:attachment' })
  }
})
