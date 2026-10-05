import { expect, test } from '@playwright/test'
import { ownerPolicyRequest, withAttachmentOwnerFixture, type OwnerAccessItem, type OwnerAccessList } from '@open-mercato/core/helpers/integration/attachmentAccessFixtures'

export const integrationMeta = { dependsOnModules: ['documents'] }

test('TC-ATT-018: metadata pagination and facets exclude hidden and partially visible owners', async ({ request }) => {
  await withAttachmentOwnerFixture(request, async (fixture) => {
    const visibleTag = `${fixture.prefix}-visible`, hiddenTag = `${fixture.prefix}-hidden`
    const first = await fixture.upload(fixture.visible, '01-visible', { tags: [visibleTag] })
    const hidden = await fixture.upload(fixture.hidden, '02-hidden', { tags: [hiddenTag] })
    const second = await fixture.upload(fixture.visible, '03-visible')
    const mixed = await fixture.upload(fixture.visible, '04-mixed', {
      assignments: [{ type: 'documents:document', id: fixture.hidden, label: 'Confidential owner label' }], tags: [hiddenTag],
    })
    const inverse = await fixture.upload(fixture.hidden, '05-inverse', {
      assignments: [{ type: 'documents:document', id: fixture.visible }], tags: [hiddenTag],
    })
    const ids: string[] = []
    for (const page of [1, 2]) {
      const result = await ownerPolicyRequest<OwnerAccessList>('GET', `/api/attachments/library?search=${fixture.prefix}&pageSize=1&page=${page}&sortField=fileName&sortDir=asc`, fixture.recipient.token)
      expect(result.status).toBe(200)
      expect(result.body?.total).toBe(2)
      expect(result.body?.items).toHaveLength(1)
      expect(result.body?.availableTags).toContain(visibleTag)
      expect(result.body?.availableTags).not.toContain(hiddenTag)
      expect(result.bytes.toString()).not.toContain('Confidential owner label')
      ids.push(result.body!.items[0].id)
    }
    expect(ids).toEqual([first, second])
    for (const id of [hidden, mixed, inverse]) {
      expect((await ownerPolicyRequest('GET', `/api/attachments/library/${id}`, fixture.recipient.token)).status).toBe(404)
    }
    const detail = await ownerPolicyRequest<{ item: OwnerAccessItem }>('GET', `/api/attachments/library/${first}`, fixture.recipient.token)
    expect(detail.status).toBe(200)
    expect(detail.body?.item.tags).toEqual([visibleTag])
    expect((await ownerPolicyRequest('GET', `/api/attachments/file/${mixed}`, fixture.recipient.token)).status).toBe(200)
    expect((await ownerPolicyRequest('GET', `/api/attachments/file/${inverse}`, fixture.recipient.token)).status).toBe(200)
    const listPath = `/api/attachments?entityId=documents%3Adocument&recordId=${fixture.visible}&page=1&pageSize=1`
    const scoped = await ownerPolicyRequest<OwnerAccessList>('GET', listPath, fixture.recipient.token)
    expect(scoped.status).toBe(200)
    expect(scoped.body?.total).toBe(2)
    expect(scoped.body?.items).toHaveLength(1)
    const nextScoped = await ownerPolicyRequest<OwnerAccessList>('GET', listPath.replace('page=1', 'page=2'), fixture.recipient.token)
    expect(nextScoped.status).toBe(200)
    expect(nextScoped.body?.total).toBe(2)
    expect(nextScoped.body?.items).toHaveLength(1)
    expect([scoped.body!.items[0].id, nextScoped.body!.items[0].id]).toEqual([second, first])
    const denied = await ownerPolicyRequest<OwnerAccessList>('GET', listPath, fixture.unshared.token)
    expect(denied.status).toBe(200)
    expect(denied.body).toMatchObject({ items: [], total: 0 })
    const hiddenList = await ownerPolicyRequest<OwnerAccessList>('GET', `/api/attachments/library?search=${fixture.prefix}`, fixture.unshared.token)
    expect(hiddenList.status).toBe(200)
    expect(hiddenList.body?.items).toEqual([])
    expect(hiddenList.body?.total).toBe(0)
    expect(hiddenList.body?.availableTags).not.toContain(hiddenTag)
    expect(hiddenList.body?.availableTags).not.toContain(visibleTag)
  })
})
