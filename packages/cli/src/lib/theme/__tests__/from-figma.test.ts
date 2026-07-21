import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { runThemeInit } from '../init'
import {
  makeStdinAsk,
  parseMapFlag,
  parseThemeFromFigmaArgs,
  PromptAbortedError,
  runThemeFromFigma,
  type AskFn,
} from '../from-figma'
import {
  createFigmaFixtureFetch,
  FIXTURE_FILE_KEY,
  FIXTURE_NOW,
} from './fixtures/figma-fixture-fetch'

const SENTINEL_TOKEN = 'figd_super_secret_sentinel'

describe('parseThemeFromFigmaArgs', () => {
  it('parses the positional file ref plus flags', () => {
    const flags = parseThemeFromFigmaArgs([
      'https://www.figma.com/design/abc12345/Acme',
      '--map', 'primary=#0C71C6',
      '--report-only',
      '--extract-json=out/extract.json',
      '--report', 'out/report.md',
      '--pages', 'Brand,Marketing',
      '--out', 'src/app/theme.css',
      '--force',
      '--dry-run',
    ])
    expect(flags).toMatchObject({
      fileRef: 'https://www.figma.com/design/abc12345/Acme',
      map: 'primary=#0C71C6',
      reportOnly: true,
      extractJson: 'out/extract.json',
      report: 'out/report.md',
      pages: 'Brand,Marketing',
      out: 'src/app/theme.css',
      force: true,
      dryRun: true,
      unknown: [],
    })
  })

  it('collects unknown flags and extra positionals', () => {
    const flags = parseThemeFromFigmaArgs(['key12345', 'extra', '--nope'])
    expect(flags.fileRef).toBe('key12345')
    expect(flags.unknown).toEqual(['extra', '--nope'])
  })

  it('hard-errors on empty =values instead of silently degrading', () => {
    // `--map=` used to degrade to report-only; `--extract-json=` used to
    // resolve to the cwd and crash EISDIR after a full fetch.
    expect(parseThemeFromFigmaArgs(['key12345', '--map=']).unknown).toEqual(['--map (empty value)'])
    expect(parseThemeFromFigmaArgs(['key12345', '--extract-json=']).unknown).toEqual(['--extract-json (empty value)'])
    expect(parseThemeFromFigmaArgs(['key12345', '--map', '']).unknown).toEqual(['--map (empty value)'])
  })
})

describe('parseMapFlag', () => {
  it('parses valid pairs including fonts and radius', () => {
    const parsed = parseMapFlag('primary=#0C71C6,primary-foreground=#FFFFFF,radius=8px,font=Inter,font-mono=JetBrains Mono')
    expect(parsed.errors).toEqual([])
    expect(parsed.mapping).toEqual({
      primary: '#0c71c6',
      primaryForeground: '#ffffff',
      radius: '8px',
      font: 'Inter',
      fontMono: 'JetBrains Mono',
    })
  })

  it('rejects unknown keys, malformed hex, invalid radius, and missing primary', () => {
    expect(parseMapFlag('accent=#123456').errors.join('\n')).toContain('Unknown --map key "accent"')
    expect(parseMapFlag('primary=blue').errors.join('\n')).toContain('Invalid --map primary')
    expect(parseMapFlag('primary=#0C71C6,radius=50%').errors.join('\n')).toContain('Invalid --map radius')
    expect(parseMapFlag('radius=8px').errors.join('\n')).toContain('Missing --map primary')
  })

  it('normalizes 3-digit hex to 6-digit for primary and primary-foreground', () => {
    const parsed = parseMapFlag('primary=#FFF,primary-foreground=#0aF')
    expect(parsed.errors).toEqual([])
    expect(parsed.mapping.primary).toBe('#ffffff')
    expect(parsed.mapping.primaryForeground).toBe('#00aaff')
  })

  it('warns on duplicate keys; the later value wins', () => {
    const parsed = parseMapFlag('primary=#123456,primary=#0c71c6')
    expect(parsed.errors).toEqual([])
    expect(parsed.warnings.join('\n')).toContain('Duplicate --map key "primary"')
    expect(parsed.mapping.primary).toBe('#0c71c6')
  })
})

