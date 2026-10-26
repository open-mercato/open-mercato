/** @jest-environment node */

import { describe, test, expect } from '@jest/globals'
import fs from 'node:fs'
import path from 'node:path'
import eventsConfig from '../events'

/**
 * Spec §8.3: "`workflows.instance.*` lifecycle events gain
 * `clientBroadcast: true`; run views subscribe via the DOM Event Bridge."
 *
 * The flag is a contract with the SSE bridge, and the bridge forwards the
 * emitted payload verbatim to every backoffice connection in the tenant +
 * organization — with no ACL check of its own. So this file pins BOTH halves:
 * which events broadcast, and that the payload they broadcast is instance
 * identity and state, never authored content.
 */

const LIFECYCLE_EVENT_IDS = [
  'workflows.instance.started',
  'workflows.instance.completed',
  'workflows.instance.failed',
  'workflows.instance.cancelled',
  'workflows.instance.paused',
  'workflows.instance.resumed',
] as const

const eventsById = new Map(eventsConfig.events.map((event) => [event.id, event]))

describe('workflows.instance.* client broadcast', () => {
  test.each(LIFECYCLE_EVENT_IDS)('%s is bridged to the browser', (eventId) => {
    expect(eventsById.get(eventId)?.clientBroadcast).toBe(true)
  })

  test('no workflows event is bridged to the customer portal by this change', () => {
    for (const eventId of LIFECYCLE_EVENT_IDS) {
      expect(eventsById.get(eventId)?.portalBroadcast).toBeFalsy()
    }
  })

  /**
   * `workflows.task.assigned` carries the task name and its entity bindings.
   * `events.ts` already documents why that must not reach the portal; the same
   * argument applies to the backoffice bridge, which does not evaluate
   * `workflows.tasks.view` before delivering.
   */
  test('the task events stay off the backoffice bridge', () => {
    expect(eventsById.get('workflows.task.assigned')?.clientBroadcast).toBeFalsy()
    expect(eventsById.get('workflows.task.deadline_breached')?.clientBroadcast).toBeFalsy()
  })

  test('the lifecycle payload carries tenant scope and no run context', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'lib', 'workflow-executor.ts'),
      'utf8'
    )
    const emitBody = source.slice(
      source.indexOf('async function emitInstanceLifecycleEvent'),
      source.indexOf('async function emitInstanceLifecycleEvent') + 1200
    )

    // The bridge refuses to deliver a payload with no tenantId at all.
    expect(emitBody).toContain('tenantId: instance.tenantId')
    expect(emitBody).toContain('organizationId: instance.organizationId')
    // Identity and state only.
    expect(emitBody).not.toContain('instance.context')
    expect(emitBody).not.toContain('instance.metadata')
  })
})
