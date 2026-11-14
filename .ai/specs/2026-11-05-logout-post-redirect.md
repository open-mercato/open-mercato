# Logout POST redirects to a GET login page

## TLDR
Correct #7383 by returning 303 See Other from both staff logout branches, so browsers navigate to GET /login.

## Problem and proposed solution
The POST-only handler inherits the shared redirect helper's 307 default, causing POST /login and form-resubmission warnings. Pass an explicit 303 at the two logout call sites; preserve the helper default and every session, cookie, telemetry, and event side effect.

## Migration & Backward Compatibility
The documented HTTP status changes from 307 to 303. URL, POST-only method, Location, session revocation, and cookie expiry stay the same. Clients must accept 303 and follow Location with GET; custom clients asserting 307 must update. There is no database migration. The user explicitly requested autonomous completion after this contract decision was reported. A method-preserving bridge would retain the reported form-resubmission defect; this is a deliberate correction to POST navigation, not a helper-wide status change. The implementing PR must disclose the changed HTTP status and retain manual QA before merge.

## Validation plan
Unit tests cover authenticated, refresh-cookie-only, invalid-cookie, cookieless, failed-revocation and event-failure branches; assert 303 and Location. Shared-helper tests retain 307. Update TC-AUTH-067 status assertions and exercise a browser form POST followed by GET /login with JavaScript disabled, then reload without POST. Fixtures remain isolated and cleaned up.

## Risks and architecture
The edit is limited to staff logout; portal logout and other redirects are unchanged. A custom client which preserves POST despite a 303 may still resubmit, so integration guidance explicitly requires GET. No new data, module coupling, permissions, DI registrations or browser bundle dependency is introduced. Session revocation and cookie-clearing regressions remain covered by existing tests.

## Final compliance review
Tenant scoping, CSRF cookie behavior, telemetry and event contracts are unchanged. The documented status correction is intentional and disclosed in both compatibility documents. Unit regressions include all existing logout branches and the unchanged 307 helper. Browser coverage includes authenticated and cookieless native forms with JavaScript disabled; it verifies the redirect method and subsequent reload. No migration or production dependency is needed.

## Changelog
- 2026-11-05: Implemented the explicit logout-only 303 correction, updated OpenAPI, compatibility guidance and regression assertions, and added native-form navigation/reload coverage for #7383.