describe('runThemeFromFigma (e2e in tmp dir, mocked fetch)', () => {
  let tmpDir: string
  let logSpy: jest.SpyInstance
  let warnSpy: jest.SpyInstance
  let errorSpy: jest.SpyInstance

  const themePath = () => path.join(tmpDir, 'src', 'app', 'theme.css')
  const extractPath = () => path.join(tmpDir, 'reports', 'extract.json')
  const reportPath = () => path.join(tmpDir, 'reports', 'report.md')

  const logged = () => logSpy.mock.calls.flat().join('\n')
  const warned = () => warnSpy.mock.calls.flat().join('\n')
  const errored = () => errorSpy.mock.calls.flat().join('\n')

  const run = (
    args: string[],
    deps: Parameters<typeof runThemeFromFigma>[1] = {},
  ) =>
    runThemeFromFigma(
      [
        FIXTURE_FILE_KEY,
        '--extract-json', extractPath(),
        '--report', reportPath(),
        '--out', themePath(),
        ...args,
      ],
      {
        fetchImpl: createFigmaFixtureFetch({ expectToken: SENTINEL_TOKEN }),
        now: FIXTURE_NOW,
        env: { FIGMA_TOKEN: SENTINEL_TOKEN },
        isTTY: false,
        ...deps,
      },
    )

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-theme-from-figma-'))
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    warnSpy.mockRestore()
    errorSpy.mockRestore()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('full --map run: extraction JSON + report + theme.css byte-identical to theme init', async () => {
    await expect(run(['--map', 'primary=#0c71c6,radius=8px,font=Inter'])).resolves.toBe(0)
    expect(fs.existsSync(extractPath())).toBe(true)
    expect(fs.existsSync(reportPath())).toBe(true)
    const fromFigmaCss = fs.readFileSync(themePath(), 'utf8')

    // The single-pipeline guarantee: `theme init` with the same confirmed
    // values produces byte-identical output.
    const initOut = path.join(tmpDir, 'init-theme.css')
    await expect(
      runThemeInit(['--primary', '#0c71c6', '--radius', '8px', '--font', 'Inter', '--out', initOut]),
    ).resolves.toBe(0)
    expect(fromFigmaCss).toBe(fs.readFileSync(initOut, 'utf8'))

    const report = fs.readFileSync(reportPath(), 'utf8')
    expect(report).toContain('`--primary` | `#0c71c6` | candidate #1')
    expect(report).toContain('## Contrast results (WCAG 2.1)')
    expect(report).toContain('## Unmapped candidates')
  })

  it('--report-only writes exactly the two artifacts and exits 0', async () => {
    await expect(run(['--report-only'])).resolves.toBe(0)
    expect(fs.existsSync(extractPath())).toBe(true)
    expect(fs.existsSync(reportPath())).toBe(true)
    expect(fs.existsSync(themePath())).toBe(false)
    expect(fs.readFileSync(reportPath(), 'utf8')).toContain('No mapping performed')
  })

  it('degrades to report-only with a notice when stdin is not a TTY and --map is absent', async () => {
    await expect(run([])).resolves.toBe(0)
    expect(logged()).toContain('degrading to --report-only')
    expect(fs.existsSync(themePath())).toBe(false)
    expect(fs.existsSync(reportPath())).toBe(true)
  })

  it('warns (does not fail) when the --map primary never appears in the file', async () => {
    await expect(run(['--map', 'primary=#123456'])).resolves.toBe(0)
    expect(warned()).toContain('does not appear in the extracted candidates')
    expect(fs.readFileSync(reportPath(), 'utf8')).toContain('does not appear in the extracted candidates')
    expect(fs.existsSync(themePath())).toBe(true)
  })

  it('matches a 3-digit --map hex against a 6-digit candidate — no false "not in file" warning', async () => {
    // #ffffff is an extracted candidate; `--map primary=#fff` must hit it.
    await expect(run(['--map', 'primary=#fff'])).resolves.toBe(0)
    expect(warned()).not.toContain('does not appear in the extracted candidates')
    const report = fs.readFileSync(reportPath(), 'utf8')
    expect(report).toContain('| `--primary` | `#ffffff` | candidate #')
    expect(fs.readFileSync(themePath(), 'utf8')).toContain('--primary: #ffffff;')
  })

  it('exits 1 before any network work when a value flag has an empty =value', async () => {
    const throwingFetch = async () => { throw new Error('network must not be touched') }
    const mapCode = await runThemeFromFigma(
      [FIXTURE_FILE_KEY, '--map='],
      { fetchImpl: throwingFetch as never, env: { FIGMA_TOKEN: SENTINEL_TOKEN }, isTTY: false },
    )
    expect(mapCode).toBe(1)
    expect(errored()).toContain('--map (empty value)')

    const extractCode = await runThemeFromFigma(
      [FIXTURE_FILE_KEY, '--extract-json='],
      { fetchImpl: throwingFetch as never, env: { FIGMA_TOKEN: SENTINEL_TOKEN }, isTTY: false },
    )
    expect(extractCode).toBe(1)
    expect(errored()).toContain('--extract-json (empty value)')
  })

  it('warns about duplicate --map keys and applies the later value', async () => {
    await expect(run(['--map', 'primary=#123456,primary=#0c71c6'])).resolves.toBe(0)
    expect(warned()).toContain('Duplicate --map key "primary"')
    expect(fs.readFileSync(themePath(), 'utf8')).toContain('--primary: #0c71c6;')
  })

  it('surfaces failed node batches as a CLI warning and a report row', async () => {
    await expect(
      run(['--report-only'], {
        fetchImpl: createFigmaFixtureFetch({ expectToken: SENTINEL_TOKEN, nodes429Forever: true }),
        sleepImpl: async () => {},
      }),
    ).resolves.toBe(0)
    expect(warned()).toContain('failed after retries')
    expect(fs.readFileSync(reportPath(), 'utf8')).toContain('Failed request batches')
    expect(fs.readFileSync(extractPath(), 'utf8')).toContain('"failedBatches"')
  })

  it('exits 1 on a WCAG hard failure for an explicit pair; report still written with ratios', async () => {
    await expect(run(['--map', 'primary=#8FC1E9,primary-foreground=#ffffff'])).resolves.toBe(1)
    expect(fs.existsSync(themePath())).toBe(false)
    expect(errored()).toContain('Contrast check failed')
    const report = fs.readFileSync(reportPath(), 'utf8')
    expect(report).toContain('fail')
  })

  it('inherits no-overwrite/--force semantics from the theme init writer', async () => {
    fs.mkdirSync(path.dirname(themePath()), { recursive: true })
    fs.writeFileSync(themePath(), ':root { --primary: #ff0000; }', 'utf8')
    await expect(run(['--map', 'primary=#0c71c6'])).resolves.toBe(1)
    expect(fs.readFileSync(themePath(), 'utf8')).toBe(':root { --primary: #ff0000; }')
    expect(errored()).toContain('--force')

    await expect(run(['--map', 'primary=#0c71c6', '--force'])).resolves.toBe(0)
    expect(fs.readFileSync(themePath(), 'utf8')).toContain('--primary: #0c71c6;')
  })

  it('--dry-run writes no artifacts and no theme.css', async () => {
    await expect(run(['--map', 'primary=#0c71c6', '--dry-run'])).resolves.toBe(0)
    expect(fs.existsSync(extractPath())).toBe(false)
    expect(fs.existsSync(reportPath())).toBe(false)
    expect(fs.existsSync(themePath())).toBe(false)
    expect(logged()).toContain('Dry run')
  })

  it('reuses a local extraction JSON offline — no token, no network (file-based import path)', async () => {
    await expect(run(['--report-only'])).resolves.toBe(0)
    const throwingFetch = async () => { throw new Error('network must not be touched') }
    await expect(
      run(['--map', 'primary=#0c71c6'], { fetchImpl: throwingFetch as never, env: {} }),
    ).resolves.toBe(0)
    expect(logged()).toContain('Reusing extraction')
    expect(fs.readFileSync(themePath(), 'utf8')).toContain('--primary: #0c71c6;')
  })

  it('rejects a structurally broken reused extraction with a clean error, not a TypeError', async () => {
    fs.mkdirSync(path.dirname(extractPath()), { recursive: true })
    // Right schema string, but no source/candidates — the schema pin alone
    // must not be trusted.
    fs.writeFileSync(
      extractPath(),
      JSON.stringify({ schema: 'om-figma-brand-extract@1', file: { key: FIXTURE_FILE_KEY } }),
      'utf8',
    )
    await expect(run(['--map', 'primary=#0c71c6'], { env: {} })).resolves.toBe(1)
    expect(errored()).toContain('is not a valid om-figma-brand-extract@1 artifact')
    expect(fs.existsSync(themePath())).toBe(false)
  })

  it('rejects a reused extraction with mistyped candidates cleanly', async () => {
    await expect(run(['--report-only'])).resolves.toBe(0)
    const doc = JSON.parse(fs.readFileSync(extractPath(), 'utf8'))
    doc.candidates = [{ count: 3 }]
    fs.writeFileSync(extractPath(), JSON.stringify(doc), 'utf8')
    await expect(run(['--map', 'primary=#0c71c6'], { env: {} })).resolves.toBe(1)
    expect(errored()).toContain('every candidate must be an object with a string hex')
  })

  it('rejects a reused extraction whose file key does not match', async () => {
    await expect(run(['--report-only'])).resolves.toBe(0)
    const code = await runThemeFromFigma(
      ['SomeOtherFileKey12345', '--extract-json', extractPath(), '--map', 'primary=#0c71c6'],
      { env: {}, isTTY: false },
    )
    expect(code).toBe(1)
    expect(errored()).toContain('not "SomeOtherFileKey12345"')
  })

  it('fails fast when FIGMA_TOKEN is missing', async () => {
    await expect(run(['--report-only'], { env: {} })).resolves.toBe(1)
    expect(errored()).toContain('FIGMA_TOKEN is not set')
    expect(errored()).toContain('never pass it as a flag')
  })

  it('never leaks the token into any written artifact', async () => {
    await expect(run(['--map', 'primary=#0c71c6,font=Inter'])).resolves.toBe(0)
    const files = [extractPath(), reportPath(), themePath()]
    for (const file of files) {
      expect(fs.readFileSync(file, 'utf8')).not.toContain(SENTINEL_TOKEN)
    }
  })

  it('exits 1 with an actionable message for a non-Figma file ref', async () => {
    const code = await runThemeFromFigma(['https://example.com/whatever'], { env: {}, isTTY: false })
    expect(code).toBe(1)
    expect(errored()).toContain('not a Figma file URL or key')
  })

  it('records font-mono in the report only, with a manual-step warning', async () => {
    await expect(run(['--map', 'primary=#0c71c6,font-mono=JetBrains Mono'])).resolves.toBe(0)
    expect(warned()).toContain('does not emit --font-geist-mono')
    const css = fs.readFileSync(themePath(), 'utf8')
    expect(css).not.toContain('--font-geist-mono')
    expect(fs.readFileSync(reportPath(), 'utf8')).toContain('manual step')
  })

  describe('interactive prompt (designer-in-the-loop)', () => {
    const scriptedAsk = (answers: string[]): AskFn => {
      const queue = [...answers]
      return async () => {
        const next = queue.shift()
        if (next === undefined) throw new Error('prompt asked more questions than scripted')
        return next
      }
    }

    it('maps the chosen candidate; empty answers re-ask; "all" expands the table', async () => {
      const ask = scriptedAsk(['', 'all', '1', 'skip', '8px', 'Inter'])
      await expect(run([], { ask })).resolves.toBe(0)
      const css = fs.readFileSync(themePath(), 'utf8')
      expect(css).toContain('--primary: #0c71c6;')
      expect(css).toContain('--radius: 8px;')
      expect(css).toContain('Inter')
      expect(logged()).toContain('Brand color candidates from "Acme Brand Book" (3 frames scanned):')
    })

    it('skipping the primary degrades to report-only — never a guessed mapping', async () => {
      const ask = scriptedAsk(['skip'])
      await expect(run([], { ask })).resolves.toBe(0)
      expect(fs.existsSync(themePath())).toBe(false)
      expect(fs.existsSync(reportPath())).toBe(true)
      expect(logged()).toContain('nothing to generate')
    })

    it('accepts a free hex entry not present in the file, with the same not-in-file note as --map', async () => {
      const ask = scriptedAsk(['#336699', 'skip', 'skip', 'skip'])
      await expect(run([], { ask })).resolves.toBe(0)
      expect(fs.readFileSync(themePath(), 'utf8')).toContain('--primary: #336699;')
      expect(warned()).toContain('does not appear in the extracted candidates')
      expect(fs.readFileSync(reportPath(), 'utf8')).toContain('does not appear in the extracted candidates')
    })

    it('normalizes a 3-digit free hex so it matches a 6-digit candidate — no note', async () => {
      const ask = scriptedAsk(['#fff', 'skip', 'skip', 'skip'])
      await expect(run([], { ask })).resolves.toBe(0)
      expect(fs.readFileSync(themePath(), 'utf8')).toContain('--primary: #ffffff;')
      expect(warned()).not.toContain('does not appear in the extracted candidates')
    })

    describe('EOF (Ctrl-D) during the prompt', () => {
      it('makeStdinAsk rejects with PromptAbortedError when input closes mid-question', async () => {
        const input = new PassThrough()
        const output = new PassThrough()
        output.resume()
        const { ask } = await makeStdinAsk(input, output)
        const pending = ask('Which color? ')
        input.end() // EOF with no answer
        await expect(pending).rejects.toBeInstanceOf(PromptAbortedError)
      })

      it('makeStdinAsk close() after an answered question does not reject', async () => {
        const input = new PassThrough()
        const output = new PassThrough()
        output.resume()
        const { ask, close } = await makeStdinAsk(input, output)
        const pending = ask('Which color? ')
        input.write('1\n')
        await expect(pending).resolves.toBe('1')
        close()
      })

      it('aborts the command with exit 1 and writes nothing when stdin closes mid-prompt', async () => {
        const input = new PassThrough()
        const output = new PassThrough()
        output.resume()
        const promise = run([], { isTTY: true, input, output })
        // Answer the first question, then hit EOF on the next one.
        input.write('1\n')
        input.end()
        await expect(promise).resolves.toBe(1)
        expect(errored()).toContain('stdin closed')
        expect(fs.existsSync(extractPath())).toBe(false)
        expect(fs.existsSync(reportPath())).toBe(false)
        expect(fs.existsSync(themePath())).toBe(false)
      })
    })
  })
})
