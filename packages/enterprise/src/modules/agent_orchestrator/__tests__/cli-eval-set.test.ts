import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import type { EvalGateInput, EvalGateResult } from '../lib/eval/evalGate'
import { manifestFromFile, validateEvalSetFile, type EvalSetFile } from '../lib/eval/evalSetFile'
import { downgradeJudgeGateAssertions, readEvalSetFile } from '../lib/eval/evalSetFileIo'
import { parseEvalSetText, stringifyEvalSetFile } from '../lib/eval/evalSetYaml'
import {
  EVAL_SET_FORMAT,
  EVAL_SET_FORMAT_VERSION,
  EvalSetUnresolvedError,
  type EvalSetManifest,
} from '../lib/eval/manifest'

const mockRunEvalGate = jest.fn<Promise<EvalGateResult>, [unknown, EvalGateInput]>()
const mockResolveSnapshotPin = jest.fn<Promise<{ manifest: EvalSetManifest; version: string }>, unknown[]>()
const mockCreateRequestContainer = jest.fn(async () => ({
  resolve: (key: string) => (key === 'em' ? { fork: () => ({ forked: true }) } : undefined),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: () => mockCreateRequestContainer(),
}))

jest.mock('../lib/eval/evalGate', () => ({
  runEvalGate: (container: unknown, input: EvalGateInput) => mockRunEvalGate(container, input),
}))

jest.mock('../lib/eval/manifest', () => {
  const actual = jest.requireActual('../lib/eval/manifest')
  return { ...actual, resolveSnapshotPin: (...args: unknown[]) => mockResolveSnapshotPin(...args) }
})

jest.mock('../lib/processes/processProjection', () => ({
  recomputeProcessInstance: jest.fn(),
}))

jest.mock('../data/entities', () => ({
  AgentCorrection: class {},
  AgentProposal: class {},
  AgentRun: class {},
  AgentSpan: class {},
  AgentToolCall: class {},
}))

import cliCommands from '../cli'

const AGENT = 'content_review.validator'
const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const scopeArgs = ['--agent', AGENT, '--tenant', TENANT_ID, '--org', ORG_ID]

function sampleFile(): EvalSetFile {
  return {
    format: EVAL_SET_FORMAT,
    formatVersion: EVAL_SET_FORMAT_VERSION,
    agentId: AGENT,
    label: 'regression-set',
    assertions: [
      { key: 'schema', scorerKey: 'output_present', type: 'deterministic', severity: 'gate', title: 'Output present', config: {} },
      {
        key: 'rationale',
        scorerKey: 'llm_judge',
        type: 'llm_judge',
        severity: 'warn',
        title: 'Rationale quality',
        config: { rubric: 'Does the rationale cite the evidence?' },
      },
    ],
    cases: [
      { key: 'banned-phrase-01', name: 'Guaranteed returns', input: { content: 'Guaranteed 20% returns' }, assertions: [{ key: 'schema' }] },
      { key: 'clean-01', input: { content: 'Capital at risk.' } },
    ],
  }
}

function dbManifest(judgeSeverity: 'gate' | 'warn'): EvalSetManifest {
  return {
    format: EVAL_SET_FORMAT,
    formatVersion: EVAL_SET_FORMAT_VERSION,
    agentId: AGENT,
    label: null,
    source: 'db',
    assertions: [
      {
        id: '33333333-3333-4333-8333-333333333333',
        key: 'schema',
        scorerKey: 'output_present',
        type: 'deterministic',
        severity: 'gate',
        title: 'Output present',
        config: {},
      },
      {
        id: '44444444-4444-4444-8444-444444444444',
        key: 'tone',
        scorerKey: 'llm_judge',
        type: 'llm_judge',
        severity: judgeSeverity,
        title: 'Tone',
        config: { rubric: 'Is the tone neutral?' },
      },
    ],
    cases: [
      {
        id: '55555555-5555-4555-8555-555555555555',
        key: '55555555-5555-4555-8555-555555555555',
        name: 'Case one',
        input: { content: 'hello' },
        expected: null,
        assertions: null,
      },
    ],
  }
}

function command(name: string): ModuleCli {
  const entry = cliCommands.find((candidate) => candidate.command === name)
  if (!entry) throw new Error(`${name} command missing`)
  return entry
}

async function run(name: string, argv: string[]): Promise<number | undefined> {
  process.exitCode = undefined
  await command(name).run(argv)
  const code = process.exitCode
  process.exitCode = undefined
  return code === undefined ? undefined : Number(code)
}

function gateResult(): EvalGateResult {
  return {
    suiteRunId: 'suite-1',
    passScore: 1,
    safetyRegressions: [],
    outcome: 'passed',
    caseRunCount: 2,
    errorCount: 0,
    baselineSuiteRunId: null,
  }
}

