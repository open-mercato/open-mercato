import { buildWebSearchSettingsPatch } from '../settingsPatch'

describe('web-search settings partial saves', () => {
  it('preserves another operator’s unrelated policy update from a stale screen', () => {
    const opened = { concurrency: 2, minResults: 5, content: { maxPages: 3, enabledByDefault: false } }
    const otherOperatorSaved = { ...opened, concurrency: 3 }
    const patch = buildWebSearchSettingsPatch({ ...opened, minResults: 8 }, opened)
    expect({ ...otherOperatorSaved, ...patch }).toEqual({ ...opened, concurrency: 3, minResults: 8 })
  })

  it('does not resend unchanged adapters or instance-only guardrails', () => {
    const current = { adapters: [{ id: 'exa', enabled: false, order: 0 }], guardrails: { maxFetchBytes: 1000 } }
    const opened = { adapters: [{ order: 0, enabled: false, id: 'exa' }], guardrails: { maxFetchBytes: 1000, allowPrivateHosts: ['localhost'] } }
    expect(buildWebSearchSettingsPatch(current, opened)).toEqual({})
  })

  it('submits the edited credential card without replaying another adapter’s stale options', () => {
    const opened = { adapterOptions: { exa: { apiKey: '__om_secret_unchanged__' }, tavily: { apiKey: '__om_secret_unchanged__' } } }
    const current = { adapterOptions: { ...opened.adapterOptions, exa: { apiKey: 'replacement-fixture' } } }
    expect(buildWebSearchSettingsPatch(current, opened)).toEqual({ adapterOptions: { exa: { apiKey: 'replacement-fixture' } } })
  })
})
