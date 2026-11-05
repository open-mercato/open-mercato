import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// @ts-expect-error The standalone template script is plain ESM by design.
import { scanHardcodedI18n } from '../../template/scripts/i18n-check-hardcoded.mjs'

function createFixture(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mercato-i18n-check-'))
  for (const [relativePath, contents] of Object.entries(files)) {
    const target = path.join(root, relativePath)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, contents)
  }
  return root
}

test('standalone i18n checker detects visible JSX and mutation messages', () => {
  const root = createFixture({
    'src/modules/example/backend/page.tsx': `export function Page() {
      toast.error('Unable to save record')
      flash('Changes saved successfully')
      throw new Error('Record could not be loaded')
      return <section title="Customer details" aria-label="Customer details"><span>Customer details</span></section>
    }`,
  })
  try {
    const findings = scanHardcodedI18n(root).findings
    assert.deepEqual(
      new Set(findings.map((finding) => finding.kind)),
      new Set(['toast-call', 'flash-call', 'throw-error', 'jsx-attr', 'jsx-text']),
    )
    assert.ok(findings.some((finding) => finding.attribute === 'aria-label'))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('standalone i18n checker detects single-word and multiline user-facing literals', () => {
  const root = createFixture({
    'src/modules/example/backend/page.tsx': `export function Page({ name }: { name: string }) {
      toast.error(
        'Failed'
      )
      toast.error(\`Unable to save ${'${'}name}\`)
      flash(
        \`Changes saved
successfully\`
      )
      throw new Error(
        'Unavailable'
      )
      return <section
        title={
          'Details'
        }
        subtitle={\`Welcome ${'${'}name}\`}
      ><><button>Add</button><span>Yes</span><span>No</span><span>OK</span>{'Save'}<>Done</></></section>
    }`,
  })
  try {
    const findings = scanHardcodedI18n(root).findings
    assert.ok(findings.some((finding) => finding.kind === 'toast-call' && finding.value === 'Failed'))
    assert.ok(findings.some((finding) => finding.kind === 'toast-call' && finding.value === 'Unable to save'))
    assert.ok(findings.some((finding) => finding.kind === 'flash-call' && finding.value.includes('Changes saved')))
    assert.ok(findings.some((finding) => finding.kind === 'throw-error' && finding.value === 'Unavailable'))
    assert.ok(findings.some((finding) => finding.kind === 'jsx-attr' && finding.value === 'Details'))
    assert.ok(findings.some((finding) => finding.kind === 'jsx-attr' && finding.value === 'Welcome'))
    for (const value of ['Add', 'Yes', 'No', 'OK', 'Save', 'Done']) {
      assert.ok(findings.some((finding) => finding.kind === 'jsx-text' && finding.value === value))
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('standalone i18n checker ignores TypeScript syntax and translated JSX expressions', () => {
  const root = createFixture({
    'src/modules/example/lib/service.ts': `export async function load<T>(timeoutMs: number, logger: Pick<Console, 'error'>): Promise<T> {
      logger.error(timeoutMs)
      return {} as T
    }`,
    'src/modules/example/backend/page.tsx': `type Props = { activeOrgLabel: string }
      export function Page({ activeOrgLabel }: Props) {
        const t = (key: string) => key
        return <CrudForm<{ title: string; note?: string }>
          injectionSpotId={activeOrgLabel}
          replacementHandle={activeOrgLabel}
          aria-label={\`${'${'}t('example.organization')}: ${'${'}activeOrgLabel}\`}
          title={t('example.title')}
        >
          <span>{t('example.description')}</span>
        </CrudForm>
      }`,
  })
  try {
    assert.deepEqual(scanHardcodedI18n(root).findings, [])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('standalone i18n checker parses shipped generic CrudForm TSX without syntax findings', () => {
  const templateRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../template')
  const result = scanHardcodedI18n(templateRoot)
  assert.deepEqual(result.errors, [])
  assert.ok(result.findings.some((finding) => finding.value === 'API Key'))
  for (const finding of result.findings) {
    assert.doesNotMatch(finding.value, /injectionSpotId|replacementHandle|timeoutMs: number|logger: Pick|\): Promise/)
    if (finding.file.endsWith('.ts')) assert.notEqual(finding.kind, 'jsx-text')
  }
})

test('standalone i18n checker honors translations and internal opt-outs', () => {
  const root = createFixture({
    'src/modules/example/backend/page.tsx': `export function Page() {
      throw new Error('[internal] missing fixture')
      return <section title={t('example.title')}>{t('example.description')}</section>
    }`,
  })
  try {
    assert.deepEqual(scanHardcodedI18n(root).findings, [])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('standalone i18n checker honors module-scoped reasoned allowlists', () => {
  const root = createFixture({
    'src/modules/example/backend/page.tsx': `export const Page = () => <span>Legal company name</span>`,
    'src/modules/example/i18n/.hardcoded-allowlist.json': JSON.stringify({
      version: 1,
      entries: [{ file: 'backend/page.tsx', kind: 'jsx-text', match: 'Legal company name', reason: 'Required legal copy.' }],
    }),
  })
  try {
    const result = scanHardcodedI18n(root)
    assert.deepEqual(result.findings, [])
    assert.equal(result.allowlisted, 1)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
