import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { DEAL_BRIEFING_WORKFLOW_ID, briefingUrl, superadminScope, type Scoped } from './helpers/briefingFixtures'
import widget from '../widgets/injection/deal-brief-trigger/widget'

/**
 * TC-BRIEF-006: who may press the button, and what actually enforces it.
 *
 * There are TWO gates and they are not the same gate, which is worth pinning
 * because it is easy to assume otherwise:
 *
 *  - `sales_call_planner.brief.run` gates the WIDGET. It is an intent gate: it
 *    decides whether the button is rendered on the company page at all. No API
 *    route reads it.
 *  - `workflows.instances.create` gates the ROUTE. `POST /api/workflows/instances`
 *    checks it inside the handler (the route-level metadata only requires
 *    `workflows.instances.view`), so it is the feature that actually refuses a
 *    briefing.
 *
 * That is why the ACL feature declares `dependsOn: ['workflows.instances.create']`:
 * a role holding `brief.run` alone would see a button that can only ever 403,
 * and the role editor's dependency diagnostics are what surface that.
 *
 * This spec asserts both halves — the widget's declared feature (so a future
 * edit cannot quietly drop the gate) and the route's real refusal.
 */

test.describe('TC-BRIEF-006: the briefing is gated at the widget and, separately, at the route', () => {
  test.setTimeout(60_000)

  let scope: Scoped

  test.beforeAll(async ({ request }) => {
    scope = await superadminScope(request)
  })

  test('the header widget is declared behind sales_call_planner.brief.run', () => {
    expect(
      widget.metadata.features,
      'dropping this leaves a "call a person by telephone" button on every company page',
    ).toEqual(['sales_call_planner.brief.run'])
    expect(
      widget.metadata.requiredModules,
      'a superadmin wildcard passes the feature gate even where the agents are not deployed; the module list is what stops that',
    ).toEqual(['agent_orchestrator', 'agent_elevenlabs'])
  })

  test('an anonymous caller cannot start a briefing', async ({ request }) => {
    const res = await request.fetch(briefingUrl('/api/workflows/instances'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ workflowId: DEAL_BRIEFING_WORKFLOW_ID, version: 1, initialContext: {} }),
    })
    expect(res.status(), 'starting a workflow is never anonymous').toBe(401)
  })

  test('a signed-in user without workflows.instances.create is refused', async ({ request }) => {
    // `employee` is the sales-facing persona: it is granted
    // `sales_call_planner.brief.run` by this module's setup, and it is NOT
    // granted `workflows.instances.create` by any persona list in the repo. So
    // it is exactly the role that proves the two gates are independent.
    const employeeToken = await getAuthToken(request, 'employee')
    const res = await request.fetch(briefingUrl('/api/workflows/instances'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${employeeToken}`, 'Content-Type': 'application/json' },
      data: JSON.stringify({
        workflowId: DEAL_BRIEFING_WORKFLOW_ID,
        version: 1,
        initialContext: { companyId: '00000000-0000-0000-0000-000000000000' },
      }),
    })
    expect(
      res.status(),
      'the route refuses before it looks at the workflow, so a missing grant can never start a run',
    ).toBe(403)
  })

  test('the superadmin scope this suite runs under does hold the grant', async ({ request }) => {
    const res = await request.fetch(briefingUrl('/api/workflows/instances?limit=1'), {
      method: 'GET',
      headers: { Authorization: `Bearer ${scope.token}` },
    })
    expect(res.status(), 'otherwise every other spec in this folder would be proving a 403').toBe(200)
  })
})
