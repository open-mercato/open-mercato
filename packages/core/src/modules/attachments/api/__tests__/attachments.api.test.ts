/** @jest-environment node */
import { POST as upload } from '@open-mercato/core/modules/attachments/api/attachments'

const mockEm = {
  findOne: jest.fn(async () => ({ configJson: { maxAttachmentSizeMb: 0.001, acceptExtensions: ['pdf'] } })),
  create: jest.fn((_cls: any, data: any) => ({ ...data, id: 'att-1' })),
  persistAndFlush: jest.fn(async () => {}),
}

jest.mock('@/lib/di/container', () => ({
  createRequestContainer: async () => ({ resolve: (k: string) => (k === 'em' ? mockEm : null) }),
}))

jest.mock('@/lib/auth/server', () => ({ getAuthFromRequest: () => ({ orgId: 'org', tenantId: 't1', roles: ['admin'] }) }))

// Avoid touching disk
import { promises as fsp } from 'fs'
jest.spyOn(fsp, 'mkdir').mockResolvedValue(undefined as any)
jest.spyOn(fsp, 'writeFile').mockResolvedValue(undefined as any)

// Avoid loading MikroORM decorators in tests
jest.mock('@open-mercato/core/modules/attachments/data/entities', () => ({ Attachment: class Attachment {} }))

function fdWith(file: File, extra: Record<string, string> = {}) {
  const fd = new FormData()
  fd.set('entityId', 'example:todo')
  fd.set('recordId', 'r1')
  fd.set('fieldKey', 'attachments')
  for (const [k, v] of Object.entries(extra)) fd.set(k, v)
  fd.set('file', file)
  return fd
}

describe('attachments API', () => {
  it('rejects disallowed extension', async () => {
    const file = new File([new Uint8Array([1,2,3])], 'img.png', { type: 'image/png' })
    const req = new Request('http://x/api/attachments', { method: 'POST', body: fdWith(file) as any })
    const res = await upload(req)
    expect(res.status).toBe(400)
    const j = await res.json()
    expect(j.error).toMatch(/not allowed/i)
  })

  it('accepts allowed small pdf', async () => {
    const file = new File([new Uint8Array([1,2,3])], 'doc.pdf', { type: 'application/pdf' })
    const req = new Request('http://x/api/attachments', { method: 'POST', body: fdWith(file) as any })
    const res = await upload(req)
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j?.ok).toBe(true)
  })
})
