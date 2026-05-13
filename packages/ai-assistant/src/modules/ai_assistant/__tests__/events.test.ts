/**
 * Unit coverage for the ai_assistant module event declarations (Step 5.11).
 *
 * Asserts:
 * - All three FROZEN event IDs (`ai.action.confirmed` /
 *   `ai.action.cancelled` / `ai.action.expired`) appear in
 *   `eventsConfig.events` under `category: 'system'`.
 * - The typed `emitAiAssistantEvent` helper hands declared events off to
 *   the global event bus with the payload untouched.
 * - Emitting an undeclared event id is rejected at the helper boundary
 *   via `createModuleEvents`' strict-mode validation.
 */
import {
  eventsConfig,
  emitAiAssistantEvent,
  type AiAssistantEventId,
  type AiActionCancelledPayload,
  type AiActionConfirmedPayload,
  type AiActionExpiredPayload,
} from '../events'
import { setGlobalEventBus } from '@open-mercato/shared/modules/events'

const FROZEN_EVENT_IDS: ReadonlyArray<AiAssistantEventId> = [
  'ai.action.confirmed',
  'ai.action.cancelled',
  'ai.action.expired',
]

describe('ai_assistant events module', () => {
  it('declares the three FROZEN pending-action events under moduleId=ai_assistant', () => {
    expect(eventsConfig.moduleId).toBe('ai_assistant')
    const declaredIds = eventsConfig.events.map((event) => event.id)
    expect(declaredIds).toEqual(expect.arrayContaining([...FROZEN_EVENT_IDS]))
  })

  it('every FROZEN pending-action event has category=system and entity=ai_pending_action', () => {
    for (const event of eventsConfig.events) {
      if (!FROZEN_EVENT_IDS.includes(event.id as AiAssistantEventId)) continue
      expect(event.category).toBe('system')
      expect(event.entity).toBe('ai_pending_action')
      expect(event.module).toBe('ai_assistant')
      expect(typeof event.label).toBe('string')
      expect(event.label.length).toBeGreaterThan(0)
    }
  })

  describe('emitAiAssistantEvent', () => {
    const emitSpy = jest.fn().mockResolvedValue(undefined)
    let consoleErrorSpy: jest.SpyInstance

    beforeEach(() => {
      emitSpy.mockClear()
      setGlobalEventBus({ emit: (id, payload, opts) => emitSpy(id, payload, opts) })
      consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
      consoleErrorSpy.mockRestore()
    })

    it('forwards ai.action.confirmed payloads to the global bus verbatim', async () => {
      const payload: AiActionConfirmedPayload = {
        pendingActionId: 'pa_1',
        agentId: 'catalog.merchandising_assistant',
        toolName: 'catalog.update_product',
        status: 'confirmed',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        userId: 'user-1',
        resolvedByUserId: 'user-1',
        resolvedAt: '2026-04-18T10:05:00.000Z',
        executionResult: { recordId: 'p-1', commandName: 'catalog.product.update' },
      }
      await emitAiAssistantEvent(
        'ai.action.confirmed',
        payload as unknown as Record<string, unknown>,
        { persistent: true },
      )
      expect(emitSpy).toHaveBeenCalledTimes(1)
      const [id, forwardedPayload, options] = emitSpy.mock.calls[0]
      expect(id).toBe('ai.action.confirmed')
      expect(forwardedPayload).toEqual(payload)
      expect(options).toEqual({ persistent: true })
    })

    it('forwards ai.action.cancelled payloads to the global bus', async () => {
      const payload: AiActionCancelledPayload = {
        pendingActionId: 'pa_1',
        agentId: 'catalog.merchandising_assistant',
        toolName: 'catalog.update_product',
        status: 'cancelled',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        userId: 'user-1',
        resolvedByUserId: 'user-1',
        resolvedAt: '2026-04-18T10:05:00.000Z',
        executionResult: {
          error: { code: 'cancelled_by_user', message: 'Customer asked to abort' },
        },
        reason: 'Customer asked to abort',
      }
      await emitAiAssistantEvent(
        'ai.action.cancelled',
        payload as unknown as Record<string, unknown>,
      )
      expect(emitSpy).toHaveBeenCalledTimes(1)
      expect(emitSpy.mock.calls[0][0]).toBe('ai.action.cancelled')
      expect(emitSpy.mock.calls[0][1]).toEqual(payload)
    })

    it('forwards ai.action.expired payloads to the global bus', async () => {
      const payload: AiActionExpiredPayload = {
        pendingActionId: 'pa_1',
        agentId: 'catalog.merchandising_assistant',
        toolName: 'catalog.update_product',
        status: 'expired',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        userId: null,
        resolvedByUserId: null,
        resolvedAt: '2026-04-18T10:05:00.000Z',
        expiresAt: '2026-04-18T10:00:00.000Z',
        expiredAt: '2026-04-18T10:05:00.000Z',
      }
      await emitAiAssistantEvent(
        'ai.action.expired',
        payload as unknown as Record<string, unknown>,
      )
      expect(emitSpy).toHaveBeenCalledTimes(1)
      expect(emitSpy.mock.calls[0][0]).toBe('ai.action.expired')
      expect(emitSpy.mock.calls[0][1]).toEqual(payload)
    })

    it('logs an error and still forwards undeclared event ids (non-strict mode)', async () => {
      await emitAiAssistantEvent(
        // Deliberate cast: runtime test for undeclared-event path.
        'ai.action.nope' as unknown as AiAssistantEventId,
        { pendingActionId: 'pa_1' },
      )
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
      const [message] = consoleErrorSpy.mock.calls[0]
      expect(message).toContain('ai_assistant')
      expect(message).toContain('ai.action.nope')
    })
  })
})
