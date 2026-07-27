import { runSandboxedScript } from '../lib/runtime/sandboxedScript'

// Phase 5: agent-local scripts/tool-files run in the Code Mode isolated-vm
// sandbox. Security is the contract: a script is a pure function of its args and
// MUST NOT reach fs/net/require/process or escape the isolate. These tests
// exercise the REAL sandbox (no mock). Timeout enforcement (30s wall clock) is
// owned + tested by the underlying ai-assistant sandbox; here we assert the
// correctness path and that host/Node capabilities are unreachable.
describe('runSandboxedScript', () => {
  it('runs a pure run(args) function and returns its value', async () => {
    const source = 'function run(args){ return { doubled: args.n * 2 } }'
    const result = await runSandboxedScript({ source, args: { n: 21 } })
    expect(result).toEqual({ ok: true, result: { doubled: 42 } })
  })

  it('supports the arrow `const run = (args) => ...` binding form', async () => {
    const source = 'const run = (args) => ({ sum: args.a + args.b })'
    const result = await runSandboxedScript({ source, args: { a: 2, b: 3 } })
    expect(result).toEqual({ ok: true, result: { sum: 5 } })
  })

  it('reports a usage error when the source defines no run()', async () => {
    const result = await runSandboxedScript({ source: 'const x = 1', args: null })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('no_run_export')
  })

  it('blocks require (no module loading inside the isolate)', async () => {
    const source = "function run(){ const fs = require('fs'); return fs.readdirSync('/') }"
    const result = await runSandboxedScript({ source, args: null })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('script_error')
  })

  it('blocks process / host globals', async () => {
    const source = 'function run(){ return process.env }'
    const result = await runSandboxedScript({ source, args: null })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('script_error')
  })

  it('blocks network access (fetch is absent)', async () => {
    const source = "function run(){ return fetch('http://example.com') }"
    const result = await runSandboxedScript({ source, args: null })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('script_error')
  })

  it('surfaces a thrown script error as data, not a throw', async () => {
    const source = "function run(){ throw new Error('boom') }"
    const result = await runSandboxedScript({ source, args: null })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('script_error')
      expect(result.error).toContain('boom')
    }
  })
})
