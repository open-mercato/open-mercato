import { forbiddenHttpStatusPattern } from '../__integration__/statusPatterns'

describe('project access guard HTTP status detection', () => {
  it.each([
    'You do not have access to this projectRequest accessVersion 0.11.1-develop.8414.1.68213d4403TermsPrivacy',
    'Version 0.11.1-develop.8414.1.403abcdef0',
    'Version 0.11.1-develop.8414.1.ab403cdef0',
    'Version 0.11.1-develop.8414.1.1234567403',
  ])('allows a snapshot version containing the status digits: %s', (pageText) => {
    expect(pageText).not.toMatch(forbiddenHttpStatusPattern)
  })

  it.each(['403', '403 Forbidden', 'HTTP 403', 'Error: 403.', 'Status (403)', '403\nForbidden'])(
    'detects an actual forbidden status: %s',
    (pageText) => {
      expect(pageText).toMatch(forbiddenHttpStatusPattern)
    },
  )
})
