/**
 * TC-UMES-011: CLI Commands + Conflict Detection (SPEC-041k)
 *
 * Validates the UMES CLI commands (umes:list, umes:inspect, umes:check)
 * and build-time conflict detection during `yarn generate`.
 *
 * Spec reference: SPEC-041k — DevTools + Conflict Detection (TC-UMES-DT02)
 */
import { test, expect } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {
  detectConflicts,
  detectComponentOverrideConflicts,
  detectInterceptorConflicts,
  detectCircularWidgetDependencies,
  detectMissingFeatureDeclarations,
} from '@open-mercato/shared/lib/umes/conflict-detection'

type CliFixture = {
  cwd: string
  binPath: string
}

function findProjectRoot(): string {
  let dir = process.cwd()
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'turbo.json'))) return dir
    dir = path.dirname(dir)
  }
  return process.cwd()
}

const ROOT = findProjectRoot()

function createStandaloneCliFixture(): CliFixture {
  const fixtureRoot = path.join(ROOT, '.tmp', `umes-cli-fixture-${process.pid}-${Date.now()}`)
  const packageRoot = path.join(fixtureRoot, 'node_modules', '@open-mercato')
  const exampleRoot = path.join(fixtureRoot, 'src', 'modules', 'example')

  fs.rmSync(fixtureRoot, { recursive: true, force: true })
  fs.mkdirSync(packageRoot, { recursive: true })
  fs.mkdirSync(path.join(exampleRoot, 'widgets'), { recursive: true })

  for (const pkg of ['cli', 'core', 'shared']) {
    const targetRoot = path.join(packageRoot, pkg)
    fs.mkdirSync(targetRoot, { recursive: true })
    fs.cpSync(path.join(ROOT, 'packages', pkg, 'dist'), path.join(targetRoot, 'dist'), { recursive: true })
    fs.copyFileSync(path.join(ROOT, 'packages', pkg, 'package.json'), path.join(targetRoot, 'package.json'))
  }

  fs.writeFileSync(
    path.join(fixtureRoot, 'package.json'),
    `${JSON.stringify({ name: 'umes-cli-fixture', private: true, type: 'module' }, null, 2)}\n`,
  )
  fs.writeFileSync(
    path.join(fixtureRoot, 'src', 'modules.ts'),
    [
      'export const enabledModules = [',
      "  { id: 'shipping_carriers', from: '@open-mercato/core' },",
      "  { id: 'example', from: '@app' },",
      ']',
      '',
    ].join('\n'),
  )
  fs.writeFileSync(
    path.join(exampleRoot, 'acl.ts'),
    [
      'export const features = [',
      "  { id: 'example.backend' },",
      "  { id: 'example.view' },",
      ']',
      'export default features',
      '',
    ].join('\n'),
  )
  fs.writeFileSync(
    path.join(exampleRoot, 'widgets', 'components.ts'),
    [
      'export const componentOverrides = [',
      '  {',
      "    target: { componentId: 'section:ui.detail.NotesSection' },",
      '    priority: 50,',
      '    wrapper: (Original) => Original,',
      '  },',
      ']',
      'export default componentOverrides',
      '',
    ].join('\n'),
  )
  fs.writeFileSync(
    path.join(exampleRoot, 'widgets', 'injection-table.ts'),
    [
      'export const injectionTable = {',
      "  'menu:sidebar:main': { widgetId: 'example.injection.example-menus', priority: 50 },",
      "  'portal:dashboard:sections': 'example.injection.portal-stats',",
      '}',
      'export default injectionTable',
      '',
    ].join('\n'),
  )

  return {
    cwd: fixtureRoot,
    binPath: path.join(fixtureRoot, 'node_modules', '@open-mercato', 'cli', 'dist', 'bin.js'),
  }
}

let standaloneCliFixture: CliFixture

function runMercato(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnSync(process.execPath, [standaloneCliFixture.binPath, ...args], {
    cwd: standaloneCliFixture.cwd,
    encoding: 'utf-8',
    timeout: 60_000,
    env: { ...process.env, FORCE_COLOR: '0', NODE_NO_WARNINGS: '1' },
  })

  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.status ?? 1,
  }
}

function expectContainsAll(output: string, snippets: readonly string[]): void {
  for (const snippet of snippets) {
    expect(output).toContain(snippet)
  }
}

