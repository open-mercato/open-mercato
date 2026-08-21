import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Project, ScriptKind, SyntaxKind } from 'ts-morph'

const JSX_ATTRIBUTE_NAMES = [
  'label',
  'title',
  'placeholder',
  'description',
  'tooltip',
  'aria-label',
  'alt',
  'message',
  'subtitle',
  'helperText',
  'emptyMessage',
]

const TECHNICAL_TOKENS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRUE', 'FALSE', 'NULL', 'NaN', 'UTC'])
const TECHNICAL_PREFIXES = ['application/', 'text/', 'image/', 'multipart/', 'http://', 'https://', 'data:', 'mailto:', 'tel:', 'urn:', '/api/', './', '../']

function looksEnglishPhrase(value) {
  const trimmed = value.trim()
  if (!trimmed || trimmed.startsWith('[internal]')) return false
  if (TECHNICAL_TOKENS.has(trimmed) || TECHNICAL_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) return false
  if (/\.[a-z]+\.[a-z]+/.test(trimmed) && !/\s/.test(trimmed)) return false
  return /[A-Za-z]{2,}/.test(trimmed)
}

function collectSourceFiles(root) {
  const sourceRoot = path.join(root, 'src')
  if (!fs.existsSync(sourceRoot)) return []
  const files = []
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.mercato' || entry.name === 'i18n') continue
      const absolutePath = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(absolutePath)
      else if (
        entry.isFile()
        && /\.(?:ts|tsx)$/.test(entry.name)
        && !/\.(?:test|spec)\.(?:ts|tsx)$/.test(entry.name)
        && !absolutePath.split(path.sep).some((segment) => segment === '__tests__' || segment === '__integration__')
      ) files.push(absolutePath)
    }
  }
  visit(sourceRoot)
  return files.sort()
}

function lineAndColumn(source, offset) {
  const lines = source.slice(0, offset).split('\n')
  return { line: lines.length, column: lines.at(-1).length + 1 }
}

function literalParts(node) {
  if (!node) return []
  if ([SyntaxKind.StringLiteral, SyntaxKind.NoSubstitutionTemplateLiteral].includes(node.getKind())) {
    return [{ value: node.getLiteralValue(), offset: node.getStart() + 1 }]
  }
  if (node.getKind() !== SyntaxKind.TemplateExpression) return []
  return [node.getHead(), ...node.getTemplateSpans().map((span) => span.getLiteral())]
    .map((literal) => ({ value: literal.getLiteralText(), offset: literal.getStart() + 1 }))
}

function calleeName(node) {
  return node?.getText() ?? null
}

function scanSource(project, source, file) {
  const findings = []
  const sourceFile = project.createSourceFile(`/${file}`, source, {
    scriptKind: file.endsWith('.tsx') ? ScriptKind.TSX : ScriptKind.TS,
  })
  const recordParts = (kind, node, extra = {}) => {
    for (const part of literalParts(node)) {
      if (!looksEnglishPhrase(part.value)) continue
      findings.push({ kind, value: part.value.trim(), file, ...extra, ...lineAndColumn(source, part.offset) })
    }
  }
  sourceFile.forEachDescendant((node) => {
    if (node.getKind() === SyntaxKind.JsxText) {
      const value = node.getText()
      if (looksEnglishPhrase(value)) {
        findings.push({ kind: 'jsx-text', value: value.trim(), file, ...lineAndColumn(source, node.getStart()) })
      }
    } else if (node.getKind() === SyntaxKind.JsxAttribute) {
      const attribute = node.getNameNode().getText()
      if (!JSX_ATTRIBUTE_NAMES.includes(attribute)) return
      const initializer = node.getInitializer()
      const expression = initializer?.getKind() === SyntaxKind.JsxExpression ? initializer.getExpression() : initializer
      recordParts('jsx-attr', expression, { attribute })
    } else if (node.getKind() === SyntaxKind.JsxExpression) {
      const parentKind = node.getParent()?.getKind()
      if ([SyntaxKind.JsxElement, SyntaxKind.JsxFragment].includes(parentKind)) recordParts('jsx-text', node.getExpression())
    } else if (node.getKind() === SyntaxKind.CallExpression) {
      const name = calleeName(node.getExpression())
      const kind = name === 'createCrudFormError'
        ? 'crud-form-error'
        : name === 'raiseCrudError'
          ? 'raise-crud-error'
          : /^toast\.(?:error|success|warning|warn|info|message|loading)$/.test(name ?? '')
            ? 'toast-call'
            : /^flash(?:\.(?:error|success|warning|warn|info))?$/.test(name ?? '')
              ? 'flash-call'
              : null
      if (kind) recordParts(kind, node.getArguments()[0])
    } else if (node.getKind() === SyntaxKind.NewExpression && calleeName(node.getExpression()) === 'Error') {
      recordParts('throw-error', node.getArguments()[0])
    }
  })
  return findings
}

