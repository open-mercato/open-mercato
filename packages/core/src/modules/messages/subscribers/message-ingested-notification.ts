import { handleMessageNotification, type MessageNotificationPayload } from './message-notification'

export const metadata = {
  event: 'messages.message.ingested',
  persistent: true,
  id: 'messages:in-app-notification-ingested',
}

export default async function handle(
  payload: MessageNotificationPayload,
  ctx: Parameters<typeof handleMessageNotification>[1],
): Promise<void> {
  await handleMessageNotification(payload, ctx, { preferExternalSender: true })
}
