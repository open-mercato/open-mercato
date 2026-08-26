import path from 'node:path'
import { config as loadEnv } from 'dotenv'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'

/**
 * The hub emits `communication_channels.message.received` through the `events`
 * queue, where the persistent `customers:link-channel-message-received`
 * subscriber consumes it. Integration specs that assert on the CRM side of an
 * inbound Discord message must drain that queue first.
 *
 * Mirrors the customers module's own inbound-email helper: the Playwright
 * process is the monorepo while the job was created by the app under test, so
 * the drain runs from the app root (`OM_TEST_APP_ROOT` when set).
 */
export const APP_ROOT = process.env.OM_TEST_APP_ROOT?.trim()
  ? path.resolve(process.env.OM_TEST_APP_ROOT as string)
  : path.resolve(process.cwd(), 'apps/mercato')

if (!process.env.OM_TEST_APP_ROOT?.trim()) {
  loadEnv({ path: path.resolve(APP_ROOT, '.env') })
  process.env.QUEUE_BASE_DIR = path.resolve(APP_ROOT, '.mercato/queue')
}

export async function drainEventsQueue(): Promise<void> {
  await drainIntegrationQueue('events', { appRoot: APP_ROOT })
}
