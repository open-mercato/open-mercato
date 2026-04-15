import path from 'node:path'

const loadActualModule = () => jest.requireActual('../agentic-init') as typeof import('../agentic-init')

type AgenticInitTestContext = {
  closeInterface: jest.Mock
  createInterface: jest.Mock
  runAgenticInit: typeof import('../agentic-init').runAgenticInit
  runAgenticSetup: jest.Mock
  readlineQuestion: jest.Mock
}

const loadRunAgenticInit = async ({
  existingPaths,
  questionAnswer = '',
  runAgenticSetupImplementation,
}: {
  existingPaths: Set<string>
  questionAnswer?: string
  runAgenticSetupImplementation?: (targetDir: string, ask: (question: string) => Promise<string>, options?: { tool?: string; force?: boolean }) => Promise<void>
}): Promise<AgenticInitTestContext> => {
  jest.resetModules()

  const existsSync = jest.fn((candidatePath: string) => existingPaths.has(candidatePath))
  const closeInterface = jest.fn()
  const readlineQuestion = jest.fn((question: string, onAnswer: (answer: string) => void) => {
    onAnswer(questionAnswer)
  })
  const createInterface = jest.fn(() => ({
    close: closeInterface,
    question: readlineQuestion,
  }))
  const runAgenticSetup = jest.fn(
    runAgenticSetupImplementation ?? (async () => undefined),
  )

  jest.doMock('node:fs', () => ({
    existsSync,
  }))
  jest.doMock('node:readline', () => ({
    createInterface,
  }))
  jest.doMock('../agentic-setup.js', () => ({
    __esModule: true,
    runAgenticSetup,
  }), { virtual: true })

  const { runAgenticInit } = await import('../agentic-init')

  return {
    closeInterface,
    createInterface,
    runAgenticInit,
    runAgenticSetup,
    readlineQuestion,
  }
}

describe('resolveRelevantAgenticFiles', () => {
  it('returns only codex files for codex setup', () => {
    expect(loadActualModule().resolveRelevantAgenticFiles('codex')).toEqual([
      '.codex/mcp.json.example',
    ])
  })

  it('returns only cursor files for cursor setup', () => {
    expect(loadActualModule().resolveRelevantAgenticFiles('cursor')).toEqual([
      '.cursor/hooks.json',
    ])
  })

  it('returns combined files for multiple selected tools', () => {
    expect(loadActualModule().resolveRelevantAgenticFiles('claude-code,cursor')).toEqual([
      'CLAUDE.md',
      '.claude/settings.json',
      '.mcp.json.example',
      '.cursor/hooks.json',
    ])
  })

  it('trims tool ids and removes duplicates', () => {
    expect(loadActualModule().resolveRelevantAgenticFiles(' codex , cursor , codex ')).toEqual([
      '.codex/mcp.json.example',
      '.cursor/hooks.json',
    ])
  })

  it('falls back to the full known file list when no tool is provided', () => {
    expect(loadActualModule().resolveRelevantAgenticFiles()).toEqual([
      'CLAUDE.md',
      '.claude/settings.json',
      '.mcp.json.example',
      '.codex/mcp.json.example',
      '.cursor/hooks.json',
    ])
  })

  it('falls back to the full known file list when all selected tools are unknown', () => {
    expect(loadActualModule().resolveRelevantAgenticFiles('unknown-tool')).toEqual([
      'CLAUDE.md',
      '.claude/settings.json',
      '.mcp.json.example',
      '.codex/mcp.json.example',
      '.cursor/hooks.json',
    ])
  })
})

