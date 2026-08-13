/** @jest-environment node */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { defaultEncryptionMaps } from '../encryption'

// `em.nativeUpdate` issues raw SQL and fires none of the MikroORM flush hooks the
// tenant-data-encryption subscriber depends on, so a field declared in this module's
// encryption map that is written that way lands in the database as plaintext inside a
// column contractually holding ciphertext (#3837). The decrypt path passes non-ciphertext
// values through unchanged, so nothing surfaces the corruption at runtime — this guard is
// what surfaces it instead. Encrypted fields must be written through a managed entity and
// `em.flush()` so the subscriber can encrypt them.

const MODULE_DIR = path.resolve(__dirname, '..')
const SKIPPED_DIRECTORIES = new Set(['__tests__', '__integration__', 'node_modules'])

function toPascalCase(value: string): string {
  return value
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

function toCamelCase(value: string): string {
  return value.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase())
}

function listSourceFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue
      files.push(...listSourceFiles(path.join(dir, entry.name)))
      continue
    }
    if (!/\.tsx?$/.test(entry.name)) continue
    if (/\.test\.tsx?$/.test(entry.name)) continue
    files.push(path.join(dir, entry.name))
  }
  return files
}

function readCallArguments(source: string, openParenIndex: number): string | null {
  let depth = 0
  for (let index = openParenIndex; index < source.length; index += 1) {
    const character = source[index]
    if (character === '(') depth += 1
    else if (character === ')') {
      depth -= 1
      if (depth === 0) return source.slice(openParenIndex + 1, index)
    }
  }
  return null
}

function splitTopLevelArguments(args: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote: string | null = null
  let current = ''
  for (let index = 0; index < args.length; index += 1) {
    const character = args[index]
    if (quote) {
      if (character === quote && args[index - 1] !== '\\') quote = null
      current += character
      continue
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character
      current += character
      continue
    }
    if (character === '(' || character === '{' || character === '[') depth += 1
    if (character === ')' || character === '}' || character === ']') depth -= 1
    if (character === ',' && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += character
  }
  if (current.trim().length > 0) parts.push(current)
  return parts.map((part) => part.trim())
}

// The update payload is often built in a local variable rather than passed inline, so
// resolve identifiers back to the object literal they were declared with plus every
// `payload.field = …` assignment made on them before the write.
function resolvePayloadText(payload: string, source: string): string {
  if (!/^[A-Za-z_$][\w$]*$/.test(payload)) return payload
  const declaration = new RegExp(`\\b(?:const|let|var)\\s+${payload}\\b[^=]*=\\s*`).exec(source)
  let text = ''
  if (declaration) {
    const literalStart = source.indexOf('{', declaration.index + declaration[0].length - 1)
    if (literalStart !== -1) {
      let depth = 0
      for (let index = literalStart; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1
        else if (source[index] === '}') {
          depth -= 1
          if (depth === 0) {
            text += source.slice(literalStart, index + 1)
            break
          }
        }
      }
    }
  }
  const assignments = new RegExp(`\\b${payload}\\.[\\w$]+\\s*=[^=]`, 'g')
  text += `\n${(source.match(assignments) ?? []).join('\n')}`
  const bracketAssignments = new RegExp(`\\b${payload}\\[[^\\]]+\\]\\s*=[^=]`, 'g')
  text += `\n${(source.match(bracketAssignments) ?? []).join('\n')}`
  return text
}

const encryptedPropertiesByEntity = new Map<string, string[]>(
  defaultEncryptionMaps.map((map) => [
    toPascalCase(String(map.entityId).split(':').pop() ?? ''),
    (map.fields ?? []).map((field) => toCamelCase(field.field)),
  ]),
)

describe('customer_accounts encrypted fields are never written with nativeUpdate', () => {
  const sourceFiles = listSourceFiles(MODULE_DIR)

  it('finds the module sources and at least one encrypted entity to guard', () => {
    expect(sourceFiles.length).toBeGreaterThan(0)
    expect(encryptedPropertiesByEntity.size).toBeGreaterThan(0)
    expect(encryptedPropertiesByEntity.get('CustomerUser')).toEqual(
      expect.arrayContaining(['email', 'displayName']),
    )
  })

  it.each(Array.from(encryptedPropertiesByEntity.entries()))(
    '%s writes none of its encrypted properties through nativeUpdate',
    (entityName, encryptedProperties) => {
      const violations: string[] = []
      for (const file of sourceFiles) {
        const source = fs.readFileSync(file, 'utf8')
        if (!source.includes('nativeUpdate')) continue
        const pattern = /\bnativeUpdate\s*\(/g
        let match: RegExpExecArray | null = pattern.exec(source)
        while (match !== null) {
          const args = readCallArguments(source, match.index + match[0].length - 1)
          const parts = args === null ? [] : splitTopLevelArguments(args)
          if (parts[0] === entityName && parts.length >= 3) {
            const payloadText = resolvePayloadText(parts[2], source)
            for (const property of encryptedProperties) {
              if (new RegExp(`\\b${property}\\b`).test(payloadText)) {
                violations.push(`${path.relative(MODULE_DIR, file)} → ${property}`)
              }
            }
          }
          match = pattern.exec(source)
        }
      }
      expect(violations).toEqual([])
    },
  )
})
