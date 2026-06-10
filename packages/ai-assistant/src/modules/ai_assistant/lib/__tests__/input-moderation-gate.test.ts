import { extractLatestUserText, runInputModerationGate } from '../agent-runtime'
import {
  AiModerationBlockedError,
  AiModerationUnavailableError,
  type ModerationResult,
  type ModerationService,
} from '../moderation'

function serviceReturning(result: ModerationResult): ModerationService {
  return { checkInput: jest.fn(async () => result) }
}
function serviceThrowing(error: unknown): ModerationService {
  return { checkInput: jest.fn(async () => { throw error }) }
}

const CLEAN: ModerationResult = { flagged: false, categories: { hate: { flagged: false, score: 0.01 } } }
const FLAGGED: ModerationResult = { flagged: true, categories: { hate: { flagged: true, score: 0.98 } } }

const base = {
  supportsInputModeration: true,
  userText: 'hello there',
  apiKey: 'sk-test',
  env: {} as Record<string, string | undefined>,
}

describe('extractLatestUserText', () => {
  it('returns the text parts of the most recent user message', () => {
    const messages = [
      { role: 'user', parts: [{ type: 'text', text: 'first' }] },
      { role: 'assistant', parts: [{ type: 'text', text: 'reply' }] },
      { role: 'user', parts: [{ type: 'text', text: 'second' }, { type: 'text', text: 'line' }] },
    ] as never
    expect(extractLatestUserText(messages)).toBe('second\nline')
  })

  it('falls back to string content and returns empty when no user message', () => {
    expect(extractLatestUserText([{ role: 'user', content: 'plain' }] as never)).toBe('plain')
    expect(extractLatestUserText([{ role: 'assistant', parts: [{ type: 'text', text: 'x' }] }] as never)).toBe('')
  })
})

describe('runInputModerationGate', () => {
  it('skips entirely when policy resolves to off (no untrusted, no override, no env)', async () => {
    const service = serviceReturning(FLAGGED)
    await expect(runInputModerationGate({ ...base, service })).resolves.toBeUndefined()
    expect(service.checkInput).not.toHaveBeenCalled()
  })

  it('skips when the provider does not support moderation, even on an enforced surface', async () => {
    const service = serviceReturning(FLAGGED)
    await expect(
      runInputModerationGate({ ...base, untrustedInput: true, supportsInputModeration: false, service }),
    ).resolves.toBeUndefined()
    expect(service.checkInput).not.toHaveBeenCalled()
  })

  it('skips when the user text is empty', async () => {
    const service = serviceReturning(FLAGGED)
    await expect(
      runInputModerationGate({ ...base, untrustedInput: true, userText: '   ', service }),
    ).resolves.toBeUndefined()
    expect(service.checkInput).not.toHaveBeenCalled()
  })

  it('passes clean input through on an enabled surface', async () => {
    const service = serviceReturning(CLEAN)
    await expect(
      runInputModerationGate({ ...base, perAgentOverride: true, service }),
    ).resolves.toBeUndefined()
    expect(service.checkInput).toHaveBeenCalledTimes(1)
  })

  it('throws AiModerationBlockedError (with categories) on flagged input', async () => {
    const service = serviceReturning(FLAGGED)
    const error = await runInputModerationGate({ ...base, untrustedInput: true, service }).catch((e) => e)
    expect(error).toBeInstanceOf(AiModerationBlockedError)
    expect((error as AiModerationBlockedError).categories.hate.flagged).toBe(true)
  })

  it('runs the onFlagged side effect before throwing, and the throw still applies if it fails', async () => {
    const service = serviceReturning(FLAGGED)
    const onFlagged = jest.fn(async () => { throw new Error('db down') })
    const error = await runInputModerationGate({ ...base, untrustedInput: true, service, onFlagged }).catch((e) => e)
    expect(onFlagged).toHaveBeenCalledWith(FLAGGED.categories)
    expect(error).toBeInstanceOf(AiModerationBlockedError)
  })

  it('fails CLOSED on an enforced surface when the endpoint is unavailable', async () => {
    const service = serviceThrowing(new AiModerationUnavailableError('endpoint down'))
    await expect(
      runInputModerationGate({ ...base, untrustedInput: true, service }),
    ).rejects.toBeInstanceOf(AiModerationUnavailableError)
  })

  it('fails OPEN on an opt-in (on) surface when the endpoint is unavailable', async () => {
    const service = serviceThrowing(new AiModerationUnavailableError('endpoint down'))
    await expect(
      runInputModerationGate({ ...base, perAgentOverride: true, service }),
    ).resolves.toBeUndefined()
  })

  it('fails CLOSED on enforced when the service is missing from the container', async () => {
    await expect(
      runInputModerationGate({ ...base, untrustedInput: true, service: null }),
    ).rejects.toBeInstanceOf(AiModerationUnavailableError)
  })

  it('fails OPEN on opt-in when the API key is missing', async () => {
    const service = serviceReturning(CLEAN)
    await expect(
      runInputModerationGate({ ...base, perAgentOverride: true, apiKey: null, service }),
    ).resolves.toBeUndefined()
    expect(service.checkInput).not.toHaveBeenCalled()
  })
})