test.describe('TC-UMES-011: CLI commands', () => {
  test.beforeAll(() => {
    standaloneCliFixture = createStandaloneCliFixture()
  })

  test.afterAll(() => {
    fs.rmSync(standaloneCliFixture.cwd, { recursive: true, force: true })
  })

  test('umes:list shows collector output for app and package-backed modules', () => {
    const { stdout, stderr, exitCode } = runMercato(['umes:list'])
    expect(exitCode).toBe(0)
    expect(stderr).toBe('')

    expectContainsAll(stdout, [
      'example',
      'example.section:ui.detail.NotesSection',
      'example.injection.example-menus',
      'menu:sidebar:main',
      'example.injection.portal-stats',
      'portal:dashboard:sections',
      'shipping_carriers',
      'shipping_carriers.sales-shipment-carrier',
      'sales.shipment',
      'shipping_carriers.validate-provider',
      'POST,GET shipping-carriers/*',
      'shipping_carriers.injection.tracking-column',
      'data-table:sales.shipments:columns',
    ])
  })

  test('umes:inspect shows extension tree for the app example module', () => {
    const { stdout, stderr, exitCode } = runMercato(['umes:inspect', '--module', 'example'])
    expect(exitCode).toBe(0)
    expect(stderr).toBe('')

    expectContainsAll(stdout, [
      'UMES Extensions for module: example',
      'Declared Features',
      'example.backend',
      'example.view',
      'example.section:ui.detail.NotesSection',
      'target: section:ui.detail.NotesSection',
      'example.injection.example-menus',
      'target: menu:sidebar:main',
      'example.injection.portal-stats',
      'target: portal:dashboard:sections',
    ])
  })

  test('umes:inspect shows extension tree for compiled package-backed modules', () => {
    const { stdout, stderr, exitCode } = runMercato(['umes:inspect', '--module', 'shipping_carriers'])
    expect(exitCode).toBe(0)
    expect(stderr).toBe('')

    expectContainsAll(stdout, [
      'UMES Extensions for module: shipping_carriers',
      'Declared Features',
      'shipping_carriers.view',
      'shipping_carriers.sales-shipment-carrier',
      'target: sales.shipment',
      'shipping_carriers.validate-provider',
      'target: POST,GET shipping-carriers/*',
      'shipping_carriers.injection.tracking-column',
      'target: data-table:sales.shipments:columns',
    ])
  })

  test('umes:inspect reports missing modules on stderr and exits non-zero', () => {
    const { stderr, exitCode } = runMercato(['umes:inspect', '--module', 'missing-module'])
    expect(exitCode).toBe(1)
    expect(stderr).toContain('Module "missing-module" not found.')
    expect(stderr).toContain('Available modules:')
    expect(stderr).toContain('example')
    expect(stderr).toContain('shipping_carriers')
  })

  test('umes:check exits 0 with no conflicts', () => {
    const { stdout, exitCode } = runMercato(['umes:check'])
    expect(exitCode).toBe(0)

    // Should indicate no errors found
    expect(stdout.toLowerCase()).toMatch(/no (conflict|error)|0 error/i)
  })
})

test.describe('TC-UMES-011: Conflict detection logic', () => {
  test('detects duplicate component overrides at same priority', () => {
    const conflicts = detectComponentOverrideConflicts([
      { moduleId: 'module-a', componentId: 'page:dashboard', priority: 100 },
      { moduleId: 'module-b', componentId: 'page:dashboard', priority: 100 },
    ])

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].severity).toBe('error')
    expect(conflicts[0].type).toBe('duplicate-component-override')
    expect(conflicts[0].moduleIds).toContain('module-a')
    expect(conflicts[0].moduleIds).toContain('module-b')
  })

  test('allows same component at different priorities without conflict', () => {
    const conflicts = detectComponentOverrideConflicts([
      { moduleId: 'module-a', componentId: 'page:dashboard', priority: 100 },
      { moduleId: 'module-b', componentId: 'page:dashboard', priority: 200 },
    ])

    expect(conflicts).toHaveLength(0)
  })

  test('warns on duplicate interceptor route+method+priority', () => {
    const conflicts = detectInterceptorConflicts([
      { moduleId: 'mod-a', id: 'a.int', targetRoute: 'customers/people', methods: ['GET'], priority: 100 },
      { moduleId: 'mod-b', id: 'b.int', targetRoute: 'customers/people', methods: ['GET'], priority: 100 },
    ])

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].severity).toBe('warning')
    expect(conflicts[0].type).toBe('duplicate-interceptor-priority')
  })

  test('detects circular widget dependencies', () => {
    const conflicts = detectCircularWidgetDependencies([
      { moduleId: 'a', spotId: 's1', widgetId: 'w1', dependsOn: ['w2'] },
      { moduleId: 'a', spotId: 's2', widgetId: 'w2', dependsOn: ['w1'] },
    ])

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].severity).toBe('error')
    expect(conflicts[0].type).toBe('circular-widget-dependency')
  })

  test('warns on undeclared feature references', () => {
    const conflicts = detectMissingFeatureDeclarations(
      [{ moduleId: 'test', extensionId: 'test.widget', features: ['test.nonexistent'] }],
      new Set(['test.view']),
    )

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].severity).toBe('warning')
    expect(conflicts[0].type).toBe('missing-feature-declaration')
  })

  test('aggregates errors and warnings in detectConflicts', () => {
    const result = detectConflicts({
      componentOverrides: [
        { moduleId: 'a', componentId: 'page:home', priority: 50 },
        { moduleId: 'b', componentId: 'page:home', priority: 50 },
      ],
      interceptors: [
        { moduleId: 'x', id: 'x.int', targetRoute: 'api/test', methods: ['POST'], priority: 0 },
        { moduleId: 'y', id: 'y.int', targetRoute: 'api/test', methods: ['POST'], priority: 0 },
      ],
      gatedExtensions: [
        { moduleId: 'z', extensionId: 'z.widget', features: ['z.missing'] },
      ],
      declaredFeatures: new Set(['z.other']),
    })

    expect(result.errors).toHaveLength(1) // component override conflict
    expect(result.warnings).toHaveLength(2) // interceptor + missing feature
  })
})
