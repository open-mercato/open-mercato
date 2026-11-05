import { test, expect } from '@playwright/test';
import injectionTable from '@open-mercato/core/modules/customer_accounts/widgets/injection-table';

/**
 * TC-AI-INJECT-010: Portal AiChat injection example (Phase 2 WS-C, Step 4.10-4.11).
 *
 * Phase 2 smoke: asserts that the injection table at
 * `packages/core/src/modules/customer_accounts/widgets/injection-table.ts`
 * actually maps the `customer_accounts.injection.portal-ai-assistant-trigger`
 * widget into the frozen `portal:profile:after` spot. The host portal
 * profile page is intentionally NOT edited; the widget registry does the
 * wiring.
 *
 * Note on UI smoke: a customer-side login helper does NOT yet exist in
 * `packages/core/src/modules/core/__integration__/helpers/auth.ts` (or the
 * equivalent `packages/core/src/helpers/integration/auth.ts`). Per Step
 * 4.11 scope, the Phase 2 TC-AI-INJECT-010 remains a registration-and-
 * mapping smoke — a full portal UI smoke lands in Phase 5 alongside the
 * portal customer login helper.
 *
 * The RTL unit test at
 * `packages/core/src/modules/customer_accounts/widgets/injection/
 * portal-ai-assistant-trigger/__tests__/widget.client.test.tsx` covers
 * the React component wiring.
 */
test.describe('TC-AI-INJECT-010: portal AiChat injection', () => {
  test('portal-ai-assistant-trigger is mapped to portal:profile:after', () => {
    // Frozen spot id per `packages/ui/AGENTS.md` -> Portal Widget Injection Spots.
    // `ModuleInjectionSlot` is a union — accept the array form used by this module.
    const rawSlot = (injectionTable as Record<string, unknown>)['portal:profile:after'];
    expect(Array.isArray(rawSlot)).toBe(true);
    const entries = Array.isArray(rawSlot) ? rawSlot : [];
    expect(entries.length).toBeGreaterThan(0);

    const widgetIds = entries
      .map((entry: unknown) =>
        entry && typeof entry === 'object' && 'widgetId' in entry
          ? String((entry as { widgetId?: unknown }).widgetId ?? '')
          : '',
      )
      .filter((id) => id.length > 0);
    expect(widgetIds).toContain('customer_accounts.injection.portal-ai-assistant-trigger');
  });

  test('portal login UI helper is not yet available — UI smoke deferred to Phase 5', () => {
    // This is an explicit documentation assertion so the reason the UI
    // smoke is deferred is visible in the spec run log, not hidden in
    // prose. When the portal customer login helper lands (Phase 5
    // Step 5.1+), replace this body with a real login + profile page
    // assertion and delete this placeholder test.
    expect(true).toBe(true);
  });
});
