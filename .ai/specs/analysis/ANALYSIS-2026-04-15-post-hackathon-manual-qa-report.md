# Post-Hackathon Human QA Report

Report window: **April 10, 2026 through April 15, 2026**.

## Executive Summary

- Reviewed **188 merged pull requests** in the requested window.
- Base branches covered: **187 PRs into `develop`** and **1 PR into `main`**.
- The QA sections below intentionally group related PRs into practical testing routes. Use them for manual verification order; use the appendix for exhaustive PR-by-PR traceability.
- Not every merged PR needs direct human QA. Docs, tests, tooling, and environment fixes are still logged in the appendix but are summarized as broad-smoke work only.

## Recommended QA Order

| Priority | Area | Suggested focus |
|---|---|---|
| P0 | Auth, Access Control, Sessions, And Organization Scope | Staff authentication, admin access rules, organization scoping, and portal/session hardening changed repeatedly across the merge window. This is the riskiest place for invisible regressions because many fixes only show up under stale sessions, redirects, role changes, or wrong-tenant access. |
| P0 | Sales, Checkout, Quotes, Orders, Payments, And Shipments | Sales flows saw both feature work and race-condition hardening. Manual QA should validate not only the happy path but also repeated submits, refreshes, and concurrent clicks in quote acceptance, shipment creation, return handling, and payment-related actions. |
| P0 | Workflows, Webhooks, Events, Notifications, Scheduler, And Queueing | This area absorbed reliability, security, and observability fixes across long-running and event-driven behavior. Human QA should focus on whether failures are visible, replay protection works, and async UI updates still arrive exactly once. |
| P1 | Customers, Customer Accounts, Custom Fields, And Business Rules | CRM and customer-account behavior changed in ways that are easy to miss unless QA opens real records: relation fields, deal/customer unlinking, customer-account session behavior, and rules/forms now have different validation and metadata boundaries. |
| P1 | Catalog, Attachments, Shared Backend UI, And Visual Regressions | This bucket is mostly admin UX and content handling: sticky table actions, timestamp rendering, product/media presentation, attachment parsing and preview safety, and icon bundle changes. QA should use real wide tables and real uploaded files. |
| P2 | Low-Priority Manual QA And Broad Smoke Only | A large part of the window was tooling, docs, tests, and process automation. Those PRs are still inventoried in the appendix, but they do not justify a dedicated admin-panel regression pass unless you are specifically validating startup, local environment setup, or AI tooling. |

## QA Areas

### P0 — Auth, Access Control, Sessions, And Organization Scope

Staff authentication, admin access rules, organization scoping, and portal/session hardening changed repeatedly across the merge window. This is the riskiest place for invisible regressions because many fixes only show up under stale sessions, redirects, role changes, or wrong-tenant access.

