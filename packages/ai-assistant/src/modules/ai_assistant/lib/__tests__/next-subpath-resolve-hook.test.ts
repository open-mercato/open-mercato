import {
  installNextSubpathResolveHook,
  resetNextSubpathResolveHookForTests,
  resolveNextSubpath,
  resolveNextSubpathAsync,
} from '../next-subpath-resolve-hook'

function notFound(specifier: string): Error & { code: string } {
  return Object.assign(new Error(`Cannot find module '${specifier}'`), { code: 'ERR_MODULE_NOT_FOUND' })
}

describe('resolveNextSubpath (#6238 / #6118)', () => {
  const context = { parentURL: 'file:///app/route.js' }

  it('leaves specifiers other than next/<subpath> to the default resolver', () => {
    const nextResolve = jest.fn(() => ({ url: 'file:///app/node_modules/zod/index.js' }))

    const result = resolveNextSubpath('zod', context, nextResolve)

    expect(result.url).toBe('file:///app/node_modules/zod/index.js')
    expect(nextResolve).toHaveBeenCalledTimes(1)
    expect(nextResolve).toHaveBeenCalledWith('zod', context)
  })

  it('does not touch a next/<subpath> that resolves on its own', () => {
    // The day `next` ships an exports map the hook must step aside.
    const nextResolve = jest.fn(() => ({ url: 'file:///app/node_modules/next/server.js' }))

    resolveNextSubpath('next/server', context, nextResolve)

    expect(nextResolve).toHaveBeenCalledTimes(1)
  })

  it('retries a bare next/<subpath> with the .js suffix when Node cannot resolve it', () => {
    // `next` has no exports map and Node ESM does no extension guessing, so
    // `next/server` fails while `next/server.js` is a real file.
    const nextResolve = jest
      .fn()
      .mockImplementationOnce(() => { throw notFound('/app/node_modules/next/server') })
      .mockImplementationOnce(() => ({ url: 'file:///app/node_modules/next/server.js' }))

    const result = resolveNextSubpath('next/server', context, nextResolve)

    expect(result.url).toBe('file:///app/node_modules/next/server.js')
    expect(nextResolve).toHaveBeenNthCalledWith(1, 'next/server', context)
    expect(nextResolve).toHaveBeenNthCalledWith(2, 'next/server.js', context)
  })

  it('covers the other subpaths route modules import', () => {
    for (const subpath of ['next/headers', 'next/navigation', 'next/cache']) {
      const nextResolve = jest
        .fn()
        .mockImplementationOnce(() => { throw notFound(subpath) })
        .mockImplementationOnce((resolvedSpecifier: string) => ({
          url: `file:///app/node_modules/${resolvedSpecifier}`,
        }))
      expect(resolveNextSubpath(subpath, context, nextResolve).url).toBe(`file:///app/node_modules/${subpath}.js`)
    }
  })

  it('does not retry deeper or already-suffixed specifiers', () => {
    for (const specifier of ['next/server.js', 'next/dist/server/web/spec-extension/response', 'next']) {
      const nextResolve = jest.fn(() => { throw notFound(specifier) })
      expect(() => resolveNextSubpath(specifier, context, nextResolve)).toThrow(/Cannot find module/)
      expect(nextResolve).toHaveBeenCalledTimes(1)
    }
  })

  it('rethrows the original error when the .js form is missing too', () => {
    const original = notFound('/app/node_modules/next/server')
    const nextResolve = jest
      .fn()
      .mockImplementationOnce(() => { throw original })
      .mockImplementationOnce(() => { throw notFound('/app/node_modules/next/server.js') })

    expect(() => resolveNextSubpath('next/server', context, nextResolve)).toThrow(original)
  })

  it('rethrows errors that are not ERR_MODULE_NOT_FOUND without retrying', () => {
    const syntaxError = Object.assign(new Error('bad package.json'), { code: 'ERR_INVALID_PACKAGE_CONFIG' })
    const nextResolve = jest.fn(() => { throw syntaxError })

    expect(() => resolveNextSubpath('next/server', context, nextResolve)).toThrow(syntaxError)
    expect(nextResolve).toHaveBeenCalledTimes(1)
  })
})

describe('installNextSubpathResolveHook', () => {
  beforeEach(() => {
    resetNextSubpathResolveHookForTests()
  })

  it('registers the resolve hook once per process', () => {
    const register = jest.fn()

    expect(installNextSubpathResolveHook(register, null)).toBe(true)
    expect(installNextSubpathResolveHook(register, null)).toBe(false)

    expect(register).toHaveBeenCalledTimes(1)
    expect(register).toHaveBeenCalledWith({ resolve: resolveNextSubpath })
  })

  it('registers an asynchronous hook on Node 22.0-22.14', () => {
    const registerHookModule = jest.fn()

    expect(installNextSubpathResolveHook(null, registerHookModule)).toBe(true)
    expect(registerHookModule).toHaveBeenCalledWith(
      expect.objectContaining({ href: expect.stringMatching(/next-subpath-resolve-hook-worker\.js$/) }),
      expect.stringMatching(/^file:/),
    )
  })

  it('is a no-op on a runtime without either registration API', () => {
    expect(installNextSubpathResolveHook(null, null)).toBe(false)
  })
})

describe('resolveNextSubpathAsync', () => {
  const context = { parentURL: 'file:///app/route.js' }

  it('retries a bare next/<subpath> with the .js suffix', async () => {
    const nextResolve = jest
      .fn()
      .mockRejectedValueOnce(notFound('/app/node_modules/next/server'))
      .mockResolvedValueOnce({ url: 'file:///app/node_modules/next/server.js' })

    const result = await resolveNextSubpathAsync('next/server', context, nextResolve)

    expect(result.url).toBe('file:///app/node_modules/next/server.js')
    expect(nextResolve).toHaveBeenNthCalledWith(1, 'next/server', context)
    expect(nextResolve).toHaveBeenNthCalledWith(2, 'next/server.js', context)
  })
})

describe('installNextSubpathResolveHook against the runtime node:module', () => {
  afterEach(() => {
    jest.dontMock('node:module')
    jest.resetModules()
  })

  it('installs through node:module.register on Node 22.0-22.14', () => {
    // A named import of `registerHooks` would throw while the module loads on
    // such a runtime; the helper must load and use the older registration API.
    jest.resetModules()
    const register = jest.fn()
    jest.doMock('node:module', () => ({ register }))
    let installed: boolean | undefined
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const hookModule = require('../next-subpath-resolve-hook') as typeof import('../next-subpath-resolve-hook')
      installed = hookModule.installNextSubpathResolveHook()
    })
    expect(installed).toBe(true)
    expect(register).toHaveBeenCalledTimes(1)
    expect(register.mock.calls[0][0]).toEqual(
      expect.objectContaining({ href: expect.stringMatching(/next-subpath-resolve-hook-worker\.js$/) }),
    )
  })

  it('installs through node:module.registerHooks when the runtime has it', () => {
    jest.resetModules()
    const register = jest.fn()
    jest.doMock('node:module', () => ({ registerHooks: register }))
    let installed: boolean | undefined
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const hookModule = require('../next-subpath-resolve-hook') as typeof import('../next-subpath-resolve-hook')
      installed = hookModule.installNextSubpathResolveHook()
    })
    expect(installed).toBe(true)
    expect(register).toHaveBeenCalledTimes(1)
    expect(register.mock.calls[0][0]).toEqual({ resolve: expect.any(Function) })
  })
})
