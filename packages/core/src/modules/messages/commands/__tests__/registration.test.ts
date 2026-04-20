export {}

const registerCommand = jest.fn()

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand,
}))

describe('messages command registration', () => {
  const cases = [
    {
      path: '../confirmations',
      expected: ['messages.confirmation.confirm'],
    },
    {
      path: '../recipients',
      expected: [
        'messages.recipient.mark_read',
        'messages.recipient.mark_unread',
        'messages.recipient.archive',
        'messages.recipient.unarchive',
      ],
    },
    {
      path: '../attachments',
      expected: [
        'messages.attachment.link_to_draft',
        'messages.attachment.unlink_from_draft',
      ],
    },
    {
      path: '../actions',
      expected: ['messages.action.record_terminal', 'messages.action.execute'],
    },
    {
      path: '../tokens',
      expected: ['messages.token.consume'],
    },
    {
      path: '../conversation',
      expected: [
        'messages.conversation.archive_for_actor',
        'messages.conversation.mark_unread_for_actor',
        'messages.conversation.delete_for_actor',
      ],
    },
    {
      path: '../messages',
      expected: [
        'messages.message.compose',
        'messages.message.update_draft',
        'messages.message.reply',
        'messages.message.forward',
        'messages.message.delete_for_actor',
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
