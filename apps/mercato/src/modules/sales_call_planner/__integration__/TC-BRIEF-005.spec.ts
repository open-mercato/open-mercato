import { expect, test } from '@playwright/test'
import {
  PROBE_UNAVAILABLE_REASON,
  VOICE_AGENT_ID,
  probeConnectorAvailable,
  scopedRequest,
  superadminScope,
  type Scoped,
} from './helpers/briefingFixtures'

/**
 * TC-BRIEF-005: operator gate #2 — the ElevenLabs side is not set up.
 *
 * `sales_call_planner.sales_chief_call` names the call profile
 * `sales_chief_call`, deliberately not `default`: `default` is whichever agent
 * a tenant configured first, so sharing it would read a deal briefing through
 * somebody else's script to a real person. `resolveCallProfile` therefore fails
 * CLOSED, and it does so BEFORE `startOutboundCall` — nothing is dialled, no
 * HTTP request reaches the provider, and the run settles as an error the
 * workflow's `error` handle absorbs.
 *
 * What this spec pins is the OPERATOR-VISIBLE half of that: an unconfigured
 * deployment must produce a durable, named, findable record of why the call did
 * not happen, not a run that vanishes. It asserts the run row in the agents
 * cockpit, which is where an operator actually looks.
 *
 * Scope, stated honestly. This spec asserts the gate from whatever state the
 * deployment is in and writes NOTHING to the tenant's integration credentials —
 * overwriting a developer's real ElevenLabs API key to prove a message would be
 * a worse trade than the coverage is worth. On an unconfigured tenant the
 * message names the missing integration; on a tenant configured without a
 * `sales_chief_call` entry it names the missing profile. Both are accepted here,
 * and the profile-specific arm is pinned unit-side by
 * `packages/agent-elevenlabs/.../__tests__/profiles.test.ts` ("fails closed on
 * an unknown profile"), which is also the only place that can assert `fetch` was
 * never called.
 */

const ACTIONABLE_MESSAGE_PATTERN = /elevenlabs|call profile|profile/i

test.describe('TC-BRIEF-005: an unconfigured voice provider fails closed, with a signal an operator can find', () => {
  test.setTimeout(120_000)

  let scope: Scoped
  let available = false

  test.beforeAll(async ({ request }) => {
    scope = await superadminScope(request)
    available = await probeConnectorAvailable(request, scope.token)
  })

  test('never answers 202, and leaves a failed run naming the ElevenLabs configuration', async ({ request }) => {
    test.skip(!available, PROBE_UNAVAILABLE_REASON)

    const registered = await scopedRequest(
      request,
      'GET',
      `/api/agent_orchestrator/agents/${VOICE_AGENT_ID}`,
      scope,
    )
    test.skip(
      registered.status() !== 200,
      `${VOICE_AGENT_ID} is not registered on this deployment; enable agent_elevenlabs and sales_call_planner.`,
    )
    expect(
      ((await registered.json()) as { runtime?: string }).runtime,
      'the voice agent must be an out-of-band external agent — a native runtime here would mean it never parks',
    ).toBe('external')

    const started = await scopedRequest(request, 'POST', `/api/agent_orchestrator/agents/${VOICE_AGENT_ID}/run`, scope, {
      input: { toNumber: '+48123456789', brief: 'integration gate probe — this must never dial' },
    })

    // 202 is the "the call is in flight" answer. Seeing it here would mean the
    // connector got past credential and profile resolution, which on a
    // deployment without a configured `sales_chief_call` profile it must not.
    expect(
      started.status(),
      'an unconfigured voice provider must never report a call as accepted',
    ).not.toBe(202)
    expect(started.status(), 'and it must not silently succeed either').not.toBe(200)

    const runs = await scopedRequest(
      request,
      'GET',
      '/api/agent_orchestrator/runs?limit=25',
      scope,
    )
    expect(runs.status(), 'GET /api/agent_orchestrator/runs should return 200').toBe(200)
    const items = ((await runs.json()) as {
      items?: Array<{ agent_id?: string; status?: string; error_message?: string | null }>
    }).items ?? []
    const failed = items.find(
      (item) => item.agent_id === VOICE_AGENT_ID && item.status === 'error' && !!item.error_message,
    )

    expect(
      failed,
      'the refused call must leave a durable run row — a WARN log is not something an operator can be pointed at',
    ).toBeTruthy()
    expect(
      failed?.error_message ?? '',
      'and its message must name what is missing, so the fix is "configure ElevenLabs" and not "open a support ticket"',
    ).toMatch(ACTIONABLE_MESSAGE_PATTERN)
  })
})
