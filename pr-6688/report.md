## 📸 UI QA evidence — PASS

**Verdict:** ✅ PASS
**Environment:** `http://127.0.0.1:5001` · role `admin` · browser `Playwright 1.61.1 / Chromium`
**Verified:** `feat/configurable-calendar-event-types` @ `7c2da640e`

### Scenario (P1 — configurable calendar event types)

**Where to click:** `/backend/calendar` → New event / Calendar settings → Manage activity types

| # | Step | Expected | Observed | Result |
|---|------|----------|----------|--------|
| 1 | Open New event | Every configured event type is selectable | Meeting, Call, Email, Note, Event, Visit, and Task rendered | ✅ |
| 2 | Select Visit | Visit fields and availability extension appear | To field and live availability result rendered | ✅ |
| 3 | Link a customer and save | Create succeeds and the Visit appears in the calendar | Create returned success; editor closed; Visit rendered in the calendar | ✅ |
| 4 | Open Calendar settings | Activity-type management is reachable | Manage activity types linked to the organization catalog | ✅ |
| 5 | Open New activity type | Catalog and grouped form reflect the configuration model | Built-ins plus example Visit loaded; Appearance, Form behavior, and Custom-field fieldsets opened | ✅ |
| 6 | Repeat the Visit-editor smoke at 390x844 | Mobile layout remains operable | Editor became full-screen and controls/actions remained reachable | ✅ |

### Screenshots

- `01-calendar-desktop.png`
- `02-visit-editor-desktop.png`
- `03-visit-saved-desktop.png`
- `04-calendar-settings-desktop.png`
- `05-activity-type-catalog-desktop.png`
- `06-new-activity-type-desktop.png`
- `07-visit-editor-mobile.png`

### Notes for QA

- No console errors, page errors, or genuine failed requests occurred in the completed run.
- The real PostgreSQL/HTTP `TC-EXAMPLE-018` suite also passed all 9 scenarios, including concurrent staff and resource Visit booking races.
- Expected Next.js prefetch cancellations (`net::ERR_ABORTED`) during route navigation were ignored.
- The PR already includes browser-level integration coverage for the customer calendar catalog/timezone paths and example Visit availability, so no follow-up test scenario is needed.
- Evidence-only mode was used; QA labels were not changed.
