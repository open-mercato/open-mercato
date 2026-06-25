import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const TEMPLATE_GITATTRIBUTES = new URL('../../template/gitattributes', import.meta.url)
const CREATE_APP_INDEX = new URL('../index.ts', import.meta.url)
const TEMPLATE_COMPOSE_FILES = [
  new URL('../../template/docker-compose.fullapp.yml', import.meta.url),
  new URL('../../template/docker-compose.fullapp.dev.yml', import.meta.url),
]

function hasGlobalLfRule(content: string): boolean {
  return content
    .split('\n')
    .map((line) => line.trim())
    .some((line) => /^\*\s+/.test(line) && /\btext=auto\b/.test(line) && /\beol=lf\b/.test(line))
}

test('standalone template ships a gitattributes that enforces LF globally', () => {
  const content = fs.readFileSync(TEMPLATE_GITATTRIBUTES, 'utf8')
  assert.ok(
    hasGlobalLfRule(content),
    'template/gitattributes must contain a global "* text=auto eol=lf" rule so scaffolded apps inherit the LF policy'
  )
})

test('scaffolder renames template gitattributes to .gitattributes', () => {
  const source = fs.readFileSync(CREATE_APP_INDEX, 'utf8')
  assert.match(
    source,
    /gitattributes:\s*['"]\.gitattributes['"]/,
    'FILE_RENAMES must map gitattributes -> .gitattributes so generated apps receive the LF policy'
  )
})

test('template docker-compose files are stored with LF (no CR bytes)', () => {
  for (const fileUrl of TEMPLATE_COMPOSE_FILES) {
    const buffer = fs.readFileSync(fileUrl)
    assert.ok(
      !buffer.includes(0x0d),
      `${fileUrl.pathname} contains a CR byte; it must be stored with LF endings`
    )
  }
})
