/**
 * Regression coverage for the partitioned-bootstrap registry contract.
 *
 * A Node process can run more than one bootstrap partition: the API-only one
 * (`skipCoreInjectionWidgets: true`) and the full page one. Two invariants have to hold
 * together, and skipping registration outright only satisfied the first:
 *
 * 1. the partition that registers second must never shrink the registry the first published;
 * 2. an API-only process must still be able to READ the registry, because module API routes
 *    resolve widget contributions on the request path.
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import type { ModuleInjectionWidgetEntry } from '@open-mercato/shared/modules/registry'

const GLOBAL_INJECTION_WIDGETS_KEY = '__openMercatoCoreInjectionWidgetEntries__'

function entry(key: string): ModuleInjectionWidgetEntry {
  return { moduleId: key.split(':')[0]!, key, source: 'package', widgetId: key, loader: async () => ({}) as never }
}

type Loader = typeof import('@open-mercato/shared/modules/widgets/injection-loader')

function freshLoader(): Loader {
  delete (globalThis as Record<string, unknown>)[GLOBAL_INJECTION_WIDGETS_KEY]
  let loader!: Loader
  jest.isolateModules(() => {
    loader = require('@open-mercato/shared/modules/widgets/injection-loader') as Loader
  })
  return loader
}

describe('core injection widget registration modes', () => {
  beforeEach(() => {
    delete (globalThis as Record<string, unknown>)[GLOBAL_INJECTION_WIDGETS_KEY]
  })

  it('replaces the registry by default', () => {
    const loader = freshLoader()
    loader.registerCoreInjectionWidgets([entry('a:one'), entry('b:two')])
    loader.registerCoreInjectionWidgets([entry('a:one')])

    expect(loader.getCoreInjectionWidgets().map((it) => it.key)).toEqual(['a:one'])
  })

  it('populates an unregistered registry in merge mode instead of leaving it throwing', () => {
    const loader = freshLoader()
    expect(() => loader.getCoreInjectionWidgets()).toThrow(/not registered/)

    loader.registerCoreInjectionWidgets([entry('a:one')], { mode: 'merge' })

    expect(loader.getCoreInjectionWidgets().map((it) => it.key)).toEqual(['a:one'])
  })

  it('never shrinks a registry a fuller partition already published', () => {
    const loader = freshLoader()
    loader.registerCoreInjectionWidgets([entry('a:one'), entry('b:two'), entry('c:three')])
    loader.registerCoreInjectionWidgets([entry('a:one')], { mode: 'merge' })

    expect(loader.getCoreInjectionWidgets().map((it) => it.key)).toEqual(['a:one', 'b:two', 'c:three'])
  })

  it('adds only the entries the registry does not already carry', () => {
    const loader = freshLoader()
    loader.registerCoreInjectionWidgets([entry('a:one')])
    loader.registerCoreInjectionWidgets([entry('a:one'), entry('d:four')], { mode: 'merge' })

    expect(loader.getCoreInjectionWidgets().map((it) => it.key)).toEqual(['a:one', 'd:four'])
  })

  it('leaves an unregistered registry untouched when it has nothing to contribute', () => {
    const loader = freshLoader()
    loader.registerCoreInjectionWidgets([], { mode: 'merge' })

    // Publishing an empty array here would turn the loud "not registered" bootstrap error into
    // silently missing contributions on every request.
    expect(() => loader.getCoreInjectionWidgets()).toThrow(/not registered/)
  })
})
