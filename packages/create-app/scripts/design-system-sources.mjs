/**
 * Static readers for the PR #4301 design-system gallery and the PR #4891 Code Connect layer.
 *
 * Everything here derives from what the packages really contain and really pack. Nothing is
 * copied from prose: family counts, entry counts, mapping counts and coverage sets are all
 * computed, so a gallery change moves the derived asset instead of silently disagreeing with it.
 *
 * The gallery entries are TSX with live `render` closures, so they cannot be imported by a plain
 * Node script. They are read statically instead, through the TypeScript compiler API. A runtime
 * parity test in `packages/core` loads the real registry and asserts the static reading matches
 * it entry for entry — the static reader is convenient, the runtime registry stays authoritative.
 */

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

import { packedFilesOf } from './validate-source-links.mjs'

const require = createRequire(import.meta.url)

export const GALLERY_PACKAGE = '@open-mercato/core'
export const GALLERY_WORKSPACE_DIR = 'packages/core'
export const GALLERY_DIR = 'src/modules/design_system/gallery'
export const CODE_CONNECT_PACKAGE = '@open-mercato/ui'
export const CODE_CONNECT_WORKSPACE_DIR = 'packages/ui'
export const CODE_CONNECT_DIR = 'figma'

/** The DS Figma file every gallery `figmaNodeId` and every Code Connect URL points into. */
export const DS_FIGMA_FILE = 'qCq9z6q1if0mpoRstV5OEA'

// `typescript` resolves to the 7.x native port, which ships no JS compiler API. The repository
// keeps the JS implementation aliased alongside it for exactly this kind of static reading.
let typescriptModule = null
function ts() {
  if (typescriptModule === null) typescriptModule = require('typescript-standalone')
  return typescriptModule
}

function parse(absolutePath) {
  const source = fs.readFileSync(absolutePath, 'utf8')
  return ts().createSourceFile(absolutePath, source, ts().ScriptTarget.Latest, true, ts().ScriptKind.TSX)
}

function stringOf(node, constants) {
  const t = ts()
  if (node === undefined || node === null) return null
  if (t.isStringLiteral(node) || t.isNoSubstitutionTemplateLiteral(node)) return node.text
  // Families that share one value across their entries hold it in a module-level constant
  // (`foundations` points every token entry at the same stylesheet). Following that one hop keeps
  // the reading exact; anything beyond it stays unresolved and fails loudly at the call site.
  if (constants && t.isIdentifier(node) && constants.has(node.text)) return constants.get(node.text)
  return null
}

function propertyOf(objectLiteral, name) {
  const t = ts()
  for (const member of objectLiteral.properties) {
    if (!t.isPropertyAssignment(member)) continue
    const key = t.isIdentifier(member.name) || t.isStringLiteral(member.name) ? member.name.text : null
    if (key === name) return member.initializer
  }
  return null
}

/** Top-level `const <name> = <object literal>` declarations, by name. */
function topLevelObjectLiterals(sourceFile) {
  const t = ts()
  const byName = new Map()
  for (const statement of sourceFile.statements) {
    if (!t.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!t.isIdentifier(declaration.name)) continue
      const initializer = declaration.initializer
      if (initializer && t.isObjectLiteralExpression(initializer)) {
        byName.set(declaration.name.text, initializer)
      }
    }
  }
  return byName
}

/** Top-level `const <name> = [<object literals>]` declarations, by name. */
function topLevelObjectArrays(sourceFile) {
  const t = ts()
  const byName = new Map()
  for (const statement of sourceFile.statements) {
    if (!t.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!t.isIdentifier(declaration.name)) continue
      const initializer = declaration.initializer
      if (initializer && t.isArrayLiteralExpression(initializer)) {
        byName.set(declaration.name.text, initializer)
      }
    }
  }
  return byName
}

/**
 * Variant ids contributed by `...SOURCE.map((item) => ({ id: item.<key>, ... }))`.
 *
 * One family generates its status variants this way. Reading only the literal siblings would
 * report one variant where seven render — a silent undercount, which is the failure mode this
 * whole inventory exists to prevent. Only this exact shape is resolved; every other spread throws.
 */
