import { resolveAttachmentServicePort } from '../lib/attachmentServicePort'

describe('resolveAttachmentServicePort', () => {
  it.each([
    { resolve: () => null },
    { resolve: () => ({ validateUpload: () => undefined, createScoped: async () => ({ id: 'attachment-1' }) }) },
    { resolve: () => { throw new Error('registration missing') } },
  ])('fails closed when the Attachments service is unavailable or incomplete', (container) => {
    expect(() => resolveAttachmentServicePort(container)).toThrow(
      expect.objectContaining({ status: 503 }),
    )
  })

  it('returns a structurally compatible service without importing its implementation', () => {
    const service = {
      validateUpload: jest.fn(),
      createScoped: jest.fn(),
      readScoped: jest.fn(),
    }

    expect(resolveAttachmentServicePort({ resolve: () => service })).toBe(service)
  })
})
