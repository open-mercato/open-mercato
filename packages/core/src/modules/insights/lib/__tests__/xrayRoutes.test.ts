/** @jest-environment node */
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'

const reportErrorMock = jest.fn()

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({ getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => reportErrorMock(...args) }) }))
jest.mock('@open-mercato/shared/lib/logger', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/logger')
  const silent = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), trace: jest.fn(), child: () => silent }
  return { ...actual, createLogger: () => silent }
})

import { xrayInternalError } from '../xrayRoutes'

describe('xrayInternalError', () => {
  beforeEach(() => jest.clearAllMocks())

  it('answers the translated 500 body and reports the failure', async () => {
    const failure = new Error('connection reset')
    const translate = ((key: string) => `translated:${key}`) as TranslateFn
    const response = await xrayInternalError(failure, 'xray.test', translate)
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'translated:insights.xray.errors.internal_error', code: 'internal_error', hint: null })
    expect(reportErrorMock).toHaveBeenCalledTimes(1)
    expect(reportErrorMock).toHaveBeenCalledWith(failure, { module: 'insights', code: 'insights.xray_route_failed', attributes: { route: 'xray.test' } })
  })

  it('reports a failed translation too and still answers the standard 500 body', async () => {
    const failure = new Error('connection reset')
    const translationFailure = new Error('dictionary unavailable')
    const translate = (() => {
      throw translationFailure
    }) as TranslateFn
    const response = await xrayInternalError(failure, 'xray.test', translate)
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'internal_error', code: 'internal_error', hint: null })
    expect(reportErrorMock).toHaveBeenCalledWith(failure, expect.objectContaining({ code: 'insights.xray_route_failed' }))
    expect(reportErrorMock).toHaveBeenCalledWith(translationFailure, {
      module: 'insights',
      code: 'insights.xray_route_translation_failed',
      attributes: { route: 'xray.test' },
    })
  })
})
