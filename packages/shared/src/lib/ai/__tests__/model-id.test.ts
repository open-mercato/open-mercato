import { joinProviderModel } from '../model-id'

describe('joinProviderModel', () => {
  it('prepends the provider id to a bare model id', () => {
    expect(joinProviderModel('anthropic', 'claude-haiku-4-5')).toBe('anthropic/claude-haiku-4-5')
  })

  it('passes a vendor-prefixed gateway model id through with a single gateway prefix', () => {
    expect(joinProviderModel('openrouter', 'anthropic/claude-sonnet-4.5')).toBe(
      'openrouter/anthropic/claude-sonnet-4.5',
    )
  })

  it('does not double an already-prefixed value', () => {
    expect(joinProviderModel('openrouter', 'openrouter/anthropic/claude-sonnet-4.5')).toBe(
      'openrouter/anthropic/claude-sonnet-4.5',
    )
  })

  it('only treats an exact `${providerId}/` prefix as already-joined', () => {
    // A different vendor prefix must still be prefixed with the provider.
    expect(joinProviderModel('openrouter', 'openai/gpt-4o-mini')).toBe(
      'openrouter/openai/gpt-4o-mini',
    )
  })
})
