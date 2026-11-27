import { collectClassStrings } from '../utils/ast-helpers.js'

const BLOCK_IMPORT_PREFIX = '@open-mercato/ui/blocks/'

export const BLOCK_NAME_PATTERNS = [
  { block: 'bulk-action-bar', pattern: /(?:Bulk(?:Actions?)?|Selection)(?:Bar|Toolbar)$/ },
  { block: 'entity-header', pattern: /(?:(?:Detail|Record|Entity)Header|HeaderCard)$/ },
  { block: 'list-toolbar', pattern: /(?:FilterBar(?:Row)?|(?:List|Table)Toolbar)$/ },
  { block: 'form-save-bar', pattern: /(?:UnsavedChanges|FormSave|Save)Bar$/ },
  { block: 'timeline', pattern: /(?:Timeline(?:Item|Entry)?|ActivityFeed)$/ },
  { block: 'kanban', pattern: /(?:Kanban(?:Board|Page|View)|PipelineBoard)$/ },
  { block: 'wizard', pattern: /(?:Wizard(?:Dialog|Page|Nav|Flow)?|StepIndicator)$/ },
  {
    block: 'key-value',
    pattern: /(?:Facts(?:List|Grid)|(?:Details?|Metadata|Meta|Info|Properties)List|KeyValue(?:List|Grid|Rows?|Table)?)$/,
  },
]

const COMPONENT_NAME = /^[A-Z][A-Za-z0-9]*[a-z][A-Za-z0-9]*$/
const PINNED_POSITION = /^(?:sticky|fixed)$/
const BOTTOM_EDGE = /^-?bottom-/
const DIRTY_IDENTIFIER = /dirty|unsaved/i
const BUTTON_ELEMENTS = new Set(['Button', 'button'])
const COMPONENT_WRAPPERS = new Set(['memo', 'forwardRef'])
const SKIPPED_KEYS = new Set(['parent', 'loc', 'range', 'tokens', 'comments'])

export function blockForName(name) {
  if (typeof name !== 'string' || !COMPONENT_NAME.test(name)) return null
  const match = BLOCK_NAME_PATTERNS.find((entry) => entry.pattern.test(name))
  return match ? match.block : null
}

function normalizePath(filename) {
  return String(filename).replace(/\\/g, '/')
}

function componentFileName(filename) {
  const match = /([^/]+)\.tsx$/.exec(normalizePath(filename))
  return match ? match[1] : null
}

function isFunctionLike(node) {
  if (!node) return false
  if (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') return true
  if (node.type !== 'CallExpression') return false
  const callee = node.callee.type === 'MemberExpression' ? node.callee.property : node.callee
  if (callee.type !== 'Identifier' || !COMPONENT_WRAPPERS.has(callee.name)) return false
  return node.arguments.some((argument) => argument.type === 'Identifier' || isFunctionLike(argument))
}

function elementName(openingElement) {
  return openingElement.name.type === 'JSXIdentifier' ? openingElement.name.name : null
}

function someDescendant(root, predicate) {
  const queue = [root]
  while (queue.length > 0) {
    const current = queue.pop()
    if (predicate(current)) return true
    for (const key of Object.keys(current)) {
      if (SKIPPED_KEYS.has(key)) continue
      const value = current[key]
      if (Array.isArray(value)) {
        for (const item of value) if (item && typeof item.type === 'string') queue.push(item)
      } else if (value && typeof value.type === 'string') {
        queue.push(value)
      }
    }
  }
  return false
}

function isPinnedToBottom(openingElement) {
  const classAttribute = openingElement.attributes.find(
    (attribute) => attribute.type === 'JSXAttribute' && attribute.name?.name === 'className',
  )
  if (!classAttribute) return false
  const classes = collectClassStrings(classAttribute).flatMap((part) => part.text.split(/\s+/))
  return classes.some((name) => PINNED_POSITION.test(name)) && classes.some((name) => BOTTOM_EDGE.test(name))
}

function isHandBuiltSaveBar(element) {
  if (!isPinnedToBottom(element.openingElement)) return false
  const hasButton = someDescendant(
    element,
    (node) => node.type === 'JSXOpeningElement' && BUTTON_ELEMENTS.has(elementName(node)),
  )
  if (!hasButton) return false
  return someDescendant(element, (node) => node.type === 'Identifier' && DIRTY_IDENTIFIER.test(node.name))
}

function isBaselined(baseline, filename, block) {
  const normalized = normalizePath(filename)
  return baseline.some(
    (entry) => entry.block === block && (normalized === entry.file || normalized.endsWith(`/${entry.file}`)),
  )
}

export const preferBusinessBlock = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Prefer an Open Mercato business block over a hand-built equivalent in module code',
    },
    messages: {
      preferBlock:
        'Hand-built {{what}} — use the `{{block}}` block from @open-mercato/ui/blocks/{{block}} (showcase page /blocks/{{block}}/), or wrap it in a thin adapter.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          baseline: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                file: { type: 'string', minLength: 1 },
                block: { type: 'string', minLength: 1 },
              },
              required: ['file', 'block'],
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const filename = context.filename ?? context.getFilename()
    const baseline = context.options[0]?.baseline ?? []
    const adoptedBlocks = new Set()
    const findings = []
    let rendersJsx = false

    function record(node, block, what) {
      findings.push({ node, block, what })
    }

    function checkName(node, name) {
      const block = blockForName(name)
      if (block) record(node, block, `component \`${name}\``)
    }

    return {
      ImportDeclaration(node) {
        const source = node.source?.value
        if (typeof source !== 'string' || !source.startsWith(BLOCK_IMPORT_PREFIX)) return
        adoptedBlocks.add(source.slice(BLOCK_IMPORT_PREFIX.length).split('/')[0])
      },
      FunctionDeclaration(node) {
        if (node.id) checkName(node.id, node.id.name)
      },
      VariableDeclarator(node) {
        if (node.id.type === 'Identifier' && isFunctionLike(node.init)) checkName(node.id, node.id.name)
      },
      JSXElement(node) {
        rendersJsx = true
        const name = elementName(node.openingElement)
        if (name === 'dl') {
          record(node.openingElement, 'key-value', 'fact list (`<dl>`)')
          return
        }
        if (isHandBuiltSaveBar(node)) {
          record(node.openingElement, 'form-save-bar', 'save bar (pinned bottom container with a dirty state and a button)')
        }
      },
      'Program:exit'(program) {
        const fileName = componentFileName(filename)
        const fileBlock = rendersJsx ? blockForName(fileName) : null
        if (fileBlock && !findings.some((finding) => finding.block === fileBlock)) {
          findings.unshift({
            node: program,
            loc: { line: 1, column: 0 },
            block: fileBlock,
            what: `component file \`${fileName}.tsx\``,
          })
        }
        for (const finding of findings) {
          if (adoptedBlocks.has(finding.block)) continue
          if (isBaselined(baseline, filename, finding.block)) continue
          context.report({
            node: finding.node,
            ...(finding.loc ? { loc: finding.loc } : {}),
            messageId: 'preferBlock',
            data: { what: finding.what, block: finding.block },
          })
        }
      },
    }
  },
}
