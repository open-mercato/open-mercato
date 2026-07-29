import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  ensureLayoutImport,
  findProtectedTokenOverrides,
  parseThemeInitArgs,
  runThemeInit,
} from '../init'

const INERT_TEMPLATE_HEADER = `/* theme.css — YOUR brand overrides. This file is yours: framework upgrades
 * never touch it. */

/* :root { --primary: #0C71C6; } */
`

describe('parseThemeInitArgs', () => {
  it('parses space- and equals-separated flags plus booleans', () => {
    const flags = parseThemeInitArgs([
      '--primary', '#0C71C6',
      '--radius=8px',
      '--font', 'Inter',
      '--out=custom/theme.css',
      '--force',
      '--dry-run',
    ])
    expect(flags).toMatchObject({
      primary: '#0C71C6',
      radius: '8px',
      font: 'Inter',
      out: 'custom/theme.css',
      force: true,
      dryRun: true,
      unknown: [],
    })
  })

  it('collects unknown arguments', () => {
    expect(parseThemeInitArgs(['--nope', '--primary', '#fff']).unknown).toEqual(['--nope'])
  })
})

describe('findProtectedTokenOverrides', () => {
  it('detects protected tokens and ignores safe ones', () => {
    const css = `:root {
  --primary: #123456;
  --status-error-bg: red;
  --accent-indigo: #000;
  --z-index-modal: 999;
  --shadow-focus: none;
}`
    expect(findProtectedTokenOverrides(css)).toEqual([
      '--accent-indigo',
      '--shadow-focus',
      '--status-error-bg',
      '--z-index-modal',
    ])
    expect(findProtectedTokenOverrides(':root { --primary: #123; --radius: 8px; }')).toEqual([])
  })
})

