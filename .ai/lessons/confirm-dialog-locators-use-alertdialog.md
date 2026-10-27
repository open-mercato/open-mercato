---
title: "Use the confirmation dialog's explicit accessibility role"
modules: ["ui","warranty_claims"]
areas: ["backend-ui","integration","testing"]
topics: ["accessibility","ui-components","testing"]
---

# Use the confirmation dialog's explicit accessibility role

**Context**: The #8012 claim-line removal scenarios reached the confirmation but timed out looking for Cancel inside `getByRole('dialog')`. `packages/ui/src/backend/confirm-dialog/ConfirmDialog.tsx` explicitly exposes `role="alertdialog"`, overriding the native `<dialog>` role. CI run `40518943457`, job `122244378342`, identified the blocked Cancel locator; the shared component's existing tests also query `alertdialog`.

**Rule**: Locate confirmations by their rendered accessibility role and accessible name. For the shared `ConfirmDialog`, use `getByRole('alertdialog', { name })`. A unit test that mocks the confirmation hook cannot verify this component boundary, so include a real browser interaction or exercise the actual shared component before treating the flow as verified. Correct the locator before increasing timeouts.

**Applies to**: Playwright and component tests of shared confirmations and native dialogs with explicit ARIA roles.