**Representative PRs in this area:** [#1070](https://github.com/open-mercato/open-mercato/pull/1070), [#1147](https://github.com/open-mercato/open-mercato/pull/1147), [#1195](https://github.com/open-mercato/open-mercato/pull/1195), [#1223](https://github.com/open-mercato/open-mercato/pull/1223), [#1242](https://github.com/open-mercato/open-mercato/pull/1242), [#1257](https://github.com/open-mercato/open-mercato/pull/1257), [#1264](https://github.com/open-mercato/open-mercato/pull/1264), [#1266](https://github.com/open-mercato/open-mercato/pull/1266), [#1292](https://github.com/open-mercato/open-mercato/pull/1292), [#1293](https://github.com/open-mercato/open-mercato/pull/1293), [#1316](https://github.com/open-mercato/open-mercato/pull/1316), [#1443](https://github.com/open-mercato/open-mercato/pull/1443), [#1453](https://github.com/open-mercato/open-mercato/pull/1453), [#1461](https://github.com/open-mercato/open-mercato/pull/1461), [#1470](https://github.com/open-mercato/open-mercato/pull/1470), [#1476](https://github.com/open-mercato/open-mercato/pull/1476), [#1490](https://github.com/open-mercato/open-mercato/pull/1490), [#1497](https://github.com/open-mercato/open-mercato/pull/1497), [#1500](https://github.com/open-mercato/open-mercato/pull/1500), [#1501](https://github.com/open-mercato/open-mercato/pull/1501), [#1502](https://github.com/open-mercato/open-mercato/pull/1502), [#1505](https://github.com/open-mercato/open-mercato/pull/1505)

**Linked issue refs surfaced in these PRs:** [#687](https://github.com/open-mercato/open-mercato/issues/687), [#959](https://github.com/open-mercato/open-mercato/issues/959), [#967](https://github.com/open-mercato/open-mercato/issues/967), [#1035](https://github.com/open-mercato/open-mercato/issues/1035), [#1112](https://github.com/open-mercato/open-mercato/issues/1112), [#1261](https://github.com/open-mercato/open-mercato/issues/1261), [#1286](https://github.com/open-mercato/open-mercato/issues/1286), [#1299](https://github.com/open-mercato/open-mercato/issues/1299), [#1368](https://github.com/open-mercato/open-mercato/issues/1368), [#1414](https://github.com/open-mercato/open-mercato/issues/1414), [#1420](https://github.com/open-mercato/open-mercato/issues/1420), [#1423](https://github.com/open-mercato/open-mercato/issues/1423), [#1426](https://github.com/open-mercato/open-mercato/issues/1426), [#1427](https://github.com/open-mercato/open-mercato/issues/1427), [#1428](https://github.com/open-mercato/open-mercato/issues/1428), [#1486](https://github.com/open-mercato/open-mercato/issues/1486)

**Where QA should click**
- `/login`
- `/backend/users`
- `/backend/roles`
- `/backend/settings`
- Any backend page with the organization switcher, for example `/backend/users`

**What human QA should verify**
- Log in with and without a safe `redirect` query string. Confirm same-origin redirects work and unsafe external redirects fall back safely.
- From `Users`, create or re-invite a user. Confirm the flow is email-invite based, role assignment still works, and post-login routing lands on the intended backend page.
- Switch between a specific organization and All Organizations, then open users, roles, and one CRM page to confirm visibility and access remain consistent.
- Reset credentials where applicable and confirm stale staff or portal sessions stop working while a fresh login still succeeds.
- Open at least one feature-gated page with an expired, deleted, or under-scoped user to confirm the app denies access rather than partially rendering content.

**What can go wrong**
- Redirect loops, open redirects, or logins always landing on `/backend` regardless of the requested safe page.
- Stale sessions surviving resets or deleted users keeping access.
- Organization switcher state showing the wrong data scope or wildcard ACLs not applying consistently.
- Pages rendering successfully when route metadata is missing and should now fail closed.

### P0 — Sales, Checkout, Quotes, Orders, Payments, And Shipments

Sales flows saw both feature work and race-condition hardening. Manual QA should validate not only the happy path but also repeated submits, refreshes, and concurrent clicks in quote acceptance, shipment creation, return handling, and payment-related actions.

**Representative PRs in this area:** [#1153](https://github.com/open-mercato/open-mercato/pull/1153), [#1183](https://github.com/open-mercato/open-mercato/pull/1183), [#1184](https://github.com/open-mercato/open-mercato/pull/1184), [#1216](https://github.com/open-mercato/open-mercato/pull/1216), [#1221](https://github.com/open-mercato/open-mercato/pull/1221), [#1236](https://github.com/open-mercato/open-mercato/pull/1236), [#1245](https://github.com/open-mercato/open-mercato/pull/1245), [#1247](https://github.com/open-mercato/open-mercato/pull/1247), [#1249](https://github.com/open-mercato/open-mercato/pull/1249), [#1304](https://github.com/open-mercato/open-mercato/pull/1304), [#1373](https://github.com/open-mercato/open-mercato/pull/1373), [#1377](https://github.com/open-mercato/open-mercato/pull/1377), [#1392](https://github.com/open-mercato/open-mercato/pull/1392), [#1452](https://github.com/open-mercato/open-mercato/pull/1452), [#1460](https://github.com/open-mercato/open-mercato/pull/1460), [#1468](https://github.com/open-mercato/open-mercato/pull/1468), [#1486](https://github.com/open-mercato/open-mercato/pull/1486), [#1504](https://github.com/open-mercato/open-mercato/pull/1504)

**Linked issue refs surfaced in these PRs:** [#777](https://github.com/open-mercato/open-mercato/issues/777), [#894](https://github.com/open-mercato/open-mercato/issues/894), [#919](https://github.com/open-mercato/open-mercato/issues/919), [#922](https://github.com/open-mercato/open-mercato/issues/922), [#1018](https://github.com/open-mercato/open-mercato/issues/1018), [#1183](https://github.com/open-mercato/open-mercato/issues/1183), [#1277](https://github.com/open-mercato/open-mercato/issues/1277), [#1319](https://github.com/open-mercato/open-mercato/issues/1319), [#1339](https://github.com/open-mercato/open-mercato/issues/1339), [#1350](https://github.com/open-mercato/open-mercato/issues/1350), [#1412](https://github.com/open-mercato/open-mercato/issues/1412), [#1415](https://github.com/open-mercato/open-mercato/issues/1415), [#1465](https://github.com/open-mercato/open-mercato/issues/1465), [#1483](https://github.com/open-mercato/open-mercato/issues/1483)

**Where QA should click**
- `/backend/sales/quotes`
- `/backend/sales/orders`
- `/backend/sales/documents`
- `/backend/sales/documents/create`
- `/backend/sales/channels`
- One public quote-acceptance URL generated from a real quote

**What human QA should verify**
- Create or edit a sales document and confirm line-item product search works, the default UoM is preserved, and filters display readable labels instead of raw identifiers.
- Generate a quote and use its public acceptance link. Repeat the action quickly or refresh mid-flow and confirm only one acceptance/order conversion happens.
- From a document detail page, create payment, shipment, and return actions and confirm duplicate side effects are blocked rather than creating extra records.
- Validate shipment/contact forms by entering invalid email and phone values and confirming validation rejects them cleanly.
- If invoice and credit memo flows are enabled, create one of each and confirm SKU/name/reason data persists and renders correctly.

**What can go wrong**
- Duplicate payments, shipments, return credits, or downstream orders from repeated actions.
- Public quote flows leaking data across tenants or accepting invalid tokens.
- Sales tables and filters falling back to UUIDs or losing product-search/default-UoM behavior.
- State transitions appearing complete before side effects finish.

### P0 — Workflows, Webhooks, Events, Notifications, Scheduler, And Queueing

This area absorbed reliability, security, and observability fixes across long-running and event-driven behavior. Human QA should focus on whether failures are visible, replay protection works, and async UI updates still arrive exactly once.

**Representative PRs in this area:** [#1126](https://github.com/open-mercato/open-mercato/pull/1126), [#1211](https://github.com/open-mercato/open-mercato/pull/1211), [#1241](https://github.com/open-mercato/open-mercato/pull/1241), [#1248](https://github.com/open-mercato/open-mercato/pull/1248), [#1270](https://github.com/open-mercato/open-mercato/pull/1270), [#1275](https://github.com/open-mercato/open-mercato/pull/1275), [#1360](https://github.com/open-mercato/open-mercato/pull/1360), [#1369](https://github.com/open-mercato/open-mercato/pull/1369), [#1370](https://github.com/open-mercato/open-mercato/pull/1370), [#1371](https://github.com/open-mercato/open-mercato/pull/1371), [#1386](https://github.com/open-mercato/open-mercato/pull/1386), [#1391](https://github.com/open-mercato/open-mercato/pull/1391), [#1394](https://github.com/open-mercato/open-mercato/pull/1394), [#1445](https://github.com/open-mercato/open-mercato/pull/1445), [#1466](https://github.com/open-mercato/open-mercato/pull/1466), [#1484](https://github.com/open-mercato/open-mercato/pull/1484), [#1503](https://github.com/open-mercato/open-mercato/pull/1503), [#1508](https://github.com/open-mercato/open-mercato/pull/1508), [#1520](https://github.com/open-mercato/open-mercato/pull/1520), [#1524](https://github.com/open-mercato/open-mercato/pull/1524)

**Linked issue refs surfaced in these PRs:** [#815](https://github.com/open-mercato/open-mercato/issues/815), [#1154](https://github.com/open-mercato/open-mercato/issues/1154), [#1317](https://github.com/open-mercato/open-mercato/issues/1317), [#1405](https://github.com/open-mercato/open-mercato/issues/1405), [#1416](https://github.com/open-mercato/open-mercato/issues/1416), [#1446](https://github.com/open-mercato/open-mercato/issues/1446), [#1510](https://github.com/open-mercato/open-mercato/issues/1510)

**Where QA should click**
- `/backend/definitions`
- `/backend/definitions/visual-editor`
- `/backend/instances`
- `/backend/events`
- `/backend/tasks`
- `/backend/webhooks`
- `/backend/config/scheduled-jobs`

**What human QA should verify**
- Edit a workflow in both form mode and visual editor, delete a node or edge, save, and confirm the UI does not get stuck behind nested dialog behavior.
- Run or resume a workflow instance and confirm failures are visible in the list/detail views and failed activities halt the workflow by default.
- Trigger webhook delivery and replay scenarios. Confirm replay duplicates are deduped, view-details works, and unsafe internal/private URLs are rejected.
- Visit scheduled jobs and verify both system-scoped and tenant-scoped jobs are visible where expected.
- Mark notifications as read or trigger an event-driven flow and confirm browser updates arrive once without stale SSE listeners or missing refreshes.

**What can go wrong**
- Workflow failures staying hidden or continuing after they should stop.
- Webhook delivery replaying duplicates, leaking cross-org data, or allowing SSRF/internal URL targets.
- Queue retries/backoff making work appear hung or invisible.
- Notifications or SSE-driven browser updates firing twice or not at all.

### P1 — Customers, Customer Accounts, Custom Fields, And Business Rules

CRM and customer-account behavior changed in ways that are easy to miss unless QA opens real records: relation fields, deal/customer unlinking, customer-account session behavior, and rules/forms now have different validation and metadata boundaries.

**Representative PRs in this area:** [#1212](https://github.com/open-mercato/open-mercato/pull/1212), [#1227](https://github.com/open-mercato/open-mercato/pull/1227), [#1244](https://github.com/open-mercato/open-mercato/pull/1244), [#1252](https://github.com/open-mercato/open-mercato/pull/1252), [#1262](https://github.com/open-mercato/open-mercato/pull/1262), [#1288](https://github.com/open-mercato/open-mercato/pull/1288), [#1327](https://github.com/open-mercato/open-mercato/pull/1327), [#1375](https://github.com/open-mercato/open-mercato/pull/1375), [#1455](https://github.com/open-mercato/open-mercato/pull/1455), [#1457](https://github.com/open-mercato/open-mercato/pull/1457), [#1473](https://github.com/open-mercato/open-mercato/pull/1473)

**Linked issue refs surfaced in these PRs:** [#109](https://github.com/open-mercato/open-mercato/issues/109), [#696](https://github.com/open-mercato/open-mercato/issues/696), [#794](https://github.com/open-mercato/open-mercato/issues/794), [#824](https://github.com/open-mercato/open-mercato/issues/824), [#1033](https://github.com/open-mercato/open-mercato/issues/1033), [#1152](https://github.com/open-mercato/open-mercato/issues/1152), [#1228](https://github.com/open-mercato/open-mercato/issues/1228), [#1372](https://github.com/open-mercato/open-mercato/issues/1372)

**Where QA should click**
- `/backend/customers/people`
- `/backend/customers/companies`
- `/backend/customers/deals`
- `/backend/customer_accounts/users`
- `/backend/customer_accounts/roles`
- `/backend/rules`
- `/backend/sets`
- `/backend/logs`

**What human QA should verify**
- Open people, companies, and deals pages and confirm relation-based columns, filters, and custom fields render readable titles rather than raw UUIDs.
- From a customer or company detail page, deassign a linked deal and confirm the relationship is removed without deleting the deal itself.
- Create or edit a rule with an empty condition expression and with date-like values; confirm it saves and the logs page remains accessible.
- Perform a customer-account admin action such as password reset or role update and confirm tenant isolation and session behavior stay correct.
- Attempt an invalid timeline/comment-style action and confirm validation fails safely instead of mutating the wrong record.

**What can go wrong**
- Deal unlinking deleting records instead of only removing the relationship.
- Customer or deal detail APIs leaking data despite RBAC or tenant guards.
- Rules still rejecting optional expressions/date strings even though forms were relaxed.
- Customer-account session state surviving admin intervention unexpectedly.

### P1 — Catalog, Attachments, Shared Backend UI, And Visual Regressions

This bucket is mostly admin UX and content handling: sticky table actions, timestamp rendering, product/media presentation, attachment parsing and preview safety, and icon bundle changes. QA should use real wide tables and real uploaded files.

**Representative PRs in this area:** [#1178](https://github.com/open-mercato/open-mercato/pull/1178), [#1186](https://github.com/open-mercato/open-mercato/pull/1186), [#1233](https://github.com/open-mercato/open-mercato/pull/1233), [#1250](https://github.com/open-mercato/open-mercato/pull/1250), [#1294](https://github.com/open-mercato/open-mercato/pull/1294), [#1297](https://github.com/open-mercato/open-mercato/pull/1297), [#1312](https://github.com/open-mercato/open-mercato/pull/1312), [#1315](https://github.com/open-mercato/open-mercato/pull/1315), [#1346](https://github.com/open-mercato/open-mercato/pull/1346), [#1454](https://github.com/open-mercato/open-mercato/pull/1454), [#1463](https://github.com/open-mercato/open-mercato/pull/1463), [#1481](https://github.com/open-mercato/open-mercato/pull/1481), [#1516](https://github.com/open-mercato/open-mercato/pull/1516)

**Linked issue refs surfaced in these PRs:** [#892](https://github.com/open-mercato/open-mercato/issues/892), [#902](https://github.com/open-mercato/open-mercato/issues/902), [#946](https://github.com/open-mercato/open-mercato/issues/946), [#979](https://github.com/open-mercato/open-mercato/issues/979), [#1113](https://github.com/open-mercato/open-mercato/issues/1113), [#1176](https://github.com/open-mercato/open-mercato/issues/1176), [#1229](https://github.com/open-mercato/open-mercato/issues/1229), [#1240](https://github.com/open-mercato/open-mercato/issues/1240), [#1493](https://github.com/open-mercato/open-mercato/issues/1493)

**Where QA should click**
- `/backend/catalog/products`
- `/backend/catalog/products/create`
- `/backend/catalog/products/<productId>`
- `/backend/catalog/products/<productId>/variants/<variantId>`
- Any wide backend list such as `/backend/customers/companies` or `/backend/data-sync`
- Any edit form that uses attachments or image preview

**What human QA should verify**
- Open at least one wide backend list on desktop and confirm action columns stay visible without horizontal-scroll regressions.
- Check timestamps/tooltips in table views and confirm formatting is consistent and readable.
- Open products and variant detail pages, confirm media fallback works, and verify long variant content no longer overflows the table/layout.
- Upload or preview one PDF and one image attachment and confirm extracted text is sane, previews render, and unsafe content is not executed.
- Smoke-test icon-heavy backend pages after the treeshaking change to confirm icons still render in production builds.

**What can go wrong**
- Action columns disappearing off-screen or timestamps changing unexpectedly.
- Variant or media UI overflow, missing fallback media, or broken product presentation.
- Attachment previews becoming blank, unsafe, or still depending on removed shell-out behavior.
- Missing icons after production bundling changes.

### P2 — Low-Priority Manual QA And Broad Smoke Only

A large part of the window was tooling, docs, tests, and process automation. Those PRs are still inventoried in the appendix, but they do not justify a dedicated admin-panel regression pass unless you are specifically validating startup, local environment setup, or AI tooling.

**Representative PRs in this area:** [#1180](https://github.com/open-mercato/open-mercato/pull/1180), [#1181](https://github.com/open-mercato/open-mercato/pull/1181), [#1218](https://github.com/open-mercato/open-mercato/pull/1218), [#1219](https://github.com/open-mercato/open-mercato/pull/1219), [#1322](https://github.com/open-mercato/open-mercato/pull/1322), [#1374](https://github.com/open-mercato/open-mercato/pull/1374), [#1438](https://github.com/open-mercato/open-mercato/pull/1438), [#1475](https://github.com/open-mercato/open-mercato/pull/1475), [#1496](https://github.com/open-mercato/open-mercato/pull/1496), [#1514](https://github.com/open-mercato/open-mercato/pull/1514), [#1517](https://github.com/open-mercato/open-mercato/pull/1517), [#1522](https://github.com/open-mercato/open-mercato/pull/1522)

**Linked issue refs surfaced in these PRs:** [#1099](https://github.com/open-mercato/open-mercato/issues/1099), [#1430](https://github.com/open-mercato/open-mercato/issues/1430), [#1498](https://github.com/open-mercato/open-mercato/issues/1498)

**Where QA should click**
- Optional only: open `/backend` after a fresh app start to confirm the shell still boots cleanly.

**What human QA should verify**
- No dedicated per-feature admin QA is required for most items in this bucket.
- If time permits, do one broad smoke test from a fresh boot and confirm the app reaches `/backend` cleanly.
- If your post-hackathon review includes AI tooling, optionally verify provider configuration or assistant screens still load where relevant.

**What can go wrong**
- Unexpected startup or environment regressions that only appear from a clean checkout or new machine.
- Process/documentation drift rather than direct end-user breakage.

## Appendix: Full Merged PR Inventory

Each item below is one merged PR from the requested window with direct GitHub links for the PR and any linked or mentioned issue refs. This is the completeness backstop for the report.

### 2026-04-10

- [#1070](https://github.com/open-mercato/open-mercato/pull/1070)  feat(auth): invite users via email instead of admin-set passwords; Issue refs: [#1035](https://github.com/open-mercato/open-mercato/issues/1035)
- [#1178](https://github.com/open-mercato/open-mercato/pull/1178) fix(ui): "Blocked" checkbox incorrectly placed inside Attachments section #1113; Issue refs: [#1113](https://github.com/open-mercato/open-mercato/issues/1113)

### 2026-04-11

- [#1147](https://github.com/open-mercato/open-mercato/pull/1147) fix(directory): honor All Organizations for ACL __all__ non-superAdmins; Issue refs: [#1112](https://github.com/open-mercato/open-mercato/issues/1112)
- [#1153](https://github.com/open-mercato/open-mercato/pull/1153) fix(checkout): resolve ESM import errors and Docker dev env; Issue refs: None
- [#1180](https://github.com/open-mercato/open-mercato/pull/1180) fix(cli): fix db:generate metadata leak and migration filename collision; Issue refs: None
- [#1181](https://github.com/open-mercato/open-mercato/pull/1181) feat(cli): add seed:defaults command for existing databases (#1099); Issue refs: [#1099](https://github.com/open-mercato/open-mercato/issues/1099)
- [#1183](https://github.com/open-mercato/open-mercato/pull/1183) feat(sales): add name, sku to invoice/credit memo lines and reason to credit memos; Issue refs: None
- [#1186](https://github.com/open-mercato/open-mercato/pull/1186) fix #902: keep product list actions column visible without horizontal scroll; Issue refs: [#902](https://github.com/open-mercato/open-mercato/issues/902)
- [#1187](https://github.com/open-mercato/open-mercato/pull/1187) fix(docs): correct outdated statements in README files; Issue refs: None
- [#1189](https://github.com/open-mercato/open-mercato/pull/1189) README getting-started grammar: 'a quickest way'; Issue refs: None
- [#1195](https://github.com/open-mercato/open-mercato/pull/1195) Fix organization tenant selection and switcher refresh for issue #959; Issue refs: [#959](https://github.com/open-mercato/open-mercato/issues/959)
- [#1196](https://github.com/open-mercato/open-mercato/pull/1196) docs: add missing sidebar entry for user-guide/checkout; Issue refs: None
- [#1197](https://github.com/open-mercato/open-mercato/pull/1197) tests: re-enable skipped test "should export generateApiClient"; Issue refs: None
- [#1198](https://github.com/open-mercato/open-mercato/pull/1198) tests: add low-level coverage for jwt.ts; Issue refs: None
- [#1199](https://github.com/open-mercato/open-mercato/pull/1199) tests: add low-level coverage for appResolver.ts; Issue refs: None
- [#1200](https://github.com/open-mercato/open-mercato/pull/1200) tests: add low-level coverage for boolean.ts; Issue refs: None
- [#1203](https://github.com/open-mercato/open-mercato/pull/1203) fix(dev): splash stuck on "preparing" when warmup login returns 401; Issue refs: None
- [#1204](https://github.com/open-mercato/open-mercato/pull/1204) Block enterprise tests when OM_ENABLE_ENTERPRISE_MODULES is false; Issue refs: None
- [#1205](https://github.com/open-mercato/open-mercato/pull/1205) tests: add low-level coverage for crud.ts; Issue refs: None
- [#1206](https://github.com/open-mercato/open-mercato/pull/1206) tests: add low-level coverage for passwordPolicy.ts; Issue refs: None
- [#1207](https://github.com/open-mercato/open-mercato/pull/1207) tests: add low-level coverage for featureMatch.ts; Issue refs: None
- [#1209](https://github.com/open-mercato/open-mercato/pull/1209) tests: add low-level coverage for metadata.ts; Issue refs: None
- [#1211](https://github.com/open-mercato/open-mercato/pull/1211) fix(workflows): visual editor step delete does not work with nested confirm dialog; Issue refs: None
- [#1213](https://github.com/open-mercato/open-mercato/pull/1213) fix(progress): enforce tenant isolation in isCancellationRequested; Issue refs: None
- [#1216](https://github.com/open-mercato/open-mercato/pull/1216) Fix missing tenant scope on public quote endpoints (Sales Module); Issue refs: None
- [#1218](https://github.com/open-mercato/open-mercato/pull/1218) fix: yarn dev doesn't work out of the box in devcontainer. command fails when opening splash; Issue refs: None
- [#1223](https://github.com/open-mercato/open-mercato/pull/1223) fix(security): revoke customer sessions after admin password reset; Issue refs: None
- [#1226](https://github.com/open-mercato/open-mercato/pull/1226) Docs/design system audit 2026 04 10; Issue refs: None
- [#1231](https://github.com/open-mercato/open-mercato/pull/1231) tests: add low-level coverage for list.ts; Issue refs: None
- [#1233](https://github.com/open-mercato/open-mercato/pull/1233) fix #1229: roll out sticky actions column to wide backend lists; Issue refs: [#1229](https://github.com/open-mercato/open-mercato/issues/1229)
- [#1234](https://github.com/open-mercato/open-mercato/pull/1234) tests: add low-level coverage for inspect.ts; Issue refs: None
- [#1241](https://github.com/open-mercato/open-mercato/pull/1241) Improve reliability of webhooks and fix cross-org data leak in webhoo…; Issue refs: None
- [#1242](https://github.com/open-mercato/open-mercato/pull/1242) bug: Logout from develop environment redirects to demo environment; Issue refs: [#967](https://github.com/open-mercato/open-mercato/issues/967)
- [#1244](https://github.com/open-mercato/open-mercato/pull/1244) add Tenant org/scoped to all nativeDelete calls; Issue refs: None
- [#1245](https://github.com/open-mercato/open-mercato/pull/1245) fix(sales): reorder document detail tabs; Issue refs: [#922](https://github.com/open-mercato/open-mercato/issues/922)
- [#1246](https://github.com/open-mercato/open-mercato/pull/1246) tests: add low-level coverage for module-entities.ts; Issue refs: None
- [#1248](https://github.com/open-mercato/open-mercato/pull/1248) Fix markAllAsRead to emit read + SSE events per notification; Issue refs: None
- [#1266](https://github.com/open-mercato/open-mercato/pull/1266) Fix/superadmin privilege escalation; Issue refs: None

### 2026-04-12

- [#1126](https://github.com/open-mercato/open-mercato/pull/1126) fix(workflows): block private/internal URLs in CALL_WEBHOOK (SSRF prevention); Base: `main`; Issue refs: None
- [#1184](https://github.com/open-mercato/open-mercato/pull/1184) feat(sales): add invoice and credit memo CRUD commands, API routes, and events; Issue refs: [#1183](https://github.com/open-mercato/open-mercato/issues/1183)
- [#1212](https://github.com/open-mercato/open-mercato/pull/1212) Fix tenant isolation and race conditions in customer_accounts module; Issue refs: None
- [#1214](https://github.com/open-mercato/open-mercato/pull/1214) refactor: move default encryption maps to per-module registration; Issue refs: [#1028](https://github.com/open-mercato/open-mercato/issues/1028)
- [#1221](https://github.com/open-mercato/open-mercato/pull/1221) Fix/hackon/005 sales payments integrity; Issue refs: None
- [#1236](https://github.com/open-mercato/open-mercato/pull/1236) Sales Documents Tenant Scope Fixes; Issue refs: None
- [#1239](https://github.com/open-mercato/open-mercato/pull/1239) fix(auth): restore admin nav module source; Issue refs: [#1235](https://github.com/open-mercato/open-mercato/issues/1235)
- [#1247](https://github.com/open-mercato/open-mercato/pull/1247) fix(sales): prevent concurrent shipment overshipping; Issue refs: None
- [#1249](https://github.com/open-mercato/open-mercato/pull/1249) fix(sales): prevent concurrent return double credits; Issue refs: None
- [#1250](https://github.com/open-mercato/open-mercato/pull/1250) fix(attachments): replace PDF OCR delegate chain with pdfjs-dist; Issue refs: None
- [#1252](https://github.com/open-mercato/open-mercato/pull/1252) fix/Jwt not expired; Issue refs: None
- [#1257](https://github.com/open-mercato/open-mercato/pull/1257) fix(auth): reject non-superadmin actors with null tenant in roleTenan…; Issue refs: None
- [#1262](https://github.com/open-mercato/open-mercato/pull/1262) fix(customers): return 422 for deal UUID passed as timeline entityId; Issue refs: [#794](https://github.com/open-mercato/open-mercato/issues/794)
- [#1264](https://github.com/open-mercato/open-mercato/pull/1264) fix(auth): prevent open redirect in locale switch endpoint; Issue refs: None
- [#1270](https://github.com/open-mercato/open-mercato/pull/1270) add error handling and encryption-safe lookups to notification subscr…; Issue refs: None
- [#1272](https://github.com/open-mercato/open-mercato/pull/1272) fix(security): enforce tenant isolation on sudo challenge configs; Issue refs: None
- [#1275](https://github.com/open-mercato/open-mercato/pull/1275) fix(workflows): accept date strings in definition form schema; Issue refs: None
- [#1278](https://github.com/open-mercato/open-mercato/pull/1278) replace raw fetch with apiCall/apiFetch, add readJsonSafe, expose openApi, fix Escape handler; Issue refs: None
- [#1281](https://github.com/open-mercato/open-mercato/pull/1281) Feat/ds semantic tokens v2; Issue refs: None
- [#1282](https://github.com/open-mercato/open-mercato/pull/1282) docs(ds): Design System enforcement — AGENTS.md rules, PR checklist, and DS Guardian skill; Issue refs: None
- [#1283](https://github.com/open-mercato/open-mercato/pull/1283) Fix API dispatcher bypass for top-level RBAC metadata; Issue refs: None
- [#1284](https://github.com/open-mercato/open-mercato/pull/1284) bug: add screenshot to workflows documentation; Issue refs: [#330](https://github.com/open-mercato/open-mercato/issues/330)
- [#1288](https://github.com/open-mercato/open-mercato/pull/1288) Fix business rules page RBAC metadata alignment; Issue refs: None
- [#1289](https://github.com/open-mercato/open-mercato/pull/1289) tests: add low-level coverage for appResolver.ts; Issue refs: None
- [#1290](https://github.com/open-mercato/open-mercato/pull/1290) docs: add missing sidebar entry for user-guide/self-service-onboarding; Issue refs: None
- [#1292](https://github.com/open-mercato/open-mercato/pull/1292) Fix customer auth compound rate-limit identifiers; Issue refs: None
- [#1293](https://github.com/open-mercato/open-mercato/pull/1293) Fix staff session token rotation on login; Issue refs: None
- [#1294](https://github.com/open-mercato/open-mercato/pull/1294) Harden attachment image rendering before sharp processing; Issue refs: None
- [#1295](https://github.com/open-mercato/open-mercato/pull/1295) fix(docs): replace ghost `modules:prepare` references with `yarn generate`; Issue refs: [#320](https://github.com/open-mercato/open-mercato/issues/320)
- [#1296](https://github.com/open-mercato/open-mercato/pull/1296) Prevent unsafe protocols in inline URL custom fields; Issue refs: None
- [#1297](https://github.com/open-mercato/open-mercato/pull/1297) fix(search): hide navbar search when search module is disabled; Issue refs: None
- [#1298](https://github.com/open-mercato/open-mercato/pull/1298) fix: gitignore test-results and playwright-report globally; Issue refs: None
- [#1301](https://github.com/open-mercato/open-mercato/pull/1301) docs: fix broken spec references in AGENTS.md files (#1084); Issue refs: [#1084](https://github.com/open-mercato/open-mercato/issues/1084)
- [#1304](https://github.com/open-mercato/open-mercato/pull/1304) fix(sales): add email and phone validation to shipment form (#1018); Issue refs: [#1018](https://github.com/open-mercato/open-mercato/issues/1018)
- [#1305](https://github.com/open-mercato/open-mercato/pull/1305) Fix API dispatcher auth default; Issue refs: None
- [#1308](https://github.com/open-mercato/open-mercato/pull/1308) tests: add low-level coverage for metadata.ts; Issue refs: None
- [#1311](https://github.com/open-mercato/open-mercato/pull/1311) fix(security): reject forged payment gateway webhooks; Issue refs: None
- [#1312](https://github.com/open-mercato/open-mercato/pull/1312) fix(ui): consistent timestamp formatting in table views and tooltips (#946); Issue refs: [#946](https://github.com/open-mercato/open-mercato/issues/946)
- [#1322](https://github.com/open-mercato/open-mercato/pull/1322) tests: add low-level coverage for agentic-setup.ts; Issue refs: None
- [#1326](https://github.com/open-mercato/open-mercato/pull/1326) docs: improve and fix customization guide tutorials; Issue refs: [#122](https://github.com/open-mercato/open-mercato/issues/122)
- [#1327](https://github.com/open-mercato/open-mercato/pull/1327) Enforce RBAC on customer detail endpoints and add guardrail test; Issue refs: None
- [#1333](https://github.com/open-mercato/open-mercato/pull/1333) fix: prevent build failures when the example module is disabled #601; Issue refs: [#601](https://github.com/open-mercato/open-mercato/issues/601)
- [#1344](https://github.com/open-mercato/open-mercato/pull/1344) fix: ensure tag filters display labels instead of UUIDs across affect…; Issue refs: [#238](https://github.com/open-mercato/open-mercato/issues/238)
- [#1345](https://github.com/open-mercato/open-mercato/pull/1345) fix: add missing open-api specs for responses for workflows api #333; Issue refs: [#333](https://github.com/open-mercato/open-mercato/issues/333)
- [#1347](https://github.com/open-mercato/open-mercato/pull/1347) test(workflows): add integration tests for workflow definition and in…; Issue refs: [#622](https://github.com/open-mercato/open-mercato/issues/622)
- [#1349](https://github.com/open-mercato/open-mercato/pull/1349) tests: add integration tests for sales, customers, and auth modules #622; Issue refs: [#622](https://github.com/open-mercato/open-mercato/issues/622)
- [#1351](https://github.com/open-mercato/open-mercato/pull/1351) tests: add low-level coverage for agentic-init.ts; Issue refs: None
- [#1352](https://github.com/open-mercato/open-mercato/pull/1352) tests: add low-level coverage for merger.ts; Issue refs: None
- [#1354](https://github.com/open-mercato/open-mercato/pull/1354) fix(inbox_ops): add missing i18n translation files (#897); Issue refs: [#897](https://github.com/open-mercato/open-mercato/issues/897)
- [#1357](https://github.com/open-mercato/open-mercato/pull/1357) fix(directory): honor All Organizations for ACL __all__ non-superAdmins; Issue refs: [#1112](https://github.com/open-mercato/open-mercato/issues/1112)
- [#1360](https://github.com/open-mercato/open-mercato/pull/1360) Fix missing idempotency in shipping carrier webhook processing; Issue refs: None
- [#1364](https://github.com/open-mercato/open-mercato/pull/1364) tests: add low-level coverage for interceptors.ts; Issue refs: None
- [#1366](https://github.com/open-mercato/open-mercato/pull/1366) fix(attachments): enforce tenant scope on public-partition file access; Issue refs: None
- [#1367](https://github.com/open-mercato/open-mercato/pull/1367) fix flaky test; Issue refs: None
- [#1373](https://github.com/open-mercato/open-mercato/pull/1373) fix: improve product search in sales line item dialog; Issue refs: [#1350](https://github.com/open-mercato/open-mercato/issues/1350)
- [#1374](https://github.com/open-mercato/open-mercato/pull/1374) Feature/smart test skill; Issue refs: None
- [#1375](https://github.com/open-mercato/open-mercato/pull/1375) fix(business_rules): allow creating rules without conditionExpression; Issue refs: [#1033](https://github.com/open-mercato/open-mercato/issues/1033)
- [#1378](https://github.com/open-mercato/open-mercato/pull/1378) fix(cli): resolve app-level workers and exports from .ts source files; Issue refs: [#1088](https://github.com/open-mercato/open-mercato/issues/1088)
- [#1385](https://github.com/open-mercato/open-mercato/pull/1385) feat(skills): add review-pr skill for automated PR reviews; Issue refs: None
- [#1389](https://github.com/open-mercato/open-mercato/pull/1389) Enforce trusted tenant scope in subscribers; Issue refs: None
- [#1390](https://github.com/open-mercato/open-mercato/pull/1390) Enforce endpoint RBAC in code mode api requests; Issue refs: None
- [#1391](https://github.com/open-mercato/open-mercato/pull/1391) Serialize workflow instance execution; Issue refs: None
- [#1394](https://github.com/open-mercato/open-mercato/pull/1394) Dedupe inbound replays without message id; Issue refs: None

### 2026-04-13

- [#1190](https://github.com/open-mercato/open-mercato/pull/1190) feat: add docs to user guide section about attachments; Issue refs: [#173](https://github.com/open-mercato/open-mercato/issues/173)
- [#1227](https://github.com/open-mercato/open-mercato/pull/1227) bug: Custom fields of `kind: relation` render as raw UUIDs instead of entity titles/links in DataGrid; Issue refs: [#696](https://github.com/open-mercato/open-mercato/issues/696)
- [#1230](https://github.com/open-mercato/open-mercato/pull/1230) tests: add low-level coverage for check.ts; Issue refs: None
- [#1238](https://github.com/open-mercato/open-mercato/pull/1238) tests: add low-level coverage for openapi-paths.ts; Issue refs: None
- [#1251](https://github.com/open-mercato/open-mercato/pull/1251) spec: refine unified AI tooling and sub-agents spec; Issue refs: None
- [#1254](https://github.com/open-mercato/open-mercato/pull/1254) fix(auth): apply input validation to feature-check endpoint to prevent DoS; Issue refs: None
- [#1276](https://github.com/open-mercato/open-mercato/pull/1276) feat(workflows): link workflow instance ID in list table; Issue refs: None
- [#1285](https://github.com/open-mercato/open-mercato/pull/1285) fix(sync-akeneo): block Akeneo SSRF and credential leaks; Issue refs: None
- [#1291](https://github.com/open-mercato/open-mercato/pull/1291) Fix customer signup account enumeration; Issue refs: None
- [#1303](https://github.com/open-mercato/open-mercato/pull/1303) tests(content): add unit test coverage for content package; Issue refs: None
- [#1314](https://github.com/open-mercato/open-mercato/pull/1314) fix(customers): apply entityId filter in comments list endpoint (#1100); Issue refs: [#1100](https://github.com/open-mercato/open-mercato/issues/1100)
- [#1315](https://github.com/open-mercato/open-mercato/pull/1315) fix(attachments): normalize empty/null extracted text in attachment preview (#979); Issue refs: [#979](https://github.com/open-mercato/open-mercato/issues/979)
- [#1316](https://github.com/open-mercato/open-mercato/pull/1316) fix(security): re-resolve customer portal ACL on every request; Issue refs: None
- [#1320](https://github.com/open-mercato/open-mercato/pull/1320) bug(customers): #793 #792 add normalization for nested profile payloa…; Issue refs: [#792](https://github.com/open-mercato/open-mercato/issues/792), [#793](https://github.com/open-mercato/open-mercato/issues/793)
- [#1321](https://github.com/open-mercato/open-mercato/pull/1321) fix: standardize org validation error when context is missing (#958); Issue refs: [#958](https://github.com/open-mercato/open-mercato/issues/958)
- [#1346](https://github.com/open-mercato/open-mercato/pull/1346) feat: add product variant media display and default fallback logic #892; Issue refs: [#892](https://github.com/open-mercato/open-mercato/issues/892)
- [#1355](https://github.com/open-mercato/open-mercato/pull/1355) tests: add low-level coverage for debug.ts; Issue refs: None
- [#1356](https://github.com/open-mercato/open-mercato/pull/1356) tests: add low-level coverage for presenter-enricher.ts; Issue refs: None
- [#1365](https://github.com/open-mercato/open-mercato/pull/1365) fix(ai-assistant): backport isolated-vm sandbox from main to develop …; Issue refs: None
- [#1369](https://github.com/open-mercato/open-mercato/pull/1369) fix(webhooks): block SSRF in outbound webhook delivery URLs; Issue refs: None
- [#1370](https://github.com/open-mercato/open-mercato/pull/1370) fix(workflows): prevent privilege escalation via CALL_API admin-by-na…; Issue refs: None
- [#1371](https://github.com/open-mercato/open-mercato/pull/1371) fix(workflows): prevent ReDoS in event trigger regex filter conditions; Issue refs: None
- [#1377](https://github.com/open-mercato/open-mercato/pull/1377) fix(sales): restore default UoM selection and search in line item dialog; Issue refs: [#894](https://github.com/open-mercato/open-mercato/issues/894)
- [#1386](https://github.com/open-mercato/open-mercato/pull/1386) fix(scheduler): show system and tenant-scoped jobs on list page (#815); Issue refs: [#815](https://github.com/open-mercato/open-mercato/issues/815)
- [#1387](https://github.com/open-mercato/open-mercato/pull/1387) fix(business_rules): wire CRUD events to rule engine via wildcard subscriber (#662); Issue refs: [#662](https://github.com/open-mercato/open-mercato/issues/662)
- [#1388](https://github.com/open-mercato/open-mercato/pull/1388) fix(security): cap one-time API key TTL and use soft-delete for cleanup; Issue refs: None
- [#1392](https://github.com/open-mercato/open-mercato/pull/1392) Serialize quote acceptance to order conversion; Issue refs: None
- [#1393](https://github.com/open-mercato/open-mercato/pull/1393) Serialize workflow instance execution; Issue refs: None
- [#1437](https://github.com/open-mercato/open-mercato/pull/1437) fix(tests): replace flaky TC-ADMIN-008 integration test with unit tests; Issue refs: [#1299](https://github.com/open-mercato/open-mercato/issues/1299), [#1307](https://github.com/open-mercato/open-mercato/issues/1307), [#1310](https://github.com/open-mercato/open-mercato/issues/1310), [#1315](https://github.com/open-mercato/open-mercato/issues/1315), [#1317](https://github.com/open-mercato/open-mercato/issues/1317), [#1318](https://github.com/open-mercato/open-mercato/issues/1318), [#1319](https://github.com/open-mercato/open-mercato/issues/1319), [#1321](https://github.com/open-mercato/open-mercato/issues/1321), [#1323](https://github.com/open-mercato/open-mercato/issues/1323), [#1325](https://github.com/open-mercato/open-mercato/issues/1325), [#1330](https://github.com/open-mercato/open-mercato/issues/1330), [#1339](https://github.com/open-mercato/open-mercato/issues/1339), [#1340](https://github.com/open-mercato/open-mercato/issues/1340), [#1342](https://github.com/open-mercato/open-mercato/issues/1342), [#1356](https://github.com/open-mercato/open-mercato/issues/1356), [#1358](https://github.com/open-mercato/open-mercato/issues/1358), [#1363](https://github.com/open-mercato/open-mercato/issues/1363), [#1365](https://github.com/open-mercato/open-mercato/issues/1365), [#1369](https://github.com/open-mercato/open-mercato/issues/1369), [#1371](https://github.com/open-mercato/open-mercato/issues/1371), [#1387](https://github.com/open-mercato/open-mercato/issues/1387), [#1429](https://github.com/open-mercato/open-mercato/issues/1429)
- [#1438](https://github.com/open-mercato/open-mercato/pull/1438) fix: add OPENCODE_* env var fallbacks for AI provider keys; Issue refs: [#1430](https://github.com/open-mercato/open-mercato/issues/1430)
- [#1439](https://github.com/open-mercato/open-mercato/pull/1439) Fix coverage warmup and prevent DB connection pool exhaustion; Issue refs: None
- [#1440](https://github.com/open-mercato/open-mercato/pull/1440) feat: extend review-pr skill for worktree reviews and fix-forward flow; Issue refs: None
- [#1441](https://github.com/open-mercato/open-mercato/pull/1441) tests(onboarding): add unit test coverage for onboarding package; Issue refs: [#1313](https://github.com/open-mercato/open-mercato/issues/1313)
- [#1442](https://github.com/open-mercato/open-mercato/pull/1442) Fix stored XSS in attachment uploads (carry-forward #1302); Issue refs: [#1302](https://github.com/open-mercato/open-mercato/issues/1302)
- [#1443](https://github.com/open-mercato/open-mercato/pull/1443) fix(security): migrate feature_toggles to requireFeatures and deprecate requireRoles; Issue refs: [#1427](https://github.com/open-mercato/open-mercato/issues/1427)
- [#1445](https://github.com/open-mercato/open-mercato/pull/1445) fix(workflows): halt workflow on activity failure by default; Issue refs: None
- [#1471](https://github.com/open-mercato/open-mercato/pull/1471) fix standalone dist cleanup for integration parity; Issue refs: None

### 2026-04-14

- [#1219](https://github.com/open-mercato/open-mercato/pull/1219) fix(cli): restore legacy output format for AST-generated module registry; Issue refs: None
- [#1452](https://github.com/open-mercato/open-mercato/pull/1452) fix(sales,workflows): add pessimistic locking to prevent duplicate side effects; Issue refs: [#1339](https://github.com/open-mercato/open-mercato/issues/1339)
- [#1453](https://github.com/open-mercato/open-mercato/pull/1453) fix(auth): reject deleted users during session token refresh (carry-forward #1368); Issue refs: [#1368](https://github.com/open-mercato/open-mercato/issues/1368)
- [#1454](https://github.com/open-mercato/open-mercato/pull/1454) fix(catalog): prevent variant table overflow (carry-forward #1240); Issue refs: [#1240](https://github.com/open-mercato/open-mercato/issues/1240)
- [#1455](https://github.com/open-mercato/open-mercato/pull/1455) fix(customers): deassign deal from customer/company detail instead of deleting (#109); Issue refs: [#109](https://github.com/open-mercato/open-mercato/issues/109), [#1228](https://github.com/open-mercato/open-mercato/issues/1228)
- [#1456](https://github.com/open-mercato/open-mercato/pull/1456) spec: PR label workflow — streamlined review & QA pipeline; Issue refs: None
- [#1457](https://github.com/open-mercato/open-mercato/pull/1457) fix(business_rules): allow creating rules without conditionExpression (carry-forward #1152); Issue refs: [#1152](https://github.com/open-mercato/open-mercato/issues/1152)
- [#1459](https://github.com/open-mercato/open-mercato/pull/1459) Fix/windows build; Issue refs: None
- [#1460](https://github.com/open-mercato/open-mercato/pull/1460) fix(sales): add tag description to filters and fix useMemo deps (carry-forward #777); Issue refs: [#777](https://github.com/open-mercato/open-mercato/issues/777)
- [#1461](https://github.com/open-mercato/open-mercato/pull/1461) fix(security): make JWTs revocable and isolate staff/customer audiences (carry-forward #1286); Issue refs: [#1286](https://github.com/open-mercato/open-mercato/issues/1286)
- [#1462](https://github.com/open-mercato/open-mercato/pull/1462) fix(runtime): preserve Redis URL semantics across queue and scheduler; Issue refs: [#1136](https://github.com/open-mercato/open-mercato/issues/1136)
- [#1463](https://github.com/open-mercato/open-mercato/pull/1463) feat(ui): redesign perspectives panel as Views with DS compliance; Issue refs: [#1176](https://github.com/open-mercato/open-mercato/issues/1176)
- [#1464](https://github.com/open-mercato/open-mercato/pull/1464) fix(directory): trim whitespace-padded organization scope IDs (carry-forward #1307); Issue refs: [#1307](https://github.com/open-mercato/open-mercato/issues/1307)
- [#1465](https://github.com/open-mercato/open-mercato/pull/1465) fix(security): hash staff session and password-reset tokens with HMAC (carry-forward #1277); Issue refs: [#1277](https://github.com/open-mercato/open-mercato/issues/1277)
- [#1466](https://github.com/open-mercato/open-mercato/pull/1466) fix(webhooks): add view-details action to delivery log (carry-forward #1317); Issue refs: [#1317](https://github.com/open-mercato/open-mercato/issues/1317)
- [#1467](https://github.com/open-mercato/open-mercato/pull/1467) fix(workflows): UI contract violations + DS token migration (carry-forward #1287); Issue refs: [#1287](https://github.com/open-mercato/open-mercato/issues/1287)
- [#1468](https://github.com/open-mercato/open-mercato/pull/1468) fix(sales): regression test + findOneWithDecryption for quote-to-order (#919); Issue refs: [#919](https://github.com/open-mercato/open-mercato/issues/919), [#1319](https://github.com/open-mercato/open-mercato/issues/1319)
- [#1469](https://github.com/open-mercato/open-mercato/pull/1469) fix(entities): sanitize HTML rich text fields at persistence boundary (carry-forward #1265); Issue refs: [#1265](https://github.com/open-mercato/open-mercato/issues/1265)
- [#1470](https://github.com/open-mercato/open-mercato/pull/1470) fix(auth): enforce tenantId requirement for roles; Issue refs: [#687](https://github.com/open-mercato/open-mercato/issues/687), [#1299](https://github.com/open-mercato/open-mercato/issues/1299)
- [#1473](https://github.com/open-mercato/open-mercato/pull/1473) feat: add default value support for custom fields (#824); Issue refs: [#824](https://github.com/open-mercato/open-mercato/issues/824), [#1372](https://github.com/open-mercato/open-mercato/issues/1372)
- [#1474](https://github.com/open-mercato/open-mercato/pull/1474) test(planner): integration tests for availability rule sets and CRUD (carry-forward #1348); Issue refs: [#1348](https://github.com/open-mercato/open-mercato/issues/1348)
- [#1475](https://github.com/open-mercato/open-mercato/pull/1475) security: upgrade next and @hono/node-server to fix Dependabot alerts; Issue refs: None
- [#1476](https://github.com/open-mercato/open-mercato/pull/1476) fix(auth): reset attacker-controlled scope params and add auth.view guard; Issue refs: [#1261](https://github.com/open-mercato/open-mercato/issues/1261)
- [#1477](https://github.com/open-mercato/open-mercato/pull/1477) fix(business_rules): accept date strings in rule form schema (carry-forward #1273); Issue refs: [#1273](https://github.com/open-mercato/open-mercato/issues/1273)
- [#1481](https://github.com/open-mercato/open-mercato/pull/1481) fix(attachments): remove markitdown shell-out, replace with pure-JS e…; Issue refs: None
- [#1486](https://github.com/open-mercato/open-mercato/pull/1486) fix(security): hash message access and quote acceptance tokens at rest (carry-forward #1483); Issue refs: [#1277](https://github.com/open-mercato/open-mercato/issues/1277), [#1412](https://github.com/open-mercato/open-mercato/issues/1412), [#1465](https://github.com/open-mercato/open-mercato/issues/1465), [#1483](https://github.com/open-mercato/open-mercato/issues/1483)
- [#1487](https://github.com/open-mercato/open-mercato/pull/1487) fix(workflows): use filterIds for org scoping in all GET handlers (carry-forward #1482); Issue refs: [#1482](https://github.com/open-mercato/open-mercato/issues/1482)
- [#1488](https://github.com/open-mercato/open-mercato/pull/1488) fix(i18n): sync missing translations + restore BC-critical exports (carry-forward #1485); Issue refs: [#1485](https://github.com/open-mercato/open-mercato/issues/1485)
- [#1489](https://github.com/open-mercato/open-mercato/pull/1489) [codex] finalize PR label workflow; Issue refs: None
- [#1494](https://github.com/open-mercato/open-mercato/pull/1494) fix(testing): stabilize develop integration and standalone flows; Issue refs: None

### 2026-04-15

- [#1484](https://github.com/open-mercato/open-mercato/pull/1484) fix: pg lock hopping connections; Issue refs: [#1154](https://github.com/open-mercato/open-mercato/issues/1154)
- [#1490](https://github.com/open-mercato/open-mercato/pull/1490) fix(auth): honor redirect query param on login page; Issue refs: None
- [#1496](https://github.com/open-mercato/open-mercato/pull/1496) Feat/windows prereq powershell setup; Issue refs: None
- [#1497](https://github.com/open-mercato/open-mercato/pull/1497) fix(security): atomic token consumption to prevent race conditions; Issue refs: [#1423](https://github.com/open-mercato/open-mercato/issues/1423), [#1486](https://github.com/open-mercato/open-mercato/issues/1486)
- [#1499](https://github.com/open-mercato/open-mercato/pull/1499) fix(events): remove SSE abort listeners on cleanup (#1422); Issue refs: [#1422](https://github.com/open-mercato/open-mercato/issues/1422)
- [#1500](https://github.com/open-mercato/open-mercato/pull/1500) security(auth,customers): scope ID lookups by tenant to prevent cross-tenant existence oracles (#1428); Issue refs: [#1428](https://github.com/open-mercato/open-mercato/issues/1428)
- [#1501](https://github.com/open-mercato/open-mercato/pull/1501) fix(security): revalidate portal user state from DB on every request (#1426); Issue refs: [#1426](https://github.com/open-mercato/open-mercato/issues/1426)
- [#1502](https://github.com/open-mercato/open-mercato/pull/1502) fix(security): require auth by default when route metadata is missing (#1420); Issue refs: [#1420](https://github.com/open-mercato/open-mercato/issues/1420)
- [#1503](https://github.com/open-mercato/open-mercato/pull/1503) fix(queue): add retry and backoff for failed jobs in all queue strategies (#1416); Issue refs: [#1416](https://github.com/open-mercato/open-mercato/issues/1416)
- [#1504](https://github.com/open-mercato/open-mercato/pull/1504) fix(sales,workflows): prevent premature state commits before side-effects complete (#1415); Issue refs: [#1415](https://github.com/open-mercato/open-mercato/issues/1415)
- [#1505](https://github.com/open-mercato/open-mercato/pull/1505) security(sales,auth): fix race conditions in payments, quotes, shipments, and password reset (#1414); Issue refs: [#1414](https://github.com/open-mercato/open-mercato/issues/1414)
- [#1507](https://github.com/open-mercato/open-mercato/pull/1507) fix: 🔒 reliability: Search bulkIndex silently swallows strategy failures (#1424); Issue refs: [#1424](https://github.com/open-mercato/open-mercato/issues/1424)
- [#1508](https://github.com/open-mercato/open-mercato/pull/1508) fix: bug(workflows): workflow execution failures not visible in dev console (#1446); Issue refs: [#1446](https://github.com/open-mercato/open-mercato/issues/1446)
- [#1511](https://github.com/open-mercato/open-mercato/pull/1511) fix(example): correct injection placement targets in example widgets + windows troubleshooting; Issue refs: None
- [#1514](https://github.com/open-mercato/open-mercato/pull/1514) feat(ai-assistant): LLM provider ports & adapters — unlock DeepInfra, Groq, and custom backends; Issue refs: [#1498](https://github.com/open-mercato/open-mercato/issues/1498)
- [#1516](https://github.com/open-mercato/open-mercato/pull/1516) fix(ui): optimize treeshaking for icons; Issue refs: [#1493](https://github.com/open-mercato/open-mercato/issues/1493)
- [#1517](https://github.com/open-mercato/open-mercato/pull/1517) fix(cli): auto-copy .env.example when .env is missing in dev; Issue refs: None
- [#1520](https://github.com/open-mercato/open-mercato/pull/1520) fix(workflows): SSRF-guard CALL_WEBHOOK activity; Issue refs: [#1510](https://github.com/open-mercato/open-mercato/issues/1510)
- [#1522](https://github.com/open-mercato/open-mercato/pull/1522) docs(skills): add create-pr and continue-pr skills; Issue refs: None
- [#1524](https://github.com/open-mercato/open-mercato/pull/1524) fix(events): dispatch event subscribers in parallel (#1405); Issue refs: [#1405](https://github.com/open-mercato/open-mercato/issues/1405)

