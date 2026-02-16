export {}

const registerCommand = jest.fn()

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand,
}))

describe('messages command registration', () => {
  const cases = [
    {
      path: '../confirmations',
      expected: ['messages.confirmations.confirm'],
    },
    {
      path: '../recipients',
      expected: [
        'messages.recipients.mark_read',
        'messages.recipients.mark_unread',
        'messages.recipients.archive',
        'messages.recipients.unarchive',
      ],
    },
    {
      path: '../attachments',
      expected: [
        'messages.attachments.link_to_draft',
        'messages.attachments.unlink_from_draft',
      ],
    },
    {
      path: '../actions',
      expected: ['messages.actions.record_terminal'],
    },
    {
      path: '../messages',
      expected: [
        'messages.messages.compose',
        'messages.messages.update_draft',
        'messages.messages.reply',
        'messages.messages.forward',
        'messages.messages.delete_for_actor',
      ],
    },
  ]

  beforeEach(() => {
    registerCommand.mockClear()
    jest.resetModules()
  })

  for (const testCase of cases) {
    it(`registers commands for ${testCase.path}`, () => {
      jest.isolateModules(() => {
        require(testCase.path)
      })

      const ids = registerCommand.mock.calls.map(([cmd]) => cmd.id)
      expect(ids).toEqual(testCase.expected)
    })
  }
})
