const warn = jest.fn()

jest.mock('@open-mercato/shared/lib/logger', () => {
  const logger = { warn, info: jest.fn(), error: jest.fn(), debug: jest.fn(), child: () => logger }
  return { createLogger: () => logger }
})

type FileAgentNativeModule = typeof import('../lib/sdk/fileAgentNative')

function loadFreshModule(): FileAgentNativeModule {
  let loaded: FileAgentNativeModule | undefined
  jest.isolateModules(() => {
    loaded = require('../lib/sdk/fileAgentNative') as FileAgentNativeModule
  })
  return loaded!
}

const entry = { id: 'deals.health_check_file', resultKind: 'proposal' as const }

describe('OM_AGENT_FILE_AGENT_RUNTIME=opencode deprecation warning', () => {
  const original = process.env.OM_AGENT_FILE_AGENT_RUNTIME

  beforeEach(() => {
    warn.mockClear()
    process.env.OM_AGENT_FILE_AGENT_RUNTIME = 'opencode'
    loadFreshModule().resetFileAgentRuntimeWarningForTests()
  })

  afterEach(() => {
    if (original === undefined) delete process.env.OM_AGENT_FILE_AGENT_RUNTIME
    else process.env.OM_AGENT_FILE_AGENT_RUNTIME = original
    loadFreshModule().resetFileAgentRuntimeWarningForTests()
  })

  function deprecationWarnings(): number {
    return warn.mock.calls.filter(([message]) => String(message).includes('is deprecated')).length
  }

  it('logs once per process even when the app bootstraps a second copy of the module', () => {
    const first = loadFreshModule()
    expect(first.resolveFileAgentRuntime(entry)).toBe('opencode')
    expect(first.resolveFileAgentRuntime(entry)).toBe('opencode')

    // Next.js can re-bootstrap the app in the same process with a fresh module instance.
    const second = loadFreshModule()
    expect(second).not.toBe(first)
    expect(second.resolveFileAgentRuntime(entry)).toBe('opencode')

    expect(deprecationWarnings()).toBe(1)
  })
})
