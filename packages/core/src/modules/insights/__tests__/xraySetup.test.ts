import fs from 'node:fs'
import path from 'node:path'
import { hasAllFeatures } from '@open-mercato/shared/security/features'
import features from '../acl'
import setup from '../setup'

const XRAY_FEATURES = ['insights.xray.view', 'insights.xray.manage', 'insights.xray.view_individuals']
const LOCALES = ['en', 'pl', 'de', 'es', 'ko'] as const

describe('Process X-Ray access control', () => {
  it('declares the X-Ray features with view as their dependency', () => {
    const declared = new Map(features.map((feature) => [feature.id, feature]))
    for (const id of XRAY_FEATURES) expect(declared.has(id)).toBe(true)
    expect(declared.get('insights.xray.manage')?.dependsOn).toEqual(['insights.xray.view'])
    expect(declared.get('insights.xray.view_individuals')?.dependsOn).toEqual(['insights.xray.view'])
  })

  it('grants view and manage to admins but per-person breakdowns only to super administrators', () => {
    const roles = setup.defaultRoleFeatures ?? {}
    expect(hasAllFeatures(roles.admin ?? [], ['insights.xray.view', 'insights.xray.manage'])).toBe(true)
    expect(hasAllFeatures(roles.admin ?? [], ['insights.xray.view_individuals'])).toBe(false)
    expect(hasAllFeatures(roles.employee ?? [], ['insights.xray.view'])).toBe(false)
    expect(hasAllFeatures(roles.superadmin ?? [], ['insights.xray.view_individuals'])).toBe(true)
    expect(hasAllFeatures(roles.admin ?? [], ['insights.explain.view', 'insights.explain.access_detail'])).toBe(true)
  })

  it('labels every X-Ray feature in all locales of the auth module', () => {
    for (const locale of LOCALES) {
      const dictionary = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'auth', 'i18n', `${locale}.json`), 'utf8')) as Record<string, string>
      for (const id of XRAY_FEATURES) expect({ locale, id, labelled: typeof dictionary[`auth.acl.features.${id}`] === 'string' }).toEqual({ locale, id, labelled: true })
    }
  })
})
