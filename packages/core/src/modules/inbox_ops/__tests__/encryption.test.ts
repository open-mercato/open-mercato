import { defaultEncryptionMaps } from '../encryption'

describe('inbox_ops defaultEncryptionMaps', () => {
  it('encrypts InboxEmail body, subject, thread, and correspondent addresses', () => {
    const entry = defaultEncryptionMaps.find((m) => m.entityId === 'inbox_ops:inbox_email')
    expect(entry).toBeDefined()
    expect(entry!.fields).toEqual(expect.arrayContaining([
      { field: 'subject' },
      { field: 'raw_text' },
      { field: 'raw_html' },
      { field: 'cleaned_text' },
      { field: 'thread_messages' },
      { field: 'forwarded_by_address' },
      { field: 'forwarded_by_name' },
      { field: 'to_address' },
      { field: 'reply_to' },
      { field: 'processing_error' },
    ]))
  })

  it('encrypts InboxProposal summary, participants, and translations', () => {
    const entry = defaultEncryptionMaps.find((m) => m.entityId === 'inbox_ops:inbox_proposal')
    expect(entry).toBeDefined()
    expect(entry!.fields).toEqual(expect.arrayContaining([
      { field: 'summary' },
      { field: 'participants' },
      { field: 'translations' },
    ]))
  })

  it('encrypts InboxProposalAction description and payload', () => {
    const entry = defaultEncryptionMaps.find((m) => m.entityId === 'inbox_ops:inbox_proposal_action')
    expect(entry).toBeDefined()
    expect(entry!.fields).toEqual(expect.arrayContaining([
      { field: 'description' },
      { field: 'payload' },
      { field: 'execution_error' },
    ]))
  })

  it('encrypts InboxDiscrepancy description, expected/found values', () => {
    const entry = defaultEncryptionMaps.find((m) => m.entityId === 'inbox_ops:inbox_discrepancy')
    expect(entry).toBeDefined()
    expect(entry!.fields).toEqual(expect.arrayContaining([
      { field: 'description' },
      { field: 'expected_value' },
      { field: 'found_value' },
    ]))
  })

  it('leaves lookup-keyed columns plaintext to preserve WHERE/UNIQUE indexes', () => {
    // These are documented carve-outs — encrypting them requires paired
    // *_hash columns plus rewriting the inbound-webhook duplicate detector
    // and settings lookup. Not in scope for the HUNT-SMELL-01 fix.
    const emailEntry = defaultEncryptionMaps.find((m) => m.entityId === 'inbox_ops:inbox_email')
    const emailFieldNames = (emailEntry?.fields ?? []).map((f) => f.field)
    expect(emailFieldNames).not.toContain('message_id')
    expect(emailFieldNames).not.toContain('in_reply_to')
    expect(emailFieldNames).not.toContain('references')
    expect(emailFieldNames).not.toContain('content_hash')

    const settingsEntry = defaultEncryptionMaps.find((m) => m.entityId === 'inbox_ops:inbox_settings')
    expect(settingsEntry).toBeUndefined()
  })
})
