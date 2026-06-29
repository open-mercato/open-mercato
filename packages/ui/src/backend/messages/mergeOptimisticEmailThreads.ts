import type { EmailThread, EmailThreadMessage } from './EmailThreadsPanel'

/**
 * An optimistic (client-side, not-yet-server-confirmed) outbound message plus
 * the key of the thread it belongs to. `message.messageId` is the Open Mercato
 * Message id returned by the send API — it is the reconciliation key against the
 * server-fetched threads.
 */
export type OptimisticEmailMessage = EmailThreadMessage & { threadKey: string }

/**
 * Overlay optimistic "sending" / "sent" / "failed" messages onto the
 * server-fetched threads so a just-sent email appears immediately and is then
 * replaced by the real record once the delivery worker links it.
 *
 * Reconciliation is keyed on `messageId`: when a server thread already contains a
 * message with the same `messageId` as an optimistic one, the optimistic copy is
 * dropped (the server record wins) so the message never appears twice. Ordering
 * matches the server build: messages ascending by `sentAt`, threads descending by
 * `lastMessageAt`. The input arrays are never mutated.
 */
export function mergeOptimisticEmailThreads(
  serverThreads: EmailThread[],
  optimistic: OptimisticEmailMessage[],
): EmailThread[] {
  if (optimistic.length === 0) return serverThreads

  const serverMessageIds = new Set<string>()
  for (const thread of serverThreads) {
    for (const message of thread.messages) {
      if (message.messageId) serverMessageIds.add(message.messageId)
    }
  }

  // Drop optimistic copies the server has already linked (dedupe by messageId).
  const pending = optimistic.filter(
    (entry) => !(entry.messageId && serverMessageIds.has(entry.messageId)),
  )
  if (pending.length === 0) return serverThreads

  const byKey = new Map<string, EmailThread>()
  const order: string[] = []
  for (const thread of serverThreads) {
    byKey.set(thread.threadKey, thread)
    order.push(thread.threadKey)
  }

  for (const entry of pending) {
    const { threadKey, ...message } = entry
    const existing = byKey.get(threadKey)
    if (existing) {
      // Guard against double-adding the same optimistic message across re-renders.
      if (existing.messages.some((m) => m.id === message.id)) continue
      const messages = [...existing.messages, message].sort((a, b) =>
        a.sentAt.localeCompare(b.sentAt),
      )
      const last = messages[messages.length - 1]
      byKey.set(threadKey, {
        ...existing,
        messages,
        messageCount: messages.length,
        lastMessageAt: last?.sentAt ?? existing.lastMessageAt,
        lastDirection: last?.direction ?? existing.lastDirection,
      })
    } else {
      byKey.set(threadKey, {
        threadKey,
        subject: message.subject,
        preview: message.bodyText ? message.bodyText.slice(0, 140) : null,
        participants: message.to,
        lastMessageAt: message.sentAt,
        messageCount: 1,
        providerKey: message.providerKey,
        lastDirection: message.direction,
        messages: [message],
      })
      order.push(threadKey)
    }
  }

  return order
    .map((key) => byKey.get(key)!)
    .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))
}
