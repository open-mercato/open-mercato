import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { emitMessagesEvent } from '../events'
import {
  buildMessageMaterializationLog,
  materializeExistingMessage,
  type MaterializeMessageInput,
  type MaterializeMessageResult,
} from './record-existing'

export const RECORD_INGESTED_MESSAGE_COMMAND_ID = 'messages.messages.record_ingested'

export type RecordIngestedMessageInput = MaterializeMessageInput
export type RecordIngestedMessageResult = MaterializeMessageResult

const recordIngestedMessageCommand: CommandHandler<RecordIngestedMessageInput, RecordIngestedMessageResult> = {
  id: RECORD_INGESTED_MESSAGE_COMMAND_ID,
  isUndoable: false,
  async execute(input, ctx) {
    const result = await materializeExistingMessage(input, ctx)
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
  buildLog: buildMessageMaterializationLog,
}

registerCommand(recordIngestedMessageCommand)

export default recordIngestedMessageCommand
