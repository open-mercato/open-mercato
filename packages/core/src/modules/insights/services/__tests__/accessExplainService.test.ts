import fs from 'node:fs'
import path from 'node:path'
import { asValue, createContainer, InjectionMode } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { register } from '../../di'
import { ACCESS_EXPLAIN_REASONS } from '../../data/validators'
import { ACCESS_EXPLANATION_REASONS } from '@open-mercato/core/modules/auth/services/rbacService'
import { ACCESS_SUMMARY_KEYS, AccessExplainService, buildAccessSummary } from '../accessExplainService'

const LOCALES = ['en', 'pl', 'de', 'es', 'ko'] as const

describe('access explanation summary', () => {
  it.each([
    [['feature_removed', 'missing_feature'], ACCESS_SUMMARY_KEYS.feature_removed],
    [['module_disabled', 'organization_out_of_scope'], ACCESS_SUMMARY_KEYS.module_disabled],
    [['missing_feature', 'user_acl_override'], ACCESS_SUMMARY_KEYS.user_acl_override],
    [['missing_feature', 'organization_out_of_scope'], ACCESS_SUMMARY_KEYS.organization_out_of_scope],
    [['missing_feature'], ACCESS_SUMMARY_KEYS.missing_feature],
  ] as const)('picks the main reason of %p', (reasons, key) => {
    const summary = buildAccessSummary(
      [
        { feature: 'customers.people.view', granted: true },
        { feature: 'sales.orders.view', granted: false },
        { feature: 'catalog.products.view', granted: false },
      ],
      [...reasons],
    )
    expect(summary).toEqual({ key, params: { features: 'sales.orders.view, catalog.products.view', count: 2 } })
  })

  it('summarizes granted and not determinable outcomes without feature parameters', () => {
    expect(buildAccessSummary([{ feature: 'customers.people.view', granted: true }], [])).toEqual({
      key: ACCESS_SUMMARY_KEYS.granted,
      params: { count: 1 },
    })
    expect(buildAccessSummary([{ feature: 'customers.people.view', granted: true }], ['not_determinable'])).toEqual({
      key: ACCESS_SUMMARY_KEYS.not_determinable,
      params: {},
    })
  })

  it('covers every RBAC reason in the API reasons and summaries', () => {
    for (const reason of ACCESS_EXPLANATION_REASONS) {
      expect(ACCESS_EXPLAIN_REASONS).toContain(reason)
      expect(ACCESS_SUMMARY_KEYS[reason]).toEqual(expect.any(String))
    }
  })

  it.each(LOCALES)('translates every summary and error key in %s', (locale) => {
    const dictionary = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', '..', 'i18n', `${locale}.json`), 'utf8'),
    ) as Record<string, string>
    for (const key of [...Object.values(ACCESS_SUMMARY_KEYS), 'insights.explain.errors.unknownFeature']) {
      expect({ key, present: typeof dictionary[key] === 'string' }).toEqual({ key, present: true })
    }
  })
})

describe('insights DI', () => {
  it('registers the request-scoped access explanation service', () => {
    const container = createContainer({ injectionMode: InjectionMode.PROXY })
    container.register({
      em: asValue({}),
      rbacService: asValue({}),
      actionLogService: asValue({}),
    })
    register(container as unknown as AppContainer)
    const scoped = container.createScope()
    const service = scoped.resolve('accessExplainService')
    expect(service).toBeInstanceOf(AccessExplainService)
    expect(scoped.resolve('accessExplainService')).toBe(service)
    expect(container.createScope().resolve('accessExplainService')).not.toBe(service)
  })
})