function spreadVariantIds(spread, objectArrays) {
  const t = ts()
  const expression = spread.expression
  if (!t.isCallExpression(expression)) return null
  const callee = expression.expression
  if (!t.isPropertyAccessExpression(callee) || callee.name.text !== 'map') return null
  if (!t.isIdentifier(callee.expression)) return null
  const source = objectArrays.get(callee.expression.text)
  if (source === undefined) return null

  const mapper = expression.arguments[0]
  if (mapper === undefined || !t.isArrowFunction(mapper)) return null
  const parameter = mapper.parameters[0]
  if (parameter === undefined || !t.isIdentifier(parameter.name)) return null
  const body = t.isParenthesizedExpression(mapper.body) ? mapper.body.expression : mapper.body
  if (!t.isObjectLiteralExpression(body)) return null

  const idExpression = propertyOf(body, 'id')
  if (idExpression === null || !t.isPropertyAccessExpression(idExpression)) return null
  if (!t.isIdentifier(idExpression.expression) || idExpression.expression.text !== parameter.name.text) return null
  const key = idExpression.name.text

  const ids = []
  for (const element of source.elements) {
    if (!t.isObjectLiteralExpression(element)) return null
    const value = stringOf(propertyOf(element, key))
    if (value === null) return null
    ids.push(value)
  }
  return ids
}

/** Top-level `const <name> = '<literal>'` declarations, by name. */
function topLevelStringConstants(sourceFile) {
  const t = ts()
  const byName = new Map()
  for (const statement of sourceFile.statements) {
    if (!t.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!t.isIdentifier(declaration.name)) continue
      const initializer = declaration.initializer
      if (initializer && (t.isStringLiteral(initializer) || t.isNoSubstitutionTemplateLiteral(initializer))) {
        byName.set(declaration.name.text, initializer.text)
      }
    }
  }
  return byName
}

function exportedArray(sourceFile, name) {
  const t = ts()
  for (const statement of sourceFile.statements) {
    if (!t.isVariableStatement(statement)) continue
    const exported = statement.modifiers?.some((modifier) => modifier.kind === t.SyntaxKind.ExportKeyword)
    if (!exported) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!t.isIdentifier(declaration.name) || declaration.name.text !== name) continue
      if (declaration.initializer && t.isArrayLiteralExpression(declaration.initializer)) {
        return declaration.initializer
      }
    }
  }
  return null
}

/**
 * The gallery family manifest, in registry order.
 *
 * `registry.ts` is a hand-maintained manifest rather than an auto-discovered one, so the family
 * list is read from it directly and the entries module of each family is read from its `load`
 * dynamic import — never from a directory listing, which would happily include a family the
 * registry does not actually load.
 */
export function readGalleryFamilies(repoRoot) {
  const t = ts()
  const registryPath = path.join(repoRoot, GALLERY_WORKSPACE_DIR, GALLERY_DIR, 'registry.ts')
  const sourceFile = parse(registryPath)
  const array = exportedArray(sourceFile, 'galleryFamilies')
  if (array === null) throw new Error(`${GALLERY_DIR}/registry.ts does not export a galleryFamilies array literal`)

  const families = []
  for (const element of array.elements) {
    if (!t.isObjectLiteralExpression(element)) {
      throw new Error(`${GALLERY_DIR}/registry.ts contains a family that is not an object literal`)
    }
    const id = stringOf(propertyOf(element, 'id'))
    const labelKey = stringOf(propertyOf(element, 'labelKey'))
    if (id === null) throw new Error(`${GALLERY_DIR}/registry.ts contains a family without a literal id`)

    const load = propertyOf(element, 'load')
    let entriesModule = null
    if (load && t.isArrowFunction(load)) {
      const body = load.body
      if (t.isCallExpression(body) && body.expression.kind === t.SyntaxKind.ImportKeyword) {
        entriesModule = stringOf(body.arguments[0])
      }
    }
    if (entriesModule === null) {
      throw new Error(`gallery family "${id}" does not load its entries through a literal dynamic import`)
    }
    families.push({ id, labelKey, entriesModule })
  }
  return families
}

