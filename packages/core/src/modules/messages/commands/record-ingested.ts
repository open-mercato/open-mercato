import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { emitMessagesEvent } from '../events'
import recordExistingMessageCommand, {
  type RecordExistingMessageInput,
  type RecordExistingMessageResult,
} from './record-existing'

export const RECORD_INGESTED_MESSAGE_COMMAND_ID = 'messages.messages.record_ingested'

const recordIngestedMessageCommand: CommandHandler<RecordExistingMessageInput, RecordExistingMessageResult> = {
  id: RECORD_INGESTED_MESSAGE_COMMAND_ID,
  isUndoable: false,
  async execute(input, ctx) {
    const result = await recordExistingMessageCommand.execute(input, ctx)
    if (result.deduplicated) return result

    await emitMessagesEvent(
      'messages.message.ingested',
      {
        messageId: result.id,
        senderUserId: input.recordedByUserId,
        recipientUserIds: result.recipientUserIds,
        tenantId: input.tenantId,
        organizationId: input.organizationId,
      },
      { persistent: true },
    )
    return result
  },
  buildLog: (args) => recordExistingMessageCommand.buildLog?.(args),
}

registerCommand(recordIngestedMessageCommand)

export default recordIngestedMessageCommand
