/**
 * TC-UMES-011: CLI Commands + Generated Registry Parity + Conflict Detection (SPEC-041k)
 *
 * Validates the UMES CLI commands (umes:list, umes:inspect, umes:check)
 * together with generated module-registry outputs and build-time conflict detection.
 *
 * Spec reference: SPEC-041k — DevTools + Conflict Detection (TC-UMES-DT02)
 */
import { test, expect } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  detectConflicts,
  detectComponentOverrideConflicts,
  detectInterceptorConflicts,
  detectCircularWidgetDependencies,
  detectMissingFeatureDeclarations,
} from '@open-mercato/shared/lib/umes/conflict-detection'

function findProjectRoot(): string {
  let dir = process.cwd()
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'turbo.json'))) return dir
    dir = path.dirname(dir)
  }
  return process.cwd()
}

const ROOT = findProjectRoot()

function resolveMercatoBin(): string {
  const candidates = [
    path.join(ROOT, 'node_modules/.bin/mercato'),
    path.join(ROOT, 'node_modules/@open-mercato/cli/bin/mercato'),
    path.join(ROOT, 'packages/cli/bin/mercato'),
  ]

  const match = candidates.find((candidate) => fs.existsSync(candidate))
  if (!match) {
    throw new Error(`Could not find mercato bin. Checked: ${candidates.join(', ')}`)
  }

  return match
}

const MERCATO_BIN = resolveMercatoBin()

function resolveGeneratedDir(): string {
  const candidates = [
    path.join(ROOT, '.mercato', 'generated'),
    path.join(ROOT, 'apps', 'mercato', '.mercato', 'generated'),
  ]

  const match = candidates.find((candidate) => fs.existsSync(candidate))
  if (!match) {
    throw new Error(`Could not find generated output directory. Checked: ${candidates.join(', ')}`)
  }

  return match
}

const GENERATED_DIR = resolveGeneratedDir()

function runMercato(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnSync(MERCATO_BIN, args, {
    cwd: ROOT,
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

function readGeneratedOutput(filename: string): string {
  return fs.readFileSync(path.join(GENERATED_DIR, filename), 'utf8')
}

test.describe('TC-UMES-011: CLI commands', () => {
  test('umes:list shows registered extensions from example module', () => {
    const { stdout, exitCode } = runMercato(['umes:list'])
    expect(exitCode).toBe(0)

    // Should list example module extensions in the output
    expect(stdout).toContain('example')

    // Should show injection-widget or component-override entries
    expect(stdout.toLowerCase()).toMatch(/injection-widget|component-override|enricher/i)
  })

  test('umes:inspect shows extension tree for example module', () => {
    const { stdout, exitCode } = runMercato(['umes:inspect', '--module', 'example'])
    expect(exitCode).toBe(0)

    // Should show the example module header
    expect(stdout).toContain('example')

    // Should list extension type sections (title-case headers in tree output)
    expect(stdout).toMatch(/Injection Widgets|Component Overrides|Declared Features/)
  })

  test('umes:inspect reports missing modules on stderr and exits non-zero', () => {
    const { stderr, exitCode } = runMercato(['umes:inspect', '--module', 'missing-module'])
    expect(exitCode).toBe(1)
    expect(stderr).toContain('Module "missing-module" not found.')
    expect(stderr).toContain('Available modules:')
    expect(stderr).toContain('example')
  })

  test('umes:check exits 0 with no conflicts', () => {
    const { stdout, exitCode } = runMercato(['umes:check'])
    expect(exitCode).toBe(0)

    // Should indicate no errors found
    expect(stdout.toLowerCase()).toMatch(/no (conflict|error)|0 error/i)
  })

  test('generated module-registry outputs include app and package module routes', () => {
    const modulesOutput = readGeneratedOutput('modules.generated.ts')
    const frontendRoutesOutput = readGeneratedOutput('frontend-routes.generated.ts')
    const backendRoutesOutput = readGeneratedOutput('backend-routes.generated.ts')
    const apiRoutesOutput = readGeneratedOutput('api-routes.generated.ts')

    expect(modulesOutput).toContain('id: "example"')
    expect(modulesOutput).toContain('id: "customers"')
    expect(frontendRoutesOutput).toContain('pattern: "/login"')
    expect(backendRoutesOutput).toContain('pattern: "/backend/example"')
    expect(backendRoutesOutput).toContain('pattern: "/backend/customers/people"')
    expect(apiRoutesOutput).toContain('path: "/example/todos"')
    expect(apiRoutesOutput).toContain('path: "/customers/people"')
  })

  test('generated module-registry routes resolve through the live app runtime', async ({ page, request }) => {
    await page.goto('/login', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('form[data-auth-ready="1"]', { state: 'visible' })

    await login(page, 'admin')
    await page.goto('/backend/example', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: 'Example Admin' })).toBeVisible()

    const token = await getAuthToken(request, 'admin')

    const appApiResponse = await apiRequest(request, 'GET', '/api/example/todos?page=1&pageSize=1', { token })
    expect(appApiResponse.ok()).toBeTruthy()
    const appApiBody = await appApiResponse.json()
    expect(Array.isArray(appApiBody.data)).toBe(true)

    const packageApiResponse = await apiRequest(request, 'GET', '/api/customers/people?page=1&pageSize=1', { token })
    expect(packageApiResponse.ok()).toBeTruthy()
    const packageApiBody = await packageApiResponse.json()
    expect(Array.isArray(packageApiBody.data)).toBe(true)
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