/** Every entry of one family, in the order the family's `entries` array lists them. */
export function readGalleryEntries(repoRoot, family) {
  const t = ts()
  const relative = `${GALLERY_DIR}/${family.entriesModule.replace(/^\.\//, '')}.tsx`
  const absolute = path.join(repoRoot, GALLERY_WORKSPACE_DIR, relative)
  const sourceFile = parse(absolute)
  const array = exportedArray(sourceFile, 'entries')
  if (array === null) throw new Error(`${relative} does not export an entries array literal`)
  const byName = topLevelObjectLiterals(sourceFile)
  const objectArrays = topLevelObjectArrays(sourceFile)
  const constants = topLevelStringConstants(sourceFile)

  const entries = []
  for (const element of array.elements) {
    let literal = null
    if (t.isObjectLiteralExpression(element)) literal = element
    else if (t.isIdentifier(element)) literal = byName.get(element.text) ?? null
    if (literal === null) {
      throw new Error(`${relative} lists an entry this reader cannot resolve to an object literal`)
    }

    const id = stringOf(propertyOf(literal, 'id'), constants)
    const title = stringOf(propertyOf(literal, 'title'), constants)
    const importPath = stringOf(propertyOf(literal, 'importPath'), constants)
    if (id === null || title === null || importPath === null) {
      throw new Error(`${relative} contains an entry without literal id/title/importPath`)
    }
    const figmaNodeId = stringOf(propertyOf(literal, 'figmaNodeId'), constants)
    const docsAnchor = stringOf(propertyOf(literal, 'docsAnchor'), constants)

    const variantsNode = propertyOf(literal, 'variants')
    const variantIds = []
    const variantSnippets = []
    if (variantsNode && t.isArrayLiteralExpression(variantsNode)) {
      for (const variant of variantsNode.elements) {
        if (t.isSpreadElement(variant)) {
          const spreadIds = spreadVariantIds(variant, objectArrays)
          if (spreadIds === null) {
            throw new Error(
              `${relative} entry "${id}" spreads variants this reader cannot resolve; `
              + 'resolve the shape here rather than under-reporting the variant set',
            )
          }
          variantIds.push(...spreadIds)
          continue
        }
        const variantLiteral = t.isObjectLiteralExpression(variant)
          ? variant
          : (t.isIdentifier(variant) ? byName.get(variant.text) ?? null : null)
        if (variantLiteral === null) {
          throw new Error(`${relative} entry "${id}" lists a variant this reader cannot resolve`)
        }
        const variantId = stringOf(propertyOf(variantLiteral, 'id'), constants)
        if (variantId !== null) variantIds.push(variantId)
        const code = propertyOf(variantLiteral, 'code')
        const snippet = code === null ? null : snippetTextOf(code)
        if (snippet !== null) variantSnippets.push(snippet)
      }
    }

    entries.push({
      familyId: family.id,
      entryId: id,
      title,
      importPath,
      docsAnchor,
      figmaNodeId,
      variantIds,
      variantSnippets,
      entrySourceRelativePath: `${GALLERY_DIR}/${family.entriesModule.replace(/^\.\//, '')}.tsx`,
    })
  }
  return entries
}

/**
 * A variant's copyable snippet.
 *
 * Snippets are template literals often assembled from shared prefixes, so only the literal spans
 * are read. That is enough for the one thing the snippet is asked to prove — that the copy button
 * yields the same public import the entry declares — and it never invents text no reader sees.
 */
function snippetTextOf(node) {
  const t = ts()
  if (t.isStringLiteral(node) || t.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (t.isTemplateExpression(node)) {
    let text = node.head.text
    for (const span of node.templateSpans) text += span.literal.text
    return text
  }
  if (t.isBinaryExpression(node) && node.operatorToken.kind === t.SyntaxKind.PlusToken) {
    const left = snippetTextOf(node.left)
    const right = snippetTextOf(node.right)
    if (left === null && right === null) return null
    return `${left ?? ''}${right ?? ''}`
  }
  return null
}

/** Every gallery entry across every registered family, in registry order. */
export function readGallery(repoRoot) {
  const families = readGalleryFamilies(repoRoot)
  const entries = []
  for (const family of families) entries.push(...readGalleryEntries(repoRoot, family))
  return { families, entries }
}

const exportsCache = new Map()

function packageExports(repoRoot, workspaceDir) {
  if (exportsCache.has(workspaceDir)) return exportsCache.get(workspaceDir)
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, workspaceDir, 'package.json'), 'utf8'))
  const value = manifest.exports ?? {}
  exportsCache.set(workspaceDir, value)
  return value
}

