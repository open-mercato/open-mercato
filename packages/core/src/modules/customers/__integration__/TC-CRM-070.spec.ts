import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';

/**
 * TC-CRM-070: Stuck-threshold setting GET/PUT (SPEC-048 Phase 5a)
 *
 * Verifies the per-tenant stuck-threshold setting round-trips correctly and that the
 * validator rejects out-of-range values. Always restores the original threshold in the
 * teardown block so co-running tests stay isolated.
 */
test.describe('TC-CRM-070: Stuck-threshold setting', () => {
  test('round-trips a new threshold value', async ({ request }) => {
    const token = await getAuthToken(request);
    let savedThreshold: number | null = null;

    try {
      const initial = await apiRequest(request, 'GET', '/api/customers/settings/stuck-threshold', { token });
      expect(initial.ok(), `GET initial threshold failed: ${initial.status()}`).toBeTruthy();
      const initialBody = (await initial.json()) as { stuckThresholdDays?: number };
      expect(typeof initialBody.stuckThresholdDays, 'GET must return a numeric threshold').toBe('number');
      savedThreshold = initialBody.stuckThresholdDays ?? 14;

      const newValue = savedThreshold === 21 ? 28 : 21;
      const putResponse = await apiRequest(request, 'PUT', '/api/customers/settings/stuck-threshold', {
        token,
        data: { stuckThresholdDays: newValue },
      });
      expect(putResponse.ok(), `PUT failed: ${putResponse.status()}`).toBeTruthy();
      const putBody = (await putResponse.json()) as { stuckThresholdDays?: number };
      expect(putBody.stuckThresholdDays).toBe(newValue);

      const reread = await apiRequest(request, 'GET', '/api/customers/settings/stuck-threshold', { token });
      const rereadBody = (await reread.json()) as { stuckThresholdDays?: number };
      expect(rereadBody.stuckThresholdDays).toBe(newValue);
    } finally {
      if (savedThreshold !== null) {
        await apiRequest(request, 'PUT', '/api/customers/settings/stuck-threshold', {
          token,
          data: { stuckThresholdDays: savedThreshold },
        }).catch(() => {});
      }
    }
  });

  test('rejects out-of-range threshold values with 400', async ({ request }) => {
    const token = await getAuthToken(request);

    // Validator enforces z.number().int().min(1).max(365)
    const tooLow = await apiRequest(request, 'PUT', '/api/customers/settings/stuck-threshold', {
      token,
      data: { stuckThresholdDays: 0 },
    });
    expect(tooLow.status(), 'threshold=0 must be rejected').toBe(400);

    const tooHigh = await apiRequest(request, 'PUT', '/api/customers/settings/stuck-threshold', {
      token,
      data: { stuckThresholdDays: 1000 },
    });
    expect(tooHigh.status(), 'threshold=1000 must be rejected').toBe(400);

    const negative = await apiRequest(request, 'PUT', '/api/customers/settings/stuck-threshold', {
      token,
      data: { stuckThresholdDays: -5 },
    });
    expect(negative.status(), 'negative threshold must be rejected').toBe(400);

    const fractional = await apiRequest(request, 'PUT', '/api/customers/settings/stuck-threshold', {
      token,
      data: { stuckThresholdDays: 14.5 },
    });
    expect(fractional.status(), 'fractional threshold must be rejected').toBe(400);
  });
});
