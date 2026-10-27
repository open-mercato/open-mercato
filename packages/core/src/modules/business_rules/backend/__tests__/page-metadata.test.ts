/** @jest-environment node */

import { describe, expect, test } from '@jest/globals'
import { features } from '../../acl'
import { metadata as logsDetailMetadata } from '../logs/[id]/page.meta'
import { metadata as logsMetadata } from '../logs/page.meta'
import { metadata as ruleCreateMetadata } from '../rules/create/page.meta'
import { metadata as ruleEditMetadata } from '../rules/[id]/page.meta'
import { metadata as setCreateMetadata } from '../sets/create/page.meta'
import { metadata as setEditMetadata } from '../sets/[id]/page.meta'
import { metadata as rulesRouteMetadata } from '../../api/rules/route'
import { metadata as logsRouteMetadata } from '../../api/logs/route'
import { metadata as logsDetailRouteMetadata } from '../../api/logs/[id]/route'

const declaredFeatureIds = new Set(features.map((feature) => feature.id))

const LOCALES = ['en', 'pl', 'de', 'es', 'ko'] as const

// These pages draw labels from two dictionaries that only meet at runtime inside
// `loadDictionary`: `rules.nav.*` ships in the app dictionary while
// `business_rules.*` ships in the module's own. Asserting shape alone would pass
// for a typo'd key that silently renders the English fallback — the very bug
// these keys exist to fix — so resolve against the merged pair instead.
function mergedDictionary(locale: string): Record<string, string> {
  return {
    ...(require(`../../../../../../../apps/mercato/src/i18n/${locale}.json`) as Record<string, string>),
    ...(require(`../../i18n/${locale}.json`) as Record<string, string>),
  }
}

const dictionaries = new Map(LOCALES.map((locale) => [locale, mergedDictionary(locale)]))

function unresolvedKeys(keys: string[]): string[] {
  const missing: string[] = []
  for (const key of keys) {
    for (const [locale, dict] of dictionaries) {
      const value = dict[key]
      if (typeof value !== 'string' || value.trim().length === 0) missing.push(`${locale}:${key}`)
    }
  }
  return missing
}

function localizedKeysOf(metadata: {
  pageTitleKey?: string
  pageGroupKey?: string
  breadcrumb?: { labelKey?: string }[]
}): string[] {
  return [
    metadata.pageTitleKey,
    metadata.pageGroupKey,
    ...(metadata.breadcrumb ?? []).map((segment) => segment.labelKey),
  ].filter((key): key is string => typeof key === 'string')
}

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

  test('localizes the rule create page title and every breadcrumb segment', () => {
    expect(ruleCreateMetadata.pageTitleKey).toBe('business_rules.rules.create.title')
    for (const segment of ruleCreateMetadata.breadcrumb ?? []) {
      expect(typeof segment.labelKey).toBe('string')
      expect(segment.labelKey).not.toHaveLength(0)
    }
  })

  test.each([
    ['rules/create', ruleCreateMetadata],
    ['rules/[id]', ruleEditMetadata],
    ['sets/create', setCreateMetadata],
    ['sets/[id]', setEditMetadata],
  ])('resolves every declared label key of %s in all five locales', (_page, metadata) => {
    const keys = localizedKeysOf(metadata)
    expect(keys.length).toBeGreaterThan(0)
    expect(unresolvedKeys(keys)).toEqual([])
  })

  test.each([
    ['rules/create', ruleCreateMetadata],
    ['rules/[id]', ruleEditMetadata],
    ['sets/create', setCreateMetadata],
    ['sets/[id]', setEditMetadata],
  ])('gives %s a localized title and a fully localized breadcrumb', (_page, metadata) => {
    expect(typeof metadata.pageTitleKey).toBe('string')
    const breadcrumb = metadata.breadcrumb ?? []
    expect(breadcrumb.length).toBeGreaterThan(0)
    for (const segment of breadcrumb) {
      expect(typeof segment.labelKey).toBe('string')
      expect(segment.labelKey).not.toHaveLength(0)
    }
  })
})
