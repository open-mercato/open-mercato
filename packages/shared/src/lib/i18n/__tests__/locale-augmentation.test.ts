import * as path from 'node:path'
import * as ts from 'typescript'

// The extension point is a TYPE-level contract, so the only honest way to test
// it is to compile a downstream-app fixture and read the diagnostics. Jest runs
// with `isolatedModules: true` and therefore never type-checks, and the package
// typecheck cannot cover these fixtures either: a `declare module` augmentation
// is program-global, so including them would widen `Locale` for every other file
// in the package (and break `config.typecheck.tsx`). Hence a real, isolated
// `ts.createProgram` per fixture.
const FIXTURES_DIR = path.join(__dirname, '__fixtures__')

// Mirrors `tsconfig.base.json`; only the options that affect these diagnostics.
const COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  skipLibCheck: true,
  noEmit: true,
  esModuleInterop: true,
}

function compile(fixture: string): ts.Diagnostic[] {
  const program = ts.createProgram([path.join(FIXTURES_DIR, fixture)], COMPILER_OPTIONS)
  return [...program.getSemanticDiagnostics(), ...program.getSyntacticDiagnostics()]
}

function messages(diagnostics: ts.Diagnostic[]): string[] {
  return diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '))
}

describe('extending Locale from a downstream application', () => {
  it('lets an app add a locale the platform does not ship, with no patching', () => {
    const diagnostics = compile('locale-augmentation-ok.ts')

    expect(messages(diagnostics)).toEqual([])
  })

  it('still rejects an unshipped code when the app has NOT opted in', () => {
    const diagnostics = compile('locale-unaugmented.ts')

    expect(diagnostics).toHaveLength(1)
    expect(messages(diagnostics)[0]).toContain('"cs"')
  })

  it('preserves exhaustiveness over the app’s own extended set', () => {
    // An app that widens Locale keeps its drift guard: a Record<Locale, …> that
    // omits the locale it just added must not compile. This is the property that
    // widening `Locale` to `string` would have silently destroyed.
    const diagnostics = compile('locale-augmentation-missing-key.ts')

    expect(diagnostics).toHaveLength(1)
    expect(messages(diagnostics)[0]).toContain('cs')
  })
})
