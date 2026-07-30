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

  // Phase 2 paths (6-9) — same convention: documented fixme stubs pending the
  // ephemeral-env fixtures, per `.ai/qa/AGENTS.md`.

  test.fixme('studio round-trip: edit, save, and 409 on a concurrent out-of-band edit (spec path 6)', async () => {
    // enter Edit mode (dev + manage) → swap a block variant, edit a prop via
    // the generated form, reorder, Save → file on disk reflects the change;
    // out-of-band JSON edit + second Save → 409 conflict alert with Reload.
  })

  test.fixme('share link: public page logged-out, watermark on, expired token → 404 (spec path 7)', async () => {
    // POST share mint → open the URL in a logged-out context → stage renders,
    // watermark ribbon present, overlay toggles, no authenticated chrome in
    // DOM; expired/tampered token → uniform not-found page.
  })

  test.fixme('diff view: @v1 vs @v2 side by side with rail tones and ledger delta (spec path 8)', async () => {
    // `${MOCKUPS_PATH}/${GOLDEN_SLUG}?compare=v1..v2` → two stages; added →
    // status-success rail, removed → status-error rail + ghost ledger entry,
    // changed → status-info, moved-only → status-neutral; counts match
    // GET .../diff?from=v1&to=v2.
  })

  test.fixme('findings layer: severity rails + ledger entries, stale dimmed in the ledger only (spec path 9)', async () => {
    // golden mockup shows severity segments in the margin gutter and finding
    // ledger entries with no markup on block content; the stale finding is
    // dimmed + labeled in the ledger while its block renders untouched.
  })

  // Phase 3 paths (10-11) — same convention: documented fixme stubs pending
  // the ephemeral-env fixtures, per `.ai/qa/AGENTS.md`.

  test.fixme('draft state: chip in the list and ledger header, nothing on content, share mint 422 (spec path 10)', async () => {
    // the customers-quick-add draft fixture shows the muted Draft chip in the
    // list row and the ledger header (per the composer visual language: chip
    // in the review margin, never a banner or watermark over the stage);
    // POST .../share for the draft slug returns 422.
  })

  test.fixme('promote smoke: derived scaffold command runs and the module passes lint:ds (spec path 11)', async () => {
    // monorepo CI job mirroring the scaffold spec's throwaway-module job:
    // yarn ds:mockups:promote suppliers-directory --execute on a branch where
    // `mercato module scaffold` exists → generated module passes lint:ds.
    // Blocked until the module-scaffold PR lands (runtime availability check
    // prints the command with a note on branches without the subcommand).
  })
})
