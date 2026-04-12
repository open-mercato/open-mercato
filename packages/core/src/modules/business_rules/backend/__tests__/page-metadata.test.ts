/** @jest-environment node */

import { describe, expect, test } from '@jest/globals'
import { features } from '../../acl'
import { metadata as logsDetailMetadata } from '../logs/[id]/page.meta'
import { metadata as logsMetadata } from '../logs/page.meta'
import { metadata as ruleCreateMetadata } from '../rules/create/page.meta'
import { metadata as ruleEditMetadata } from '../rules/[id]/page.meta'
import { metadata as rulesRouteMetadata } from '../../api/rules/route'
import { metadata as logsRouteMetadata } from '../../api/logs/route'
import { metadata as logsDetailRouteMetadata } from '../../api/logs/[id]/route'

const declaredFeatureIds = new Set(features.map((feature) => feature.id))

describe('business_rules backend page metadata', () => {
  test('uses declared ACL feature ids', () => {
    const backendMetadata = [
      ruleCreateMetadata,
      ruleEditMetadata,
      logsMetadata,
      logsDetailMetadata,
    ]

    for (const metadata of backendMetadata) {
      for (const featureId of metadata.requireFeatures ?? []) {
        expect(declaredFeatureIds.has(featureId)).toBe(true)
      }
    }
  })

  test('aligns rule write pages with the rule write API feature', () => {
    expect(ruleCreateMetadata.requireFeatures).toEqual(rulesRouteMetadata.POST.requireFeatures)
    expect(ruleEditMetadata.requireFeatures).toEqual(rulesRouteMetadata.PUT.requireFeatures)
  })

  test('aligns log pages with the log API feature', () => {
    expect(logsMetadata.requireFeatures).toEqual(logsRouteMetadata.GET.requireFeatures)
    expect(logsDetailMetadata.requireFeatures).toEqual(logsDetailRouteMetadata.GET.requireFeatures)
  })
})
