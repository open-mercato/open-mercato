import type { Module } from '@open-mercato/shared/modules/registry'
import { registerCliModules } from '@open-mercato/shared/modules/registry'
import { checkAclSetupAlignment, runGate, printResults } from '../cli'

jest.mock('node:child_process', () => ({
  execSync: jest.fn(),
}))

import { execSync } from 'node:child_process'
const mockExecSync = execSync as jest.MockedFunction<typeof execSync>

beforeEach(() => {
  registerCliModules([])
  mockExecSync.mockReset()
})

afterEach(() => {
  registerCliModules([])
})

describe('checkAclSetupAlignment', () => {
  it('returns warn when module is not in registry', () => {
    const result = checkAclSetupAlignment('unknown_module')
    expect(result.ok).toBe(true)
    expect(result.warn).toBe(true)
    expect(result.note).toMatch(/not found in registry/)
  })

  it('returns ok with note when module has no features', () => {
    const mod: Module = { id: 'empty_module' }
    registerCliModules([mod])
    const result = checkAclSetupAlignment('empty_module')
    expect(result.ok).toBe(true)
    expect(result.warn).toBeUndefined()
    expect(result.note).toMatch(/no features declared/)
  })

  it('returns fail+warn when features are declared but none granted', () => {
    const mod: Module = {
      id: 'no_grants',
      features: [{ id: 'no_grants.item.view', title: 'View', module: 'no_grants' }],
    }
    registerCliModules([mod])
    const result = checkAclSetupAlignment('no_grants')
    expect(result.ok).toBe(false)
    expect(result.warn).toBe(true)
    expect(result.note).toContain('no_grants.item.view')
  })

  it('returns fail+warn listing only the ungranted features', () => {
    const mod: Module = {
      id: 'partial',
      features: [
        { id: 'partial.item.view', title: 'View', module: 'partial' },
        { id: 'partial.item.manage', title: 'Manage', module: 'partial' },
      ],
      setup: { defaultRoleFeatures: { admin: ['partial.item.view'] } },
    }
    registerCliModules([mod])
    const result = checkAclSetupAlignment('partial')
    expect(result.ok).toBe(false)
    expect(result.warn).toBe(true)
    expect(result.note).toContain('partial.item.manage')
    expect(result.note).not.toContain('partial.item.view')
  })

  it('returns ok when all features are granted in a single role', () => {
    const mod: Module = {
      id: 'full',
      features: [
        { id: 'full.item.view', title: 'View', module: 'full' },
        { id: 'full.item.manage', title: 'Manage', module: 'full' },
      ],
      setup: { defaultRoleFeatures: { admin: ['full.item.view', 'full.item.manage'] } },
    }
    registerCliModules([mod])
    const result = checkAclSetupAlignment('full')
    expect(result.ok).toBe(true)
    expect(result.warn).toBeUndefined()
  })

  it('returns ok when features are split across multiple roles', () => {
    const mod: Module = {
      id: 'split',
      features: [
        { id: 'split.item.view', title: 'View', module: 'split' },
        { id: 'split.item.manage', title: 'Manage', module: 'split' },
      ],
      setup: {
        defaultRoleFeatures: {
          admin: ['split.item.manage'],
          employee: ['split.item.view'],
        },
      },
    }
    registerCliModules([mod])
    const result = checkAclSetupAlignment('split')
    expect(result.ok).toBe(true)
  })
})

describe('runGate generate-failure short-circuit', () => {
  it('marks all downstream steps as skipped when generate fails', async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (String(cmd).includes('generate')) throw new Error('generate failed')
      return Buffer.from('')
    })
    const results = await runGate('/tmp', false, null)
    expect(results[0]).toMatchObject({ label: 'yarn generate', ok: false })
    for (const r of results.slice(1)) {
      expect(r.ok).toBe(false)
      expect(r.note).toMatch(/skipped.*generate failed/)
    }
  })

  it('does not set process.exitCode itself — printResults is responsible', async () => {
    mockExecSync.mockImplementation(() => { throw new Error('fail') })
    const saved = process.exitCode
    process.exitCode = undefined
    await runGate('/tmp', false, null)
    expect(process.exitCode).toBeUndefined()
    process.exitCode = saved
  })
})

describe('printResults exit-code contract', () => {
  it('sets process.exitCode = 1 on hard failure', () => {
    const saved = process.exitCode
    process.exitCode = undefined
    printResults([{ label: 'step', ok: false }])
    expect(process.exitCode).toBe(1)
    process.exitCode = saved
  })

  it('does not set process.exitCode for warn-only results', () => {
    const saved = process.exitCode
    process.exitCode = undefined
    printResults([{ label: 'step', ok: false, warn: true }])
    expect(process.exitCode).toBeUndefined()
    process.exitCode = saved
  })

  it('does not set process.exitCode when all steps pass', () => {
    const saved = process.exitCode
    process.exitCode = undefined
    printResults([{ label: 'step', ok: true }])
    expect(process.exitCode).toBeUndefined()
    process.exitCode = saved
  })
})