describe('agent_orchestrator eval-set CLI', () => {
  let workDir: string
  let errors: string[]
  let logs: string[]
  let stdout: string[]
  const originalEnv = { ...process.env }

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-eval-set-cli-'))
    mockRunEvalGate.mockReset()
    mockResolveSnapshotPin.mockReset()
    mockCreateRequestContainer.mockClear()
    errors = []
    logs = []
    stdout = []
    jest.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => {
      errors.push(parts.map(String).join(' '))
    })
    jest.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
      logs.push(parts.map(String).join(' '))
    })
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stdout.push(String(chunk))
      return true
    })
    delete process.env.OM_EVAL_TENANT_ID
    delete process.env.OM_EVAL_ORG_ID
    delete process.env.OM_AGENT_EVAL_SET_MAX_BYTES
  })

  afterEach(() => {
    fs.rmSync(workDir, { recursive: true, force: true })
    jest.restoreAllMocks()
    process.env = { ...originalEnv }
  })

  function writeFile(name: string, content: string): string {
    const filePath = path.join(workDir, name)
    fs.writeFileSync(filePath, content, 'utf8')
    return filePath
  }

  describe('eval --cases', () => {
    it('reads a YAML file and passes it to runEvalGate pinned by its hash', async () => {
      mockRunEvalGate.mockResolvedValue(gateResult())
      const filePath = writeFile('regression.yaml', stringifyEvalSetFile(sampleFile(), 'yaml'))
      const code = await run('eval', [...scopeArgs, '--cases', filePath, '--gate', 'true', '--require-snapshot', 'true'])
      expect(code).toBeUndefined()
      expect(mockRunEvalGate).toHaveBeenCalledTimes(1)
      const input = mockRunEvalGate.mock.calls[0][1]
      expect(input.cases).toEqual(parseEvalSetText(stringifyEvalSetFile(sampleFile(), 'json')))
      expect(input.snapshot).toBeUndefined()
      expect(input.evalSetVersion).toBeUndefined()
    })

    it('resolves a relative path against the working directory', async () => {
      mockRunEvalGate.mockResolvedValue(gateResult())
      writeFile('regression.json', stringifyEvalSetFile(sampleFile(), 'json'))
      jest.spyOn(process, 'cwd').mockReturnValue(workDir)
      const code = await run('eval', [...scopeArgs, '--cases', 'regression.json'])
      expect(code).toBeUndefined()
      expect(mockRunEvalGate.mock.calls[0][1].cases?.agentId).toBe(AGENT)
    })

    it('exits 2 without running on an invalid file and prints issue codes', async () => {
      const broken = { ...sampleFile(), assertions: [{ ...sampleFile().assertions[1], severity: 'gate' }] }
      const filePath = writeFile('broken.json', JSON.stringify(broken))
      const code = await run('eval', [...scopeArgs, '--cases', filePath, '--gate', 'true'])
      expect(code).toBe(2)
      expect(mockRunEvalGate).not.toHaveBeenCalled()
      expect(errors.join('\n')).toContain('[judge_gate_refused] assertions.0.severity')
    })

    it('exits 2 for a file of another agent, a missing file, or a pin conflict', async () => {
      const otherAgent = writeFile('other.json', JSON.stringify({ ...sampleFile(), agentId: 'other.agent' }))
      expect(await run('eval', [...scopeArgs, '--cases', otherAgent])).toBe(2)
      expect(await run('eval', [...scopeArgs, '--cases', path.join(workDir, 'missing.json')])).toBe(2)
      const valid = writeFile('valid.json', JSON.stringify(sampleFile()))
      expect(await run('eval', [...scopeArgs, '--cases', valid, '--snapshot', 'latest'])).toBe(2)
      expect(await run('eval', [...scopeArgs, '--cases', valid, '--eval-set-version', 'v1'])).toBe(2)
      expect(mockRunEvalGate).not.toHaveBeenCalled()
    })
  })

  describe('eval-set validate', () => {
    it('exits 0 on a valid file and prints its manifest hash without touching the database', async () => {
      const filePath = writeFile('regression.yml', stringifyEvalSetFile(sampleFile(), 'yaml'))
      const code = await run('eval-set', ['validate', filePath])
      expect(code).toBeUndefined()
      expect(logs.join('\n')).toContain(manifestFromFile(sampleFile()).version)
      expect(mockCreateRequestContainer).not.toHaveBeenCalled()
    })

    it('accepts --file as well as a positional path', async () => {
      const filePath = writeFile('regression.json', JSON.stringify(sampleFile()))
      expect(await run('eval-set', ['validate', '--file', filePath])).toBeUndefined()
    })

    it('exits 2 and lists issue codes and paths on an invalid file', async () => {
      const broken = { ...sampleFile(), cases: [{ key: 'a', input: {}, assertions: [{ key: 'nope' }] }] }
      const filePath = writeFile('broken.json', JSON.stringify(broken))
      const code = await run('eval-set', ['validate', filePath])
      expect(code).toBe(2)
      expect(errors.join('\n')).toContain('[unknown_assertion_ref] cases.0.assertions.0')
      expect(mockCreateRequestContainer).not.toHaveBeenCalled()
    })

    it('exits 2 on unsupported extensions, directories, oversize files and missing paths', async () => {
      expect(await run('eval-set', ['validate', writeFile('cases.txt', JSON.stringify(sampleFile()))])).toBe(2)
      const directory = path.join(workDir, 'dir.json')
      fs.mkdirSync(directory)
      expect(await run('eval-set', ['validate', directory])).toBe(2)
      expect(errors.join('\n')).toContain('not a regular file')
      process.env.OM_AGENT_EVAL_SET_MAX_BYTES = '64'
      expect(await run('eval-set', ['validate', writeFile('big.json', JSON.stringify(sampleFile()))])).toBe(2)
      expect(errors.join('\n')).toContain('[eval_set_too_large]')
      expect(await run('eval-set', ['validate'])).toBe(2)
    })

    it('exits 2 on an unknown subcommand', async () => {
      expect(await run('eval-set', ['import'])).toBe(2)
    })
  })

  describe('eval-set export', () => {
    it('writes the current DB set to --out in the format of its extension', async () => {
      mockResolveSnapshotPin.mockResolvedValue({ manifest: dbManifest('warn'), version: 'sha256:current' })
      const outPath = path.join(workDir, 'nested', 'export.yaml')
      const code = await run('eval-set', ['export', ...scopeArgs, '--out', outPath])
      expect(code).toBeUndefined()
      expect(mockResolveSnapshotPin.mock.calls[0].slice(1)).toEqual([
        { tenantId: TENANT_ID, organizationId: ORG_ID },
        AGENT,
        'latest',
      ])
      const read = readEvalSetFile(outPath)
      expect(read.ok).toBe(true)
      if (!read.ok) return
      expect(read.format).toBe('yaml')
      expect(read.file.cases.map((entry) => entry.key)).toEqual(['55555555-5555-4555-8555-555555555555'])
    })

    it('prints JSON to stdout by default and honours an explicit --format and sha256 snapshot', async () => {
      const snapshot = `sha256:${'a'.repeat(64)}`
      mockResolveSnapshotPin.mockResolvedValue({ manifest: dbManifest('warn'), version: snapshot })
      expect(await run('eval-set', ['export', ...scopeArgs, '--snapshot', snapshot])).toBeUndefined()
      expect(mockResolveSnapshotPin.mock.calls[0][3]).toBe(snapshot)
      expect(validateEvalSetFile(JSON.parse(stdout.join(''))).ok).toBe(true)
      stdout = []
      expect(await run('eval-set', ['export', ...scopeArgs, '--format', 'yaml'])).toBeUndefined()
      expect(parseEvalSetText(stdout.join(''), { format: 'yaml' }).agentId).toBe(AGENT)
    })

    it('downgrades a judge assertion stored with gate severity to warn and warns with its key', async () => {
      mockResolveSnapshotPin.mockResolvedValue({ manifest: dbManifest('gate'), version: 'sha256:current' })
      const outPath = path.join(workDir, 'export.json')
      const code = await run('eval-set', ['export', ...scopeArgs, '--out', outPath])
      expect(code).toBeUndefined()
      expect(errors.join('\n')).toMatch(/llm_judge assertions cannot gate.*tone/)
      const read = readEvalSetFile(outPath)
      expect(read.ok).toBe(true)
      if (!read.ok) return
      expect(read.file.assertions.find((assertion) => assertion.key === 'tone')?.severity).toBe('warn')
      expect(read.file.assertions.find((assertion) => assertion.key === 'schema')?.severity).toBe('gate')
    })

    it('exits 2 on usage errors and an unknown snapshot, 1 on an unexpected failure', async () => {
      expect(await run('eval-set', ['export', '--agent', AGENT])).toBe(2)
      expect(await run('eval-set', ['export', ...scopeArgs, '--format', 'xml'])).toBe(2)
      expect(await run('eval-set', ['export', ...scopeArgs, '--snapshot', 'v1'])).toBe(2)
      expect(mockResolveSnapshotPin).not.toHaveBeenCalled()
      const snapshot = `sha256:${'b'.repeat(64)}`
      mockResolveSnapshotPin.mockRejectedValueOnce(new EvalSetUnresolvedError(snapshot))
      expect(await run('eval-set', ['export', ...scopeArgs, '--snapshot', snapshot])).toBe(2)
      mockResolveSnapshotPin.mockRejectedValueOnce(new Error('db down'))
      expect(await run('eval-set', ['export', ...scopeArgs])).toBe(1)
    })

    it('falls back to OM_EVAL_TENANT_ID/OM_EVAL_ORG_ID for scope', async () => {
      process.env.OM_EVAL_TENANT_ID = TENANT_ID
      process.env.OM_EVAL_ORG_ID = ORG_ID
      mockResolveSnapshotPin.mockResolvedValue({ manifest: dbManifest('warn'), version: 'sha256:current' })
      expect(await run('eval-set', ['export', '--agent', AGENT])).toBeUndefined()
    })
  })

  describe('downgradeJudgeGateAssertions', () => {
    it('leaves a file without judge gates untouched', () => {
      const file = sampleFile()
      const result = downgradeJudgeGateAssertions(file)
      expect(result.downgradedKeys).toEqual([])
      expect(result.file).toBe(file)
    })
  })
})
