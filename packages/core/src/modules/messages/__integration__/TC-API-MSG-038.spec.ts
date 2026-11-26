import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { createQueue } from '@open-mercato/queue'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { resolveAppRoot } from '@open-mercato/core/helpers/integration/appRoot'
import { withClient, type IntegrationDbClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'
import {
  clearCapturedSystemEmails,
  deleteChannelIfExists,
  inspectMessageChannelLinks,
  isChannelSeedingAvailable,
  listCapturedSystemEmails,
  seedConnectedChannel,
  seedSystemEmailChannel,
  type CapturedTestSeedEmail,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'
import { composeMessageWithToken, deleteMessageIfExists } from './helpers'
import { drainDeliveryUntil, readMessageParticipants } from './deliveryFixtures'
import {
  isSchedulingAvailable,
  scheduledAtInMinutes,
  QA_RECIPIENTS,
  useRaisedExternalEmailBudget,
} from './scheduledSendFixtures'

const RELEASE_QUEUE = 'messages-scheduled-release'
const RACERS = 4
const RACER_WAIT_MS = 15_000

type ReleaseRace = { racerExitCodes: Array<number | null>; racerErrors: string[] }

/**
 * Starts one more release worker process next to the app's own one. It takes at most one
 * release job at a time from the shared queue, so every racer holds its own claim.
 */
function startReleaseWorker(): { exited: Promise<number | null>; output: () => string } {
  const appRoot = resolveAppRoot()
  const runner = createRequire(path.join(appRoot, 'package.json')).resolve('@open-mercato/core/helpers/integration/queue-runner')
  const child = spawn(process.execPath, [runner], {
    cwd: appRoot,
    env: {
      ...process.env,
      OM_INTEGRATION_APP_ROOT: appRoot,
      OM_INTEGRATION_QUEUE_NAME: RELEASE_QUEUE,
      OM_INTEGRATION_QUEUE_JOB_LIMIT: '1',
      OM_CACHE_SAFETY_ALWAYS_CONSISTENT: 'true',
      QUEUE_BASE_DIR: process.env.QUEUE_BASE_DIR?.trim() || path.resolve(appRoot, '.mercato/queue'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout?.on('data', (chunk) => { output += chunk.toString() })
  child.stderr?.on('data', (chunk) => { output += chunk.toString() })
  const exited = new Promise<number | null>((resolve) => {
    child.on('error', () => resolve(-1))
    child.on('close', (code) => resolve(code))
  })
  return { exited, output: () => output }
}

async function countWaitingClaims(): Promise<number> {
  return withClient(async (client) => {
    const result = await client.query<{ waiting: string }>(
      `select count(*) as waiting from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'
          and query ilike '%scheduled_release_attempts%'`,
    )
    return Number(result.rows[0]?.waiting ?? 0)
  })
}

/**
 * Releases one organization's due messages from several worker processes at the same instant.
 * `prepare` makes the message due inside a transaction that holds `messages` in EXCLUSIVE mode,
 * so the app's scheduler cannot release it early and every racer's claim UPDATE blocks on the
 * lock; committing once all of them wait starts the claims together on the real database.
 */
async function raceScheduledReleases(
  token: string,
  prepare: (client: IntegrationDbClient) => Promise<void>,
): Promise<ReleaseRace> {
  test.skip(!process.env.DATABASE_URL?.trim(), 'release workers need the harness DATABASE_URL')
  const scope = getTokenScope(token)
  const workers: Array<ReturnType<typeof startReleaseWorker>> = []
  await withClient(async (client) => {
    await client.query('begin')
    try {
      await client.query('lock table messages in exclusive mode')
      await prepare(client)
      const queue = createQueue<{ scope: { tenantId: string; organizationId: string } }>(RELEASE_QUEUE, 'local', {
        baseDir: process.env.QUEUE_BASE_DIR?.trim() || path.resolve(resolveAppRoot(), '.mercato/queue'),
      })
      try {
        for (let racer = 1; racer <= RACERS; racer += 1) {
          await queue.enqueue({ scope: { tenantId: scope.tenantId, organizationId: scope.organizationId } })
          workers.push(startReleaseWorker())
          const deadline = Date.now() + RACER_WAIT_MS
          while (Date.now() < deadline && (await countWaitingClaims()) < racer) {
            await new Promise((resolve) => setTimeout(resolve, 200))
          }
          expect(
            await countWaitingClaims(),
            `release ${racer} waits on the lock: ${workers.map((worker) => worker.output()).join('\n')}`,
          ).toBeGreaterThanOrEqual(racer)
        }
      } finally {
        await queue.close()
      }
      await client.query('commit')
    } catch (error) {
      await client.query('rollback')
      throw error
    }
  })
  const racerExitCodes = await Promise.all(workers.map((worker) => worker.exited))
  await drainIntegrationQueue(RELEASE_QUEUE)
  await drainIntegrationQueue('events')
  return { racerExitCodes, racerErrors: workers.map((worker) => worker.output()).filter((text) => text.trim().length > 0) }
}

async function readReleaseRow(messageId: string) {
  return withClient(async (client) => {
    const result = await client.query<{ status: string; attempts: number; sent_at: Date | null }>(
      'select status, scheduled_release_attempts as attempts, sent_at from messages where id = $1',
      [messageId],
    )
    return result.rows[0] ?? null
  })
}

async function readParticipantCounts(request: APIRequestContext, token: string, messageId: string): Promise<Record<string, number>> {
  const rows = await withClient(async (client) => {
    const result = await client.query<{ total: string }>(
      'select count(*) as total from message_external_participants where message_id = $1',
      [messageId],
    )
    return Number(result.rows[0]?.total ?? 0)
  })
  const participants = await readMessageParticipants(request, token, messageId)
  expect(participants, 'every participant row is listed once').toHaveLength(rows)
  const perAddress: Record<string, number> = {}
  for (const participant of participants) perAddress[participant.email] = (perAddress[participant.email] ?? 0) + 1
  return perAddress
}

function capturedAddresses(email: CapturedTestSeedEmail): string[] {
  const to = email.metadata?.to
  if (Array.isArray(to)) return to.filter((value): value is string => typeof value === 'string')
  return typeof to === 'string' ? [to] : []
}

async function countCapturesPerAddress(request: APIRequestContext, token: string, subject: string) {
  const captured = (await listCapturedSystemEmails(request, token)).filter((email) => email.metadata?.subject === subject)
  const perAddress: Record<string, number> = {}
  for (const address of captured.flatMap(capturedAddresses)) perAddress[address] = (perAddress[address] ?? 0) + 1
  return { total: captured.length, perAddress }
}

async function waitForSettledParticipants(request: APIRequestContext, token: string, messageId: string, label: string) {
  await drainDeliveryUntil(async () => {
    await drainIntegrationQueue('messages-email')
    const participants = await readMessageParticipants(request, token, messageId)
    return participants.length > 0 && participants.every((participant) => participant.deliveryStatus === 'sent')
  }, label)
  await drainIntegrationQueue('messages-email')
}

function expectRacersFinished(race: ReleaseRace) {
  expect(race.racerExitCodes, `release workers exit cleanly: ${race.racerErrors.join('\n')}`).toEqual(Array(RACERS).fill(0))
}

/**
 * TC-API-MSG-038: concurrent scheduled releases deliver once. Several release worker
 * processes claim the same due message at the same instant on the real database; exactly one
 * claim wins, the message is sent once and every external participant gets one email —
 * on the system transport, after a stale lease is taken over, and through a mailbox.
 */
test.describe('TC-API-MSG-038: concurrent scheduled release', () => {
  useRaisedExternalEmailBudget()

  test('releases a due system-transport message once', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    test.skip(!(await isChannelSeedingAvailable(request, token)), 'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled.')
    test.skip(!(await isSchedulingAvailable(request, token)), 'scheduler module is not enabled')
    await seedSystemEmailChannel(request, token)
    await clearCapturedSystemEmails(request, token)
    const addresses = [QA_RECIPIENTS[0], QA_RECIPIENTS[1]]
    const subject = `QA TC-API-MSG-038 system ${Date.now()}`
    let messageId: string | null = null

    try {
      messageId = await composeMessageWithToken(request, token, {
        visibility: 'public',
        externalEmails: addresses,
        recipients: [],
        subject,
        body: 'Concurrent release body.',
        sendViaEmail: true,
        scheduledAt: scheduledAtInMinutes(30),
      })
      const id = messageId
      const race = await raceScheduledReleases(token, async (client) => {
        await client.query(`update messages set scheduled_at = now() - interval '1 minute' where id = $1 and status = 'scheduled'`, [id])
      })
      expectRacersFinished(race)

      await waitForSettledParticipants(request, token, id, 'the released message to be delivered')
      const row = await readReleaseRow(id)
      expect(row).toMatchObject({ status: 'sent', attempts: 1 })
      expect(row?.sent_at).not.toBeNull()
      expect(await readParticipantCounts(request, token, id)).toEqual(Object.fromEntries(addresses.map((address) => [address, 1])))
      expect(await countCapturesPerAddress(request, token, subject)).toEqual({
        total: 1,
        perAddress: Object.fromEntries(addresses.map((address) => [address, 1])),
      })
    } finally {
      await deleteMessageIfExists(request, token, messageId)
    }
  })

  test('takes over a stale release lease once', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    test.skip(!(await isChannelSeedingAvailable(request, token)), 'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled.')
    test.skip(!(await isSchedulingAvailable(request, token)), 'scheduler module is not enabled')
    await seedSystemEmailChannel(request, token)
    await clearCapturedSystemEmails(request, token)
    const addresses = [QA_RECIPIENTS[0], QA_RECIPIENTS[1]]
    const subject = `QA TC-API-MSG-038 stale lease ${Date.now()}`
    let messageId: string | null = null

    try {
      messageId = await composeMessageWithToken(request, token, {
        visibility: 'public',
        externalEmails: addresses,
        recipients: [],
        subject,
        body: 'Stale lease body.',
        sendViaEmail: true,
        scheduledAt: scheduledAtInMinutes(30),
      })
      const id = messageId
      const race = await raceScheduledReleases(token, async (client) => {
        await client.query(
          `update messages
              set status = 'releasing', scheduled_release_attempts = 1,
                  scheduled_at = now() - interval '1 minute', updated_at = now() - interval '11 minutes'
            where id = $1`,
          [id],
        )
      })
      expectRacersFinished(race)

      await waitForSettledParticipants(request, token, id, 'the taken-over message to be delivered')
      const row = await readReleaseRow(id)
      expect(row).toMatchObject({ status: 'sent', attempts: 2 })
      expect(row?.sent_at).not.toBeNull()
      expect(await readParticipantCounts(request, token, id)).toEqual(Object.fromEntries(addresses.map((address) => [address, 1])))
      expect(await countCapturesPerAddress(request, token, subject)).toEqual({
        total: 1,
        perAddress: Object.fromEntries(addresses.map((address) => [address, 1])),
      })
    } finally {
      await deleteMessageIfExists(request, token, messageId)
    }
  })

  test('hands a due mailbox message to the mailbox once', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    test.skip(!(await isChannelSeedingAvailable(request, token)), 'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled.')
    test.skip(!(await isSchedulingAvailable(request, token)), 'scheduler module is not enabled')
    await clearCapturedSystemEmails(request, token)
    const stamp = Date.now()
    const addresses = [QA_RECIPIENTS[0], QA_RECIPIENTS[1]]
    const subject = `QA TC-API-MSG-038 mailbox ${stamp}`
    let channelId: string | null = null
    let messageId: string | null = null

    try {
      channelId = await seedConnectedChannel(request, token, {
        displayName: `TC-API-MSG-038 ${stamp}`,
        externalIdentifier: `msg-038-${stamp}@example.com`,
      })
      const composeResponse = await apiRequest(request, 'POST', '/api/messages', {
        token,
        data: {
          visibility: 'public',
          externalEmails: addresses,
          sendSeparately: true,
          recipients: [],
          subject,
          body: 'Concurrent mailbox release body.',
          sendViaEmail: true,
          senderChannelId: channelId,
          scheduledAt: scheduledAtInMinutes(30),
        },
      })
      expect(composeResponse.status()).toBe(201)
      const id = (await readJsonSafe<{ id?: string }>(composeResponse))?.id ?? null
      expect(id).toBeTruthy()
      messageId = id
      const race = await raceScheduledReleases(token, async (client) => {
        await client.query(`update messages set scheduled_at = now() - interval '1 minute' where id = $1 and status = 'scheduled'`, [id])
      })
      expectRacersFinished(race)

      await drainDeliveryUntil(async () => {
        const { links } = await inspectMessageChannelLinks(request, token, id as string)
        return links.length === addresses.length && links.every((link) => link.deliveryStatus === 'sent')
      }, 'one delivered mailbox link per recipient')
      await drainIntegrationQueue('communication-channels-outbound')
      const row = await readReleaseRow(id as string)
      expect(row).toMatchObject({ status: 'sent', attempts: 1 })
      expect((await inspectMessageChannelLinks(request, token, id as string)).links).toHaveLength(addresses.length)
      expect(await readParticipantCounts(request, token, id as string)).toEqual(Object.fromEntries(addresses.map((address) => [address, 1])))
      expect(await countCapturesPerAddress(request, token, subject)).toEqual({
        total: addresses.length,
        perAddress: Object.fromEntries(addresses.map((address) => [address, 1])),
      })
    } finally {
      await deleteMessageIfExists(request, token, messageId)
      await deleteChannelIfExists(request, token, channelId)
    }
  })
})