function typesCandidates(entry) {
  if (typeof entry === 'string') return [entry]
  if (Array.isArray(entry)) return entry.filter((item) => typeof item === 'string')
  if (entry && typeof entry === 'object') {
    const types = entry.types
    if (typeof types === 'string') return [types]
    if (Array.isArray(types)) return types.filter((item) => typeof item === 'string')
  }
  return []
}

/**
 * Resolve a public import specifier to the exact package-relative source file it exports.
 *
 * The package's own `exports` map is the authority — exact keys first, then wildcard patterns in
 * specificity order. Resolving by guessing an extension would answer for files the package does
 * not actually export, which is the whole failure mode `codeConnectExportStatus` exists to record.
 */
export function resolvePackageExport(repoRoot, workspaceDir, packageName, importPath) {
  if (importPath !== packageName && !importPath.startsWith(`${packageName}/`)) return null
  const subpath = importPath === packageName ? '.' : `./${importPath.slice(packageName.length + 1)}`
  const map = packageExports(repoRoot, workspaceDir)

  const attempts = []
  if (Object.prototype.hasOwnProperty.call(map, subpath)) {
    attempts.push(...typesCandidates(map[subpath]))
  }
  const wildcards = Object.keys(map)
    .filter((key) => key.includes('*'))
    .sort((left, right) => right.length - left.length)
  for (const key of wildcards) {
    const [prefix, suffix] = key.split('*')
    if (suffix.includes('*')) continue
    if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) continue
    const filled = subpath.slice(prefix.length, subpath.length - (suffix.length || 0))
    if (filled.length === 0) continue
    for (const candidate of typesCandidates(map[key])) {
      const [candidatePrefix, candidateSuffix] = candidate.split('*')
      if (candidateSuffix === undefined || candidateSuffix.includes('*')) continue
      attempts.push(`${candidatePrefix}${filled}${candidateSuffix}`)
    }
  }

  for (const attempt of attempts) {
    const packageRelativePath = attempt.replace(/^\.\//, '')
    const absolute = path.join(repoRoot, workspaceDir, packageRelativePath)
    let stat = null
    try {
      stat = fs.statSync(absolute)
    } catch {
      continue
    }
    if (!stat.isFile()) continue
    return packageRelativePath
  }
  return null
}

/** Whether a package-relative path is present in what `npm pack` would ship for that package. */
export function isPacked(repoRoot, workspaceDir, packageRelativePath) {
  const packed = packedFilesOf(repoRoot, workspaceDir)
  if (packed === null) return null
  return packed.has(packageRelativePath)
}

/** The installed, app-relative location of a package-relative source file. */
export function installedPathOf(packageName, packageRelativePath) {
  return `node_modules/${packageName}/${packageRelativePath}`
}

/**
 * Every `figma.connect` call the PR #4891 Code Connect layer ships.
 *
 * Read statically for the same reason as the gallery: these files import React components and a
 * Figma runtime. The node id is read from the `?node-id=` query of the declared Figma URL, which
 * is the only place the mapping records one.
 */
