import { expect, test } from '@playwright/test'
import { ownerPolicyRequest, withAttachmentOwnerFixture, type OwnerAccessItem, type OwnerAccessList } from '@open-mercato/core/helpers/integration/attachmentAccessFixtures'

export const integrationMeta = { dependsOnModules: ['documents'] }

test('TC-ATT-019: viewer mutations and mixed transfers fail atomically while editors can mutate', async ({ request }) => {
  await withAttachmentOwnerFixture(request, async (fixture) => {
    const visible = await fixture.upload(fixture.visible, 'mutable', { tags: ['unchanged'] })
    const hidden = await fixture.upload(fixture.hidden, 'hidden')
    const detail = `/api/attachments/library/${visible}`
    const snapshot = async (id: string) => ({
      item: (await ownerPolicyRequest<{ item: OwnerAccessItem }>('GET', `/api/attachments/library/${id}`, fixture.admin)).body?.item,
      bytes: (await ownerPolicyRequest('GET', `/api/attachments/file/${id}`, fixture.admin)).bytes,
    })
    const list = async (documentId: string) => {
      const result = await ownerPolicyRequest<OwnerAccessList>('GET', `/api/attachments?entityId=documents%3Adocument&recordId=${documentId}`, fixture.admin)
      expect(result.status).toBe(200)
      return result.body!.items.map(item => item.id)
    }
    const originalVisible = await snapshot(visible), originalHidden = await snapshot(hidden)
    const expectOriginals = async () => {
      expect(await snapshot(visible)).toEqual(originalVisible)
      expect(await snapshot(hidden)).toEqual(originalHidden)
      expect(await list(fixture.visible)).toEqual([visible])
      expect(await list(fixture.hidden)).toEqual([hidden])
      expect(await list(fixture.destination)).toEqual([])
    }
    for (const [method, path, data] of [
      ['PATCH', detail, { assignments: [], tags: ['denied'] }],
      ['DELETE', detail, undefined],
      ['DELETE', `/api/attachments?id=${visible}`, undefined],
    ] as const) expect((await ownerPolicyRequest(method, path, fixture.recipient.token, data)).status).toBe(404)
    await expectOriginals()
    await fixture.share(fixture.visible, 'editor')
    const transfer = { entityId: 'documents:document', attachmentIds: [visible], fromRecordId: fixture.visible, toRecordId: fixture.destination }
    expect((await ownerPolicyRequest('POST', '/api/attachments/transfer', fixture.recipient.token, transfer)).status).toBe(404)
    await expectOriginals()
    await fixture.share(fixture.destination, 'editor')
    expect((await ownerPolicyRequest('POST', '/api/attachments/transfer', fixture.recipient.token, { ...transfer, attachmentIds: [visible, hidden], fromRecordId: undefined })).status).toBe(404)
    await expectOriginals()
    expect((await ownerPolicyRequest('POST', '/api/attachments/transfer', fixture.recipient.token, transfer)).status).toBe(200)
    expect(await list(fixture.visible)).toEqual([])
    expect(await list(fixture.destination)).toEqual([visible])
    expect(await snapshot(hidden)).toEqual(originalHidden)
    expect((await ownerPolicyRequest('PATCH', detail, fixture.recipient.token, { tags: ['edited'] })).status).toBe(200)
    const edited = await snapshot(visible)
    expect(edited.item?.tags).toEqual(['edited'])
    expect(edited.item?.assignments).toContainEqual(expect.objectContaining({ type: 'documents:document', id: fixture.destination }))
    expect(edited.bytes).toEqual(originalVisible.bytes)
    expect((await ownerPolicyRequest('DELETE', detail, fixture.recipient.token)).status).toBe(200)
    expect((await ownerPolicyRequest('GET', `/api/attachments/file/${visible}`, fixture.admin)).status).toBe(404)
    const second = await fixture.upload(fixture.destination, 'delete-main')
    expect((await ownerPolicyRequest('DELETE', `/api/attachments?id=${second}`, fixture.recipient.token)).status).toBe(200)
    expect((await ownerPolicyRequest('GET', `/api/attachments/file/${second}`, fixture.admin)).status).toBe(404)
  })
})
