import { test } from '@playwright/test'

/**
 * Phase 1 integration skeleton for the mockup composer
 * (spec 2026-07-05-ds-live-mockup-composer.md, Validation Plan → Phase 1
 * integration paths 1-5). The paths are stubbed with `test.fixme` so the
 * suite documents the contract without asserting yet — they are implemented
 * together with the ephemeral-env fixtures in a follow-up, per
 * `.ai/qa/AGENTS.md`.
 */

const MOCKUPS_PATH = '/backend/design-system/mockups'
const GOLDEN_SLUG = 'customers-people-list'

test.describe('design_system mockups', () => {
  test.fixme(
    'list shows the golden mockup row with per-status counts and user stories (spec path 1)',
    async () => {
      // login as admin → goto MOCKUPS_PATH → row for GOLDEN_SLUG shows
      // counts 5/1/1/1 and stories US-CRM-101/US-CRM-201/US-CRM-102;
      // empty state renders when filtered to nothing.
    },
  )

  test.fixme(
    'renderer shows real components; Annotated adds rails without amber and without layout shift (spec path 2)',
    async () => {
      // goto `${MOCKUPS_PATH}/${GOLDEN_SLUG}` → real components in DOM;
      // Annotated shows status-token rail classes and brand-violet for
      // proposed; no amber classes anywhere; layout boxes identical Clean
      // vs Annotated.
    },
  )

  test.fixme('story filter narrows the ledger and counts match the GET API (spec path 3)', async () => {
    // select a user story → ledger filters (content never dims);
    // ledger counts equal GET /api/design_system/mockups/[slug] counts.
  })

  test.fixme('access control: no view → denied; view without manage → 403 on annotation PUT (spec path 4)', async () => {
    // user without design_system.view sees the standard access-denied UX;
    // user with view but without design_system.mockups.manage gets 403 on
    // PUT /api/design_system/mockups/[slug]/annotations.
  })

  test.fixme('invalid document renders the error surface with zod issues, not a blank page (spec path 5)', async () => {
    // broken fixture slug renders the ErrorMessage + issue list.
  })
})