function findAllowlist(root, relativePath) {
  const match = relativePath.match(/^src\/modules\/([^/]+)\//)
  if (!match) return null
  const candidate = path.join(root, 'src', 'modules', match[1], 'i18n', '.hardcoded-allowlist.json')
  return fs.existsSync(candidate) ? candidate : null
}

function loadAllowlist(allowlistPath) {
  if (!allowlistPath) return []
  const parsed = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'))
  return Array.isArray(parsed.entries) ? parsed.entries : []
}

function isAllowlisted(finding, entries) {
  return entries.some((entry) => {
    if (!entry || typeof entry.reason !== 'string' || entry.reason.trim().length === 0) return false
    if (entry.file && !finding.file.endsWith(entry.file)) return false
    if (entry.line && finding.line !== entry.line) return false
    if (entry.kind && finding.kind !== entry.kind) return false
    if (entry.match && !finding.value.includes(entry.match)) return false
    return Boolean(entry.file || entry.line || entry.kind || entry.match)
  })
}

export function scanHardcodedI18n(root = process.cwd()) {
  const normalizedRoot = path.resolve(root)
  const files = collectSourceFiles(normalizedRoot)
  const project = new Project({ useInMemoryFileSystem: true, skipAddingFilesFromTsConfig: true })
  const findings = []
  const allowlistCache = new Map()
  const errors = []
  let allowlisted = 0
  for (const absolutePath of files) {
    const relativePath = path.relative(normalizedRoot, absolutePath).split(path.sep).join('/')
    const allowlistPath = findAllowlist(normalizedRoot, relativePath)
    if (!allowlistCache.has(allowlistPath)) {
      try {
        allowlistCache.set(allowlistPath, loadAllowlist(allowlistPath))
      } catch (error) {
        errors.push(`${path.relative(normalizedRoot, allowlistPath)}: ${error.message}`)
        allowlistCache.set(allowlistPath, [])
      }
    }
    const entries = allowlistCache.get(allowlistPath)
    const source = fs.readFileSync(absolutePath, 'utf8')
    for (const finding of scanSource(project, source, relativePath)) {
      if (isAllowlisted(finding, entries)) allowlisted += 1
      else findings.push(finding)
    }
  }
  return { advisory: true, filesScanned: files.length, findings, allowlisted, errors }
}

function runCli() {
  const json = process.argv.slice(2).includes('--json')
  const result = scanHardcodedI18n()
  if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (result.findings.length > 0) {
    process.stderr.write(`[i18n:check-hardcoded] advisory: ${result.findings.length} findings in ${result.filesScanned} files.\n`)
    if (!json) {
      for (const finding of result.findings) {
        process.stderr.write(`${finding.file}:${finding.line}:${finding.column} [${finding.kind}] ${JSON.stringify(finding.value)}\n`)
      }
    }
  } else if (!json) {
    process.stdout.write(`[i18n:check-hardcoded] ${result.filesScanned} files passed.\n`)
  }
  for (const error of result.errors) process.stderr.write(`[i18n:check-hardcoded] ${error}\n`)
  process.exitCode = result.errors.length > 0 ? 1 : 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCli()