describe('runThemeInit (e2e in tmp dir)', () => {
  let tmpDir: string
  let logSpy: jest.SpyInstance
  let warnSpy: jest.SpyInstance
  let errorSpy: jest.SpyInstance

  const appDir = () => path.join(tmpDir, 'src', 'app')
  const themePath = () => path.join(appDir(), 'theme.css')
  const layoutPath = () => path.join(appDir(), 'layout.tsx')

  const writeLayout = (content: string) => {
    fs.mkdirSync(appDir(), { recursive: true })
    fs.writeFileSync(layoutPath(), content, 'utf8')
  }

  const baseLayout = `import type { Metadata } from 'next'
import './globals.css'
import { AppProviders } from '@/components/AppProviders'

export default function RootLayout() {
  return null
}
`

  const runInit = (extraArgs: string[] = [], primary = '#0C71C6') =>
    runThemeInit(['--primary', primary, '--out', themePath(), ...extraArgs])

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-theme-init-'))
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

  it('writes a parseable theme.css with light and dark blocks and reports success', async () => {
    writeLayout(baseLayout)
    await expect(runInit()).resolves.toBe(0)
    const css = fs.readFileSync(themePath(), 'utf8')
    expect(css).toContain(':root {')
    expect(css).toContain('.dark {')
    expect(css).toContain('--primary: #0C71C6;')
    expect(css).toContain('--primary-foreground: #ffffff;')
  })

  it('is deterministic — re-running produces byte-identical output', async () => {
    writeLayout(baseLayout)
    await expect(runInit()).resolves.toBe(0)
    const first = fs.readFileSync(themePath(), 'utf8')
    await expect(runInit(['--force'])).resolves.toBe(0)
    const second = fs.readFileSync(themePath(), 'utf8')
    expect(second).toBe(first)
  })

  it('inserts the layout import after the globals.css anchor, idempotently', async () => {
    writeLayout(baseLayout)
    await expect(runInit()).resolves.toBe(0)
    const afterFirst = fs.readFileSync(layoutPath(), 'utf8')
    expect(afterFirst).toContain("import './globals.css'\nimport './theme.css'")

    await expect(runInit(['--force'])).resolves.toBe(0)
    const afterSecond = fs.readFileSync(layoutPath(), 'utf8')
    expect(afterSecond).toBe(afterFirst)
    expect(afterSecond.match(/theme\.css/g)).toHaveLength(1)
  })

  it('refuses to overwrite a customized theme.css without --force', async () => {
    writeLayout(baseLayout)
    fs.writeFileSync(themePath(), ':root { --primary: #ff0000; }', 'utf8')
    await expect(runInit()).resolves.toBe(1)
    expect(fs.readFileSync(themePath(), 'utf8')).toBe(':root { --primary: #ff0000; }')
    expect(errorSpy.mock.calls.flat().join('\n')).toContain('--force')
  })

  it('overwrites the inert scaffolded theme.css (comments only) without --force', async () => {
    writeLayout(baseLayout)
    fs.writeFileSync(themePath(), INERT_TEMPLATE_HEADER, 'utf8')
    await expect(runInit()).resolves.toBe(0)
    expect(fs.readFileSync(themePath(), 'utf8')).toContain('--primary: #0C71C6;')
  })

  it('warns when overwriting a theme.css that overrides protected tokens', async () => {
    writeLayout(baseLayout)
    fs.writeFileSync(themePath(), ':root { --status-error-bg: pink; --accent-indigo: #123456; }', 'utf8')
    await expect(runInit(['--force'])).resolves.toBe(0)
    const warning = warnSpy.mock.calls.flat().join('\n')
    expect(warning).toContain('--status-error-bg')
    expect(warning).toContain('--accent-indigo')
  })

  it('--dry-run prints the CSS and writes nothing', async () => {
    writeLayout(baseLayout)
    await expect(runInit(['--dry-run'])).resolves.toBe(0)
    expect(fs.existsSync(themePath())).toBe(false)
    expect(fs.readFileSync(layoutPath(), 'utf8')).toBe(baseLayout)
    expect(logSpy.mock.calls.flat().join('\n')).toContain(':root {')
  })

  it('exits 1 on an explicitly failing foreground and writes nothing', async () => {
    writeLayout(baseLayout)
    const code = await runThemeInit([
      '--primary', '#8FC1E9',
      '--primary-foreground', '#ffffff',
      '--out', themePath(),
    ])
    expect(code).toBe(1)
    expect(fs.existsSync(themePath())).toBe(false)
    const message = errorSpy.mock.calls.flat().join('\n')
    expect(message).toContain('Contrast check failed')
    expect(message).toContain('#0a0a0a')
  })

  it('exits 1 on an unparseable primary', async () => {
    await expect(runInit([], 'bl(ue)')).resolves.toBe(1)
  })

  it('exits 1 on an invalid radius', async () => {
    writeLayout(baseLayout)
    await expect(runInit(['--radius', '50%'])).resolves.toBe(1)
    expect(fs.existsSync(themePath())).toBe(false)
  })

  it('prints the exact import line when the layout has no globals.css anchor', async () => {
    writeLayout('export default function RootLayout() { return null }\n')
    await expect(runInit()).resolves.toBe(0)
    const warning = warnSpy.mock.calls.flat().join('\n')
    expect(warning).toContain("import './theme.css'")
    // Layout was not rewritten
    expect(fs.readFileSync(layoutPath(), 'utf8')).not.toContain('theme.css')
  })

  it('warns when theme.css is imported before globals.css', async () => {
    writeLayout("import './theme.css'\nimport './globals.css'\n")
    await expect(runInit()).resolves.toBe(0)
    expect(warnSpy.mock.calls.flat().join('\n')).toContain('BEFORE')
  })
})

describe('ensureLayoutImport', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-theme-layout-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('reports layout-missing when the file does not exist', () => {
    expect(ensureLayoutImport(path.join(tmpDir, 'layout.tsx'))).toEqual({ status: 'layout-missing' })
  })

  it('inserts directly after the anchor line', () => {
    const layoutFile = path.join(tmpDir, 'layout.tsx')
    fs.writeFileSync(layoutFile, "import './globals.css'\nimport x from 'y'\n", 'utf8')
    expect(ensureLayoutImport(layoutFile)).toEqual({ status: 'inserted' })
    expect(fs.readFileSync(layoutFile, 'utf8')).toBe(
      "import './globals.css'\nimport './theme.css'\nimport x from 'y'\n",
    )
  })
})
