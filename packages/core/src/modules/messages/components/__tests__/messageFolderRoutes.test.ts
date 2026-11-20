import { messageDetailHref, messageListHref, parseMessageFolder } from '../messageFolderRoutes'

describe('messageFolderRoutes', () => {
  it('parses known folders and falls back to the inbox', () => {
    expect(parseMessageFolder('scheduled')).toBe('scheduled')
    expect(parseMessageFolder('drafts')).toBe('drafts')
    expect(parseMessageFolder('nope')).toBe('inbox')
    expect(parseMessageFolder(null)).toBe('inbox')
  })

  it('keeps the folder in list and detail links, omitting it for the inbox', () => {
    expect(messageListHref('inbox')).toBe('/backend/messages')
    expect(messageListHref('scheduled')).toBe('/backend/messages?folder=scheduled')
    expect(messageDetailHref('m1', 'scheduled')).toBe('/backend/messages/m1?folder=scheduled')
    expect(messageDetailHref('m1', 'inbox')).toBe('/backend/messages/m1')
  })
})