export function readCodeConnectMappings(repoRoot) {
  const t = ts()
  const dir = path.join(repoRoot, CODE_CONNECT_WORKSPACE_DIR, CODE_CONNECT_DIR)
  let names = []
  try {
    names = fs.readdirSync(dir).filter((name) => name.endsWith('.figma.tsx')).sort()
  } catch {
    return []
  }

  const mappings = []
  for (const name of names) {
    const relative = `${CODE_CONNECT_DIR}/${name}`
    const sourceFile = parse(path.join(dir, name))

    const importedFrom = new Map()
    const visit = (node) => {
      if (t.isImportDeclaration(node)) {
        const moduleSpecifier = stringOf(node.moduleSpecifier)
        const bindings = node.importClause?.namedBindings
        if (moduleSpecifier !== null && bindings && t.isNamedImports(bindings)) {
          for (const element of bindings.elements) importedFrom.set(element.name.text, moduleSpecifier)
        }
        if (moduleSpecifier !== null && node.importClause?.name) {
          importedFrom.set(node.importClause.name.text, moduleSpecifier)
        }
      }
      if (t.isCallExpression(node)) {
        const callee = node.expression
        const isConnect = t.isPropertyAccessExpression(callee)
          && t.isIdentifier(callee.name)
          && callee.name.text === 'connect'
          && t.isIdentifier(callee.expression)
          && callee.expression.text === 'figma'
        if (isConnect) {
          const componentArgument = node.arguments[0]
          const componentName = componentArgument && t.isIdentifier(componentArgument)
            ? componentArgument.text
            : null
          const url = stringOf(node.arguments[1])
          const options = node.arguments[2]
          const optionsLiteral = options && t.isObjectLiteralExpression(options) ? options : null
          mappings.push({
            sourceRelativePath: relative,
            componentName,
            importPath: componentName === null ? null : importedFrom.get(componentName) ?? null,
            // The mapping's own `imports` entry is the public specifier a consumer would write.
            // It is the join key to a gallery entry: both sides name the same public module, so
            // neither has to trust the other's private file layout.
            publicImportPaths: optionsLiteral === null ? [] : publicImportPathsOf(optionsLiteral),
            mappedPropValues: optionsLiteral === null ? [] : mappedPropValuesOf(optionsLiteral),
            url,
            nodeId: url === null ? null : nodeIdOfFigmaUrl(url),
            placeholder: url === null ? false : nodeIdOfFigmaUrl(url) === '0-1',
          })
        }
      }
      t.forEachChild(node, visit)
    }
    visit(sourceFile)
  }
  return mappings
}

/** The public import specifiers a `figma.connect` call tells consumers to write. */
function publicImportPathsOf(optionsLiteral) {
  const t = ts()
  const imports = propertyOf(optionsLiteral, 'imports')
  if (imports === null || !t.isArrayLiteralExpression(imports)) return []
  const specifiers = []
  for (const element of imports.elements) {
    const statement = stringOf(element)
    if (statement === null) continue
    const match = /from\s+'([^']+)'/.exec(statement)
    if (match !== null) specifiers.push(match[1])
  }
  return specifiers
}

/**
 * The prop values a mapping actually binds — every `figma.enum` case value it maps.
 *
 * This is what `mappingCoverage` compares against the gallery's own variant ids. Both sides are
 * read from real declarations, so the coverage verdict moves when either side moves; a count
 * copied from prose would not.
 */
function mappedPropValuesOf(optionsLiteral) {
  const t = ts()
  const props = propertyOf(optionsLiteral, 'props')
  if (props === null || !t.isObjectLiteralExpression(props)) return []
  const values = new Set()
  const visit = (node) => {
    if (t.isPropertyAssignment(node)) {
      const value = stringOf(node.initializer)
      if (value !== null) values.add(value)
    }
    t.forEachChild(node, visit)
  }
  visit(props)
  return [...values].sort()
}

/** The `node-id` a Figma design URL points at, in the hyphen form the URL carries. */
export function nodeIdOfFigmaUrl(url) {
  const match = /[?&]node-id=([^&#]+)/.exec(url)
  return match === null ? null : decodeURIComponent(match[1])
}

/**
 * Node identifiers normalized to one comparable form.
 *
 * The gallery records `<page>:<node>` and Code Connect URLs carry `<page>-<node>`; they are two
 * independent authorities over the same Figma file. Normalizing each separately and comparing the
 * results keeps them independent — neither side may borrow the other's identifier.
 */
export function normalizeFigmaNodeId(nodeId) {
  if (typeof nodeId !== 'string' || nodeId.length === 0) return null
  const normalized = nodeId.trim().replace(/-/g, ':')
  return /^\d+:\d+$/.test(normalized) ? normalized : null
}
