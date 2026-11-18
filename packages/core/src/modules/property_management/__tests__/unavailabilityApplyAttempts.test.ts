/** @jest-environment node */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createQueue } from '@open-mercato/queue'
import { UNAVAILABILITY_APPLY_MAX_ATTEMPTS } from '../lib/unavailabilityApply'

const QUEUE_NAME = 'pm-unavailability-apply-attempts'

async function failDeliveryAfter(previousAttempts: number): Promise<{ attemptNumber: number; kept: boolean }> {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-apply-attempts-'))
  const queue = createQueue<{ value: number }>(QUEUE_NAME, 'local', { baseDir })
  try {
    await queue.enqueue({ value: 1 })
    const queueFile = path.join(baseDir, QUEUE_NAME, 'queue.json')
    const jobs = JSON.parse(fs.readFileSync(queueFile, 'utf8')) as Array<Record<string, unknown>>
    jobs[0].attemptCount = previousAttempts
    jobs[0].availableAt = undefined
    fs.writeFileSync(queueFile, JSON.stringify(jobs), 'utf8')
    let attemptNumber = 0
    await queue.process(
      (_job, ctx) => {
        attemptNumber = ctx.attemptNumber
        throw new Error('[internal] apply failed')
      },
      { limit: 10 },
    )
    const remaining = JSON.parse(fs.readFileSync(queueFile, 'utf8')) as unknown[]
    return { attemptNumber, kept: remaining.length > 0 }
  } finally {
    await queue.close()
    fs.rmSync(baseDir, { recursive: true, force: true })
  }
}

describe('unavailability apply attempts', () => {
  it('matches the attempts the local queue strategy gives every job, so the final-attempt message is shown on the real last delivery', async () => {
    expect(await failDeliveryAfter(UNAVAILABILITY_APPLY_MAX_ATTEMPTS - 2)).toEqual({ attemptNumber: UNAVAILABILITY_APPLY_MAX_ATTEMPTS - 1, kept: true })
    expect(await failDeliveryAfter(UNAVAILABILITY_APPLY_MAX_ATTEMPTS - 1)).toEqual({ attemptNumber: UNAVAILABILITY_APPLY_MAX_ATTEMPTS, kept: false })
  })
})
