import type { InstalledAdapter } from '../AdapterRow'
import { buildSettingsPatch, reconcileSavedAdapterSecrets } from '../settingsPatch'

const baseline = {
  concurrency: 2,
  minResults: 5,
  adapters: [{ id: 'exa', enabled: true, order: 0, weight: 1 }],
  adapterOptions: {
    exa: { apiKey: '__om_secret_unchanged__', baseUrl: 'https://exa.example' },
    firecrawl: { apiKey: '__om_secret_unchanged__', baseUrl: 'https://firecrawl.example' },
  },
  guardrails: { allowDomains: [], denyDomains: [], searchesPerRun: 20 },
}

describe('web-search settings edited-field submission', () => {
  it('omits stale fields and credentials when only concurrency changes', () => {
    expect(buildSettingsPatch({ ...baseline, concurrency: 4 }, baseline)).toEqual({ concurrency: 4 })
  })

  it('does not replace untouched guardrails or another adapter when saving credentials', () => {
    const updated = {
      ...baseline,
      adapterOptions: { ...baseline.adapterOptions, exa: { apiKey: 'replacement', baseUrl: 'https://new.example' } },
      guardrails: { ...baseline.guardrails, denyDomains: ['blocked.example'] },
    }
    expect(buildSettingsPatch(updated, baseline)).toEqual({
      adapterOptions: { exa: updated.adapterOptions.exa },
      guardrails: { denyDomains: ['blocked.example'] },
    })
  })

  it('keeps a changed adapter destination and its masked key together for server refusal', () => {
    const updated = { ...baseline, adapterOptions: {
      ...baseline.adapterOptions, exa: { ...baseline.adapterOptions.exa, baseUrl: 'https://new.example' },
    } }
    expect(buildSettingsPatch(updated, baseline)).toEqual({ adapterOptions: { exa: updated.adapterOptions.exa } })
  })

  it('preserves explicit false, zero, empty lists and null edits', () => {
    const original = { escalateToBrowser: true, cacheTtlMs: 1000, lastResort: 'exa', guardrails: { denyDomains: ['blocked.example'] } }
    const updated = { escalateToBrowser: false, cacheTtlMs: 0, lastResort: null, guardrails: { denyDomains: [] } }
    expect(buildSettingsPatch(updated, original)).toEqual(updated)
  })

  it('sends the existing complete adapter roster only when the roster changes', () => {
    const adapters = [{ ...baseline.adapters[0], enabled: false }]
    expect(buildSettingsPatch({ ...baseline, adapters }, baseline)).toEqual({ adapters })
    expect(buildSettingsPatch({ ...baseline }, baseline)).toEqual({})
  })
})


describe('saved credential state', () => {
  const installed: InstalledAdapter[] = [{
    id: 'exa', kind: 'api', packageName: 'fixture-exa', configured: true, configurationHint: null,
    fields: [{ name: 'apiKey', kind: 'string', required: false, secret: true }],
    options: { apiKey: '__om_secret_unchanged__', baseUrl: 'https://original.example' },
  }]
  const submitted = { exa: { apiKey: 'fixture-saved', baseUrl: 'https://original.example' } }

  it('masks the saved key while preserving a URL edit made during the request', () => {
    const current = { exa: { ...submitted.exa, baseUrl: 'https://new.example' } }
    expect(reconcileSavedAdapterSecrets(current, submitted, installed)).toEqual({
      exa: { apiKey: '__om_secret_unchanged__', baseUrl: 'https://new.example' },
    })
    expect(current.exa.apiKey).toBe('fixture-saved')
  })

  it('preserves a fresh replacement key entered while the save is pending', () => {
    const current = { exa: { ...submitted.exa, apiKey: 'fixture-newer' }, other: { apiKey: 'unchanged' } }
    expect(reconcileSavedAdapterSecrets(current, submitted, installed)).toEqual(current)
  })

  it('removes credentials that the saved catalogue no longer returns', () => {
    expect(reconcileSavedAdapterSecrets(submitted, submitted, [{ ...installed[0], options: {} }])).toEqual({
      exa: { baseUrl: 'https://original.example' },
    })
  })
})
