/** @jest-environment node */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function loadLocale(locale: string): Record<string, string> {
  const raw = readFileSync(join(__dirname, '..', `${locale}.json`), 'utf8')
  return JSON.parse(raw) as Record<string, string>
}

describe('Polish ASN copy', () => {
  const en = loadLocale('en')
  const pl = loadLocale('pl')

  it('keeps the same keys in every locale', () => {
    const expected = Object.keys(en).sort()
    for (const locale of ['pl', 'es', 'de', 'ko']) {
      expect(Object.keys(loadLocale(locale)).sort()).toEqual(expected)
    }
  })

  it('translates ASN actions, descriptions, and receipt labels', () => {
    const translated = [
      'wms.asns.title',
      'wms.audit.asn.create',
      'wms.audit.receivingLine.create',
      'wms.backend.asns.actions.create',
      'wms.backend.asns.description',
      'wms.backend.asns.receive.dialog.title',
      'wms.backend.asns.receive.form.qcStatus',
      'wms.backend.asns.receive.form.receivedQty',
      'wms.backend.receiving.title',
    ]
    for (const key of translated) {
      expect(pl[key]).not.toBe(en[key])
      expect(pl[key]?.length).toBeGreaterThan(0)
    }
    expect(pl['wms.backend.asns.actions.create']).toBe('Utwórz ASN')
    expect(pl['wms.backend.asns.detail.discrepancy.description']).toContain('{count}')
    expect(pl['wms.backend.asns.detail.untitled']).toContain('{id}')
    expect(en['wms.backend.asns.actions.create']).toBe('Create ASN')
  })
})