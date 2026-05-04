# Test Scenario: CRM Post-Upgrade Fixes Manual QA

## Test ID
TC-CRM-POST-UPGRADE-FIXES-MANUAL

## Category
Customer/CRM Management

## Priority
High

## Type
Manual QA

## Description
Verify the user-reported CRM regressions fixed after the CRM detail page upgrades:

- [#1657](https://github.com/open-mercato/open-mercato/issues/1657) - person page collapse state persistence
- [#1658](https://github.com/open-mercato/open-mercato/issues/1658) - company page collapse state persistence
- [#1659](https://github.com/open-mercato/open-mercato/issues/1659) - deal note appears in deal changelog
- [#1660](https://github.com/open-mercato/open-mercato/issues/1660) - inline activity composer layout
- [#1661](https://github.com/open-mercato/open-mercato/issues/1661) - undo for scheduled interaction complete/cancel
- [#1662](https://github.com/open-mercato/open-mercato/issues/1662) - CRM roles section wording and role type management link
- [#1663](https://github.com/open-mercato/open-mercato/issues/1663) - role rows use human display names instead of raw email fallback
- [#1664](https://github.com/open-mercato/open-mercato/issues/1664) - deal list People/Companies filters use UUIDs and survive URL round-trip
- [#1665](https://github.com/open-mercato/open-mercato/issues/1665) - person/company/deal headers expose send-message and history actions
- CRM28 standalone smoke - example customer sync diagnostics work in standalone mode

## Prerequisites

- The branch under test is checked out and the latest database migrations have been applied.
- `yarn generate` has been run after module or route changes.
- The app is running in a clean browser session at `<BASE_URL>`, for example `http://localhost:3000`.
- Tester is logged in as an admin or superadmin user with these features:
  - `customers.view`
  - `customers.manage`
  - `customers.interactions.manage`
  - `customers.settings.manage`
  - `audit_logs.view`
  - message composition permissions if the messages module is enabled
- Use credentials printed by initialization. In seeded local environments this is often `admin@acme.com / secret` or `superadmin@acme.com / secret`.
- Browser devtools Network tab is available for API/header checks.
- For CRM28 standalone smoke, a generated standalone app is available and started separately.

## Test Data Setup

Use one unique suffix for the full run, for example `20260425-qa01`.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open `<BASE_URL>/backend/customers/companies` and create company `QA CRM Fixes Company <suffix>` | Company is created and can be opened at `/backend/customers/companies-v2/<companyId>` |
| 2 | Open `<BASE_URL>/backend/customers/people` and create person `QA CRM Fixes Person <suffix>` linked to the company from step 1 | Person is created and can be opened at `/backend/customers/people-v2/<personId>` |
| 3 | Open `<BASE_URL>/backend/customers/deals/create` and create deal `QA CRM Fixes Deal <suffix>` linked to the company and person from steps 1 and 2 | Deal is created and can be opened at `/backend/customers/deals/<dealId>` |
| 4 | Create a second company/person/deal set with suffix `<suffix>-other` | There is at least one unrelated deal for negative filter checks |
| 5 | Keep the three detail URLs available in separate notes: person, company, deal | Tester can return to exact records during the scenario |

## Test Case 1 - CRM Header Utility Actions (#1665)

Run this case for all three detail pages:

- `<BASE_URL>/backend/customers/people-v2/<personId>`
- `<BASE_URL>/backend/customers/companies-v2/<companyId>`
- `<BASE_URL>/backend/customers/deals/<dealId>`

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open the detail page | The CRM detail header renders without layout overlap or missing labels |
| 2 | Inspect the header action row | A send-message icon button and a history icon button are visible near the other header actions |
| 3 | Hover or focus each icon button | Accessible labels are available, including `Send message` and `View change history` or localized equivalents |
| 4 | Click the send-message icon | A message composer opens with the current CRM object selected or referenced |
| 5 | Close the message composer without sending | Dialog closes and the detail page remains usable |
| 6 | Click the history icon | Object history/version panel opens for the current object |
| 7 | Confirm the history panel context | Person history is scoped to the person, company history to the company, and deal history to the deal |

Pass criteria:

- All three detail headers expose both utility actions.
- The buttons are keyboard focusable and do not require using the overflow menu.
- History requests include the current object's resource id and do not show another CRM record's history.

## Test Case 2 - Deal-Linked Note Appears In Deal Changelog (#1659)

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open `<BASE_URL>/backend/customers/deals/<dealId>` | Deal detail page is visible |
| 2 | Open the `Notes` tab or note section | Notes UI is visible |
| 3 | Add note text `QA changelog related note <suffix>` and save | Note appears in the deal notes list |
| 4 | Open the `Changelog` tab or click the header history icon | Change history loads successfully |
| 5 | Search visually for `QA changelog related note <suffix>` or the matching note-created action | The note creation is present in the deal changelog/history |
| 6 | Open the unrelated deal from setup and open its changelog | The note from step 3 is not present |
| 7 | Refresh the original deal detail page and reopen changelog/history | The note-created action is still visible |

Pass criteria:

- New deal-linked notes appear under the deal history, not only under a linked person or company.
- Related-resource filtering does not leak the action into unrelated deals.

## Test Case 3 - Undo Scheduled Interaction Complete And Cancel (#1661)

Complete flow:

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open the company or person detail page from setup | Detail page is visible |
| 2 | Create or schedule an activity with title `QA scheduled complete <suffix>` for a future date | Activity appears as planned/scheduled |
| 3 | Open devtools Network tab and keep `Preserve log` enabled | Network requests can be inspected |
| 4 | Complete the scheduled activity from the activity list | Activity changes to completed/done |
| 5 | Inspect the `POST /api/customers/interactions/complete` response | Response has HTTP 200 and an `x-om-operation` response header containing an undo token |
| 6 | Use the global undo banner or undo action | Activity returns to planned/scheduled state |
| 7 | Refresh the page | Activity remains planned/scheduled after reload |

Cancel flow:

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Create or schedule activity `QA scheduled cancel <suffix>` for a future date | Activity appears as planned/scheduled |
| 2 | Cancel the scheduled activity from the activity list | Activity changes to canceled or disappears according to current UI rules |
| 3 | Inspect the `POST /api/customers/interactions/cancel` response | Response has HTTP 200 and an `x-om-operation` response header containing an undo token |
| 4 | Use the global undo banner or undo action | Activity returns to planned/scheduled state |
| 5 | Refresh the page | Activity remains planned/scheduled after reload |

Pass criteria:

- Complete and cancel both expose operation metadata.
- Undo works without a manual API call.
- No `Undo token not available` style failure appears.

## Test Case 4 - Person Collapse Persistence (#1657)

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open `<BASE_URL>/backend/customers/people-v2/<personId>` | Person detail page is visible |
| 2 | Collapse the left details/form zone | The zone collapses immediately |
| 3 | Refresh the browser page | The zone is still collapsed on first visible paint |
| 4 | Watch the first second after refresh | There is no visible expanded-to-collapsed flicker |
| 5 | Expand the zone again and refresh | The zone stays expanded after refresh |
| 6 | Collapse one nested collapsible form group if present, refresh again | The nested group keeps its collapsed state |

Pass criteria:

- The persisted state is applied during initial client render.
- State is stable across full page refreshes, not only client-side tab changes.

## Test Case 5 - Company Collapse Persistence (#1658)

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open `<BASE_URL>/backend/customers/companies-v2/<companyId>` | Company detail page is visible |
| 2 | Collapse the left details/form zone | The zone collapses immediately |
| 3 | Refresh the browser page | The zone is still collapsed on first visible paint |
| 4 | Watch the first second after refresh | There is no visible expanded-to-collapsed flicker |
| 5 | Expand the zone again and refresh | The zone stays expanded after refresh |
| 6 | Collapse one nested collapsible form group if present, refresh again | The nested group keeps its collapsed state |

Pass criteria:

- Company and person pages both use stable persisted collapse keys.
- Company refresh does not reset all collapsible sections to expanded.

## Test Case 6 - CRM Roles Ergonomics And Role Type Link (#1662)

Person page:

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open `<BASE_URL>/backend/customers/people-v2/<personId>` | Person detail page is visible |
| 2 | Open or scroll to the roles section | Section title reads `My roles with QA CRM Fixes Person <suffix>` or localized equivalent |
| 3 | Click the action to add or assign a role | Assign role dialog opens |
| 4 | Inspect the role type step/card | `Manage role types` link is visible for a user with `customers.settings.manage` |
| 5 | Click `Manage role types` | Browser navigates to the customer configuration page, expected path `/backend/config/customers` |
| 6 | Navigate back to the person detail page | Original person page still loads |

Company page:

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open `<BASE_URL>/backend/customers/companies-v2/<companyId>` | Company detail page is visible |
| 2 | Open or scroll to the roles/people roles section | Section title reads `Roles at QA CRM Fixes Company <suffix>` or localized equivalent |
| 3 | Open the assign role dialog | Dialog opens and the role type selector is visible |
| 4 | Inspect the role type step/card | `Manage role types` link is visible for a user with `customers.settings.manage` |

Permission gate check:

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Log in as a user that can manage CRM roles but does not have `customers.settings.manage`, if available | User can still open the CRM detail page |
| 2 | Open the assign role dialog | Dialog opens |
| 3 | Inspect the role type step/card | `Manage role types` link is not visible |

Pass criteria:

- Person and company role sections use distinct, subject-aware wording.
- Role type management is discoverable from assignment flow for permitted users.
- The management link is permission-gated.

## Test Case 7 - Role Rows Use Human Display Names (#1663)

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Ensure there is an assignable staff user whose `auth_users.name` is empty/null and whose email is similar to `admin@acme.com` | User is available in the assignment picker or existing role rows |
| 2 | Open the person or company assign role dialog | Staff user selection is visible |
| 3 | Search/select the email-only user | Primary display label is a derived human name such as `Admin`, not raw `admin@acme.com` |
| 4 | Save a role assignment for that user | Role row is saved |
| 5 | Inspect the saved role row | Primary assignee name remains the derived human name after save and refresh |

Notes:

- If the picker shows email as secondary metadata, that is acceptable only when the primary display name is human-readable.
- Failing behavior is a role row whose main assignee label is the raw email address.

Pass criteria:

- Email local-part fallback is formatted as a display name.
- Saved role rows and API-backed refreshes use the same display name.

## Test Case 8 - Deal List People/Companies Filters (#1664)

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open `<BASE_URL>/backend/customers/deals` | Deals table loads |
| 2 | Search for `QA CRM Fixes Deal <suffix>` | The primary setup deal is visible |
| 3 | Clear search, open the filter UI, and add People filter value `QA CRM Fixes Person <suffix>` | Filter chip displays the person's label, not a raw UUID |
| 4 | Apply the filter | The primary setup deal remains visible |
| 5 | Confirm the unrelated setup deal is not visible if it is not linked to the selected person | Filter narrows results correctly |
| 6 | Add Companies filter value `QA CRM Fixes Company <suffix>` and apply | The primary setup deal remains visible |
| 7 | Inspect the browser URL | URL contains stable filter state with UUID values, for example `personId`, `companyId`, or encoded `filter[...]` params |
| 8 | Refresh the page | Filters, chips, URL state, and filtered results are preserved |
| 9 | Use browser Back and Forward | Filter state and table results follow the navigation history |
| 10 | Replace the People or Companies filter with the unrelated fixture value | The primary deal is hidden and the unrelated deal is shown only if it matches |
| 11 | Clear all filters | URL filter params are removed and both setup deals can appear again |

Pass criteria:

- Filters submit UUIDs to the API and render human labels in chips.
- No rows disappear because label strings were sent where UUIDs were required.
- Refresh/back/forward preserve and restore filter state.

## Test Case 9 - Inline Activity Composer Layout And Week Preview (#1660)

Run on a person detail page and then spot-check on a company or deal detail page.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open `<BASE_URL>/backend/customers/people-v2/<personId>` | Detail page is visible |
| 2 | Locate the inline `Log activity` composer | Composer is visible without opening a modal |
| 3 | Inspect the description input | Description area is at least 3 rows tall and is the dominant editable area |
| 4 | Inspect the date chip/calendar area | Date chip is compact/secondary and does not dominate the card |
| 5 | Enter subject/body `QA inline activity <suffix>` and save/log the activity | Activity is saved and appears in the activity list/timeline |
| 6 | Click `Hide week preview` | Week preview disappears |
| 7 | Refresh the page | Week preview remains hidden |
| 8 | Click `Show week preview` | Week preview reappears |
| 9 | Refresh the page again | Week preview remains visible |
| 10 | Open the company or deal detail page | Composer behavior is consistent for that entity kind |

Pass criteria:

- The description field is usable for multi-line text.
- The mini week preview can be hidden and shown.
- The week preview preference persists across refreshes.

## Test Case 10 - CRM28 Standalone Smoke

This verifies the standalone-specific stabilization around the legacy example customer sync test. Run it only when a generated standalone app is available.

Standalone app setup:

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Start the generated standalone app and note its URL as `<STANDALONE_BASE_URL>` | Standalone app reaches the backend login page |
| 2 | Log in as superadmin | Backend shell loads |
| 3 | Confirm the example and example customer sync modules are enabled in the standalone app configuration | Example customer sync routes are registered |

API smoke through browser session:

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | In the authenticated browser, open `<STANDALONE_BASE_URL>/api/example-customers-sync/mappings?limit=5` | Response status is 200 and JSON contains an `items` array |
| 2 | Open devtools Console or an API client using the authenticated session | Tester can send an authenticated POST |
| 3 | POST to `<STANDALONE_BASE_URL>/api/example-customers-sync/reconcile` with body `{"limit":5}` or with explicit `tenantId` and `organizationId` from the current admin context if required | Response status is 202 |
| 4 | Inspect response body | Body contains `queued: 1` or an equivalent one-job queued result |
| 5 | Review server logs | No standalone-only module discovery, generated import, or missing route error appears |

Optional executable confirmation:

```bash
OM_TEST_APP_ROOT=/absolute/path/to/standalone-app \
BASE_URL=<STANDALONE_BASE_URL> \
npx playwright test packages/core/src/modules/customers/__integration__/TC-CRM-028.spec.ts --grep "standalone smoke"
```

Pass criteria:

- Standalone uses the smoke portion of CRM28 instead of running the monorepo-only queue/bootstrap assertions.
- Diagnostics endpoints work from a standalone app.
- Reconcile can enqueue a job without failing because of standalone module discovery or generated artifacts.

## Regression Sanity Checks

| Area | Action | Expected Result |
|------|--------|-----------------|
| Existing CRM create/edit | Create and update a person, company, and deal unrelated to the setup records | CRUD still works and save buttons are not blocked by new header actions |
| Existing notes and activities | Add a normal note and a normal past activity to a company | Existing activity/note creation still works |
| Audit log pagination | Open changelog/history on person, company, and deal | History loads without errors and pagination controls remain usable |
| Access control | Repeat one header/history action as a lower-permission user if available | User sees only actions allowed by permissions; no unauthorized data is exposed |
| Mobile width | Resize browser to a mobile viewport and open person/company/deal detail headers | Header utility actions do not overlap key title/status content |

## Cleanup

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Delete or archive the deals created during setup | Setup deals no longer appear in deal list |
| 2 | Delete or archive the people created during setup | Setup people no longer appear in people list |
| 3 | Delete or archive the companies created during setup | Setup companies no longer appear in company list |
| 4 | Reset browser localStorage keys only if the next tester needs a clean collapse/week-preview state | Subsequent runs start from default UI state |

## Manual Result Template

Copy this table into the PR or QA comment after execution.

| Check | Result | Notes |
|-------|--------|-------|
| #1665 header utility actions | Pass/Fail | |
| #1659 deal note changelog | Pass/Fail | |
| #1661 scheduled activity undo | Pass/Fail | |
| #1657 person collapse persistence | Pass/Fail | |
| #1658 company collapse persistence | Pass/Fail | |
| #1662 role wording and role type link | Pass/Fail | |
| #1663 user display name fallback | Pass/Fail | |
| #1664 deal filters | Pass/Fail | |
| #1660 inline activity composer | Pass/Fail | |
| CRM28 standalone smoke | Pass/Fail/Not run | |
