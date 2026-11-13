import path from 'node:path'
import { access } from 'node:fs/promises'
import { getQueuePendingProbe } from '@open-mercato/queue'

export async function waitForEmailQueuesToSettle(
  appRoot: string,
  options: { timeoutMs?: number; pollIntervalMs?: number } = {},
): Promise<void> {
  const baseDir = path.resolve(appRoot, process.env.QUEUE_BASE_DIR?.trim() || '.mercato/queue')
  if (process.env.QUEUE_STRATEGY !== 'async') await access(baseDir)
  const deadline = Date.now() + (options.timeoutMs ?? 30_000)
  let idlePasses = 0
  while (true) {
    let pending = 0
    for (const queueName of ['events', 'communication-channels-outbound', 'events']) {
      const probe = await getQueuePendingProbe(queueName, undefined, { baseDir })
      if (probe.error) {
        throw new Error(`[internal] Cannot inspect ${queueName}: ${probe.errorMessage ?? 'queue probe failed'}`)
      }
      pending += probe.ready + probe.delayedFuture + probe.active
    }
    idlePasses = pending === 0 ? idlePasses + 1 : 0
    if (idlePasses >= 2) return
    if (Date.now() >= deadline) {
      throw new Error('[internal] Timed out waiting for email queues to settle')
    }
    await new Promise((resolve) => setTimeout(resolve, options.pollIntervalMs ?? 250))
  }
}