describe('runAgenticInit', () => {
  const targetDir = path.resolve('.')
  const appModulesPath = path.join(targetDir, 'src', 'modules.ts')
  const codexConfigPath = path.join(targetDir, '.codex', 'mcp.json.example')
  const cursorHooksPath = path.join(targetDir, '.cursor', 'hooks.json')

  afterEach(() => {
    jest.restoreAllMocks()
    jest.resetModules()
    jest.dontMock('node:fs')
    jest.dontMock('node:readline')
    jest.dontMock('../agentic-setup.js')
  })

  it('returns an error when the current directory is not an Open Mercato app', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
    const testContext = await loadRunAgenticInit({
      existingPaths: new Set<string>(),
    })

    const exitCode = await testContext.runAgenticInit([])

    expect(exitCode).toBe(1)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '❌  Not an Open Mercato app directory (src/modules.ts not found)',
    )
    expect(testContext.createInterface).not.toHaveBeenCalled()
    expect(testContext.runAgenticSetup).not.toHaveBeenCalled()
  })

  it('warns and exits early when relevant agentic files already exist without force', async () => {
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()
    const testContext = await loadRunAgenticInit({
      existingPaths: new Set<string>([appModulesPath, codexConfigPath]),
    })

    const exitCode = await testContext.runAgenticInit(['--tool=codex'])

    expect(exitCode).toBe(0)
    expect(testContext.createInterface).not.toHaveBeenCalled()
    expect(testContext.runAgenticSetup).not.toHaveBeenCalled()
    expect(consoleLogSpy.mock.calls.flat()).toEqual(expect.arrayContaining([
      '⚠️  Agentic files already exist:',
      '   • .codex/mcp.json.example',
      'Run with --force to regenerate from current templates.',
    ]))
  })

  it('invokes setup with parsed options and trims readline answers passed to ask', async () => {
    const testContext = await loadRunAgenticInit({
      existingPaths: new Set<string>([appModulesPath]),
      questionAnswer: '  cursor  ',
      runAgenticSetupImplementation: async (currentTargetDir, ask, options) => {
        expect(currentTargetDir).toBe(targetDir)
        expect(options).toEqual({ tool: undefined, force: undefined })
        await expect(ask('Select a tool')).resolves.toBe('cursor')
      },
    })

    const exitCode = await testContext.runAgenticInit([])

    expect(exitCode).toBe(0)
    expect(testContext.createInterface).toHaveBeenCalledTimes(1)
    expect(testContext.readlineQuestion).toHaveBeenCalledWith(
      'Select a tool',
      expect.any(Function),
    )
    expect(testContext.closeInterface).toHaveBeenCalledTimes(1)
  })

  it('ignores existing files from other tool selections when checking for overwrite warnings', async () => {
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()
    const testContext = await loadRunAgenticInit({
      existingPaths: new Set<string>([appModulesPath, cursorHooksPath]),
    })

    const exitCode = await testContext.runAgenticInit(['--tool', 'codex'])

    expect(exitCode).toBe(0)
    expect(testContext.runAgenticSetup).toHaveBeenCalledWith(
      targetDir,
      expect.any(Function),
      { tool: 'codex', force: undefined },
    )
    expect(consoleLogSpy.mock.calls.flat()).not.toContain('⚠️  Agentic files already exist:')
    expect(testContext.closeInterface).toHaveBeenCalledTimes(1)
  })

  it('bypasses overwrite warnings when force is provided', async () => {
    const testContext = await loadRunAgenticInit({
      existingPaths: new Set<string>([appModulesPath, codexConfigPath]),
    })

    const exitCode = await testContext.runAgenticInit(['--tool', 'codex', '--force'])

    expect(exitCode).toBe(0)
    expect(testContext.runAgenticSetup).toHaveBeenCalledWith(
      targetDir,
      expect.any(Function),
      { tool: 'codex', force: true },
    )
    expect(testContext.closeInterface).toHaveBeenCalledTimes(1)
  })

  it('closes the readline interface when setup fails', async () => {
    const setupError = new Error('setup failed')
    const testContext = await loadRunAgenticInit({
      existingPaths: new Set<string>([appModulesPath]),
      runAgenticSetupImplementation: async () => {
        throw setupError
      },
    })

    await expect(testContext.runAgenticInit(['--tool=codex'])).rejects.toThrow(setupError)
    expect(testContext.closeInterface).toHaveBeenCalledTimes(1)
  })
})
