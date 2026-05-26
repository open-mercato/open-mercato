import searchConfig from '../search'

function getMessageEntity() {
  const entity = searchConfig.entities.find((entry) => entry.entityId === 'messages:message')
  if (!entity) throw new Error('messages:message entity missing from search config')
  return entity
}

describe('messages search config', () => {
  it('declares searchable, hash-only, and excluded field policies', () => {
    const entity = getMessageEntity()
    expect(entity.fieldPolicy?.searchable).toEqual(['subject', 'body', 'external_name'])
    expect(entity.fieldPolicy?.hashOnly).toEqual(['external_email'])
    expect(entity.fieldPolicy?.excluded).toEqual(['action_data', 'action_result'])
  })

  it('builds an index source containing subject, body, and sender name lines', async () => {
    const entity = getMessageEntity()
    const ctx = {
      record: {
        id: 'msg-1',
        subject: 'Weekly update',
        body: 'Project shipped',
        external_name: 'Jane Doe',
      },
    } as never
    const source = await entity.buildSource?.(ctx)
    expect(source).not.toBeNull()
    expect(source?.text).toEqual(['Subject: Weekly update', 'Body: Project shipped', 'From name: Jane Doe'])
    expect(source?.presenter?.title).toBe('Weekly update')
    expect(source?.presenter?.badge).toBe('Message')
    expect(source?.checksumSource?.record).toMatchObject({
      subject: 'Weekly update',
      body: 'Project shipped',
      external_name: 'Jane Doe',
    })
  })

  it('returns null when no searchable text is present', async () => {
    const entity = getMessageEntity()
    const ctx = { record: {} } as never
    const source = await entity.buildSource?.(ctx)
    expect(source).toBeNull()
  })

  it('resolves URL from record id', async () => {
    const entity = getMessageEntity()
    const result = await entity.resolveUrl?.({ record: { id: 'msg-123' } } as never)
    expect(result).toBe('/backend/messages/msg-123')
  })
})
