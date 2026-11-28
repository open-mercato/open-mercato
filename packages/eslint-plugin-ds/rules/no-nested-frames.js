const CLASS_HELPERS = new Set(['cn', 'clsx', 'cx', 'classNames', 'classnames', 'twMerge', 'twJoin'])
const RESPONSIVE_PREFIXES = new Set(['sm', 'md', 'lg', 'xl', '2xl'])
const MAX_RESOLVE_DEPTH = 4

const FULL_BORDER = /^border(?:-(?:[1248]|\[\d[^\]]*\]))?$/
const BORDER_REMOVED = /^border-(?:0|none|hidden)$/
const BORDER_NOT_A_COLOUR =
  /^border-(?:\d+|\[\d[^\]]*\]|[xytblrse](?:-.+)?|solid|dashed|dotted|double|hidden|none|collapse|separate|spacing-.+)$/
const BORDER_TRANSPARENT = /^border-transparent(?:\/\d+)?$/
const ALL_CORNER_RADIUS = /^rounded(?:-(?!(?:[tblrse]|tl|tr|bl|br|ss|se|es|ee)(?:-|$)).+)?$/
const RADIUS_NOT_A_FRAME = /^rounded-(?:none|full|badge|\[(?:9999px|50%|100%)\])$/
const DASHED = /^border-(?:dashed|dotted)$/
const INLINE_DISPLAY = /^inline(?:-flex|-block|-grid)?$/
const SIZE_UTILITY = /^(size|h|w)-(\d+(?:\.\d+)?|px)$/
const FLOATING_POSITION = /^(?:absolute|fixed)$/
const CONTROL_BORDER = /^border-input(?:\/\d+)?$/
const SMALL_SIZE_LIMIT = 12

export const FRAME_COMPONENTS = [
  { component: 'Card' },
  { component: 'ContentCard' },
  { component: 'FileUploadCard' },
  { component: 'Notice' },
  { component: 'JsonDisplay' },
  { component: 'JsonBuilder' },
  { component: 'CollapsibleGroup' },
  { component: 'DataTable', unlessFlag: 'embedded' },
  { component: 'AccordionItem', attribute: 'variant', value: 'card', appliesByDefault: true },
  { component: 'EmptyState', attribute: 'variant', value: 'outlined' },
]

export const OVERLAY_BOUNDARIES = new Set([
  'Dialog',
  'DialogContent',
  'Drawer',
  'DrawerContent',
  'Sheet',
  'SheetContent',
  'Popover',
  'PopoverContent',
  'DropdownMenuContent',
  'Tooltip',
  'TooltipContent',
  'SimpleTooltip',
  'HoverCardContent',
  'AlertDialogContent',
])

const CONTROL_ELEMENTS = new Set([
  'button',
  'input',
  'select',
  'textarea',
  'label',
  'a',
  'kbd',
  'code',
  'span',
  'img',
  'video',
  'canvas',
  'svg',
  'summary',
])

const CONTROL_COMPONENT =
  /(?:Button|Input|Select|Textarea|Trigger|Badge|Tag|Chip|Pill|Avatar|Checkbox|Switch|Radio|Kbd|Link|Icon|Picker|Slider|Toggle|Skeleton|Label|TabsList|SegmentedControl|Image|Thumbnail)(?:Primitive)?$/

const OVERLAY_PRIMITIVE =
  /(?:Dialog|Drawer|Sheet|Popover|DropdownMenu|ContextMenu|Tooltip|HoverCard|Select)(?:Primitive)?\.(?:Root|Portal|Content|Positioner|Popup)$/

const COMPONENT_WRAPPERS = new Set(['memo', 'forwardRef'])
const NESTED_FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'])
const SKIPPED_KEYS = new Set(['parent', 'loc', 'range', 'tokens', 'comments'])

const CONTROL_ROLES = new Set(['button', 'option', 'radio', 'checkbox', 'tab', 'switch', 'menuitem', 'link'])

function normalizePath(filename) {
  return String(filename).replace(/\\/g, '/')
}

function splitTokens(text) {
  return String(text).split(/\s+/).filter(Boolean)
}

function templateTokens(node, resolve) {
  const tokens = []
  node.quasis.forEach((quasi, index) => {
    const raw = quasi.value.cooked ?? quasi.value.raw
    const parts = splitTokens(raw)
    if (index > 0 && parts.length > 0 && !/^\s/.test(raw)) parts.shift()
    if (index < node.quasis.length - 1 && parts.length > 0 && !/\s$/.test(raw)) parts.pop()
    tokens.push(...parts)
  })
  for (const expression of node.expressions) tokens.push(...resolve(expression))
  return tokens
}

function findVariable(scope, name) {
  let current = scope
  while (current) {
    const variable = current.set.get(name)
    if (variable) return variable
    current = current.upper
  }
  return null
}

function constInitializer(context, identifier) {
  const variable = findVariable(context.sourceCode.getScope(identifier), identifier.name)
  if (!variable || variable.defs.length !== 1) return null
  const definition = variable.defs[0]
  if (definition.type !== 'Variable' || definition.parent?.kind !== 'const') return null
  if (definition.node.id.type !== 'Identifier') return null
  return definition.node.init ?? null
}

function alwaysAppliedClasses(context, node, depth = 0) {
  if (!node || depth > MAX_RESOLVE_DEPTH) return []
  const resolve = (child) => alwaysAppliedClasses(context, child, depth + 1)
  switch (node.type) {
    case 'Literal':
      return typeof node.value === 'string' ? splitTokens(node.value) : []
    case 'TemplateLiteral':
      return templateTokens(node, resolve)
    case 'JSXExpressionContainer':
    case 'TSAsExpression':
    case 'TSNonNullExpression':
    case 'TSSatisfiesExpression':
      return alwaysAppliedClasses(context, node.expression, depth)
    case 'ArrayExpression':
      return node.elements.flatMap((element) => (element ? resolve(element) : []))
    case 'ConditionalExpression': {
      const alternate = new Set(resolve(node.alternate))
      return resolve(node.consequent).filter((token) => alternate.has(token))
    }
    case 'Identifier': {
      const init = constInitializer(context, node)
      return init ? resolve(init) : []
    }
    case 'CallExpression': {
      if (node.callee.type !== 'Identifier') return []
      if (CLASS_HELPERS.has(node.callee.name)) return node.arguments.flatMap(resolve)
      if (node.callee.name === 'cva') return node.arguments.length > 0 ? resolve(node.arguments[0]) : []
      const init = constInitializer(context, node.callee)
      if (init?.type === 'CallExpression' && init.callee.type === 'Identifier' && init.callee.name === 'cva') {
        return resolve(init)
      }
      return []
    }
    default:
      return []
  }
}

function bareClass(token) {
  let depth = 0
  let cut = 0
  const prefixes = []
  for (let index = 0; index < token.length; index += 1) {
    const char = token[index]
    if (char === '[') depth += 1
    else if (char === ']') depth -= 1
    else if (char === ':' && depth === 0) {
      prefixes.push(token.slice(cut, index))
      cut = index + 1
    }
  }
  if (!prefixes.every((prefix) => RESPONSIVE_PREFIXES.has(prefix))) return null
  return token.slice(cut).replace(/^!/, '').replace(/!$/, '')
}

function sizeValue(raw) {
  return raw === 'px' ? 0.25 : Number(raw)
}

export function describeClasses(tokens) {
  const classes = tokens.map(bareClass).filter(Boolean)
  const borderRemoved = classes.some((name) => BORDER_REMOVED.test(name))
  const hasFullBorder = classes.some((name) => FULL_BORDER.test(name))
  const colours = classes.filter((name) => name.startsWith('border-') && !BORDER_NOT_A_COLOUR.test(name))
  const transparent = colours.length > 0 && colours.every((name) => BORDER_TRANSPARENT.test(name))
  const radii = classes.filter((name) => ALL_CORNER_RADIUS.test(name))
  const lastRadius = radii[radii.length - 1]
  const sizes = new Map()
  for (const name of classes) {
    const match = SIZE_UTILITY.exec(name)
    if (match) sizes.set(match[1], sizeValue(match[2]))
  }
  const height = sizes.get('size') ?? sizes.get('h')
  const width = sizes.get('size') ?? sizes.get('w')
  return {
    border: hasFullBorder && !borderRemoved && !transparent,
    borderRemoved: borderRemoved || transparent,
    radius: Boolean(lastRadius) && !RADIUS_NOT_A_FRAME.test(lastRadius),
    dashed: classes.some((name) => DASHED.test(name)),
    inline: classes.some((name) => INLINE_DISPLAY.test(name)),
    floating: classes.some((name) => FLOATING_POSITION.test(name)),
    controlChrome: colours.some((name) => CONTROL_BORDER.test(name)),
    small:
      (height !== undefined && width !== undefined && height <= SMALL_SIZE_LIMIT && width <= SMALL_SIZE_LIMIT) ||
      (height !== undefined && height <= SMALL_SIZE_LIMIT && width === undefined),
  }
}

function jsxName(nameNode) {
  if (nameNode.type === 'JSXIdentifier') return nameNode.name
  if (nameNode.type === 'JSXMemberExpression') return `${jsxName(nameNode.object)}.${nameNode.property.name}`
  if (nameNode.type === 'JSXNamespacedName') return `${nameNode.namespace.name}:${nameNode.name.name}`
  return ''
}

function findAttribute(openingElement, name) {
  return openingElement.attributes.find(
    (attribute) => attribute.type === 'JSXAttribute' && attribute.name?.name === name,
  )
}

function staticAttributeValue(attribute) {
  const value = attribute?.value
  if (!value) return null
  if (value.type === 'Literal') return value.value
  if (value.type === 'JSXExpressionContainer' && value.expression.type === 'Literal') return value.expression.value
  return null
}

function hostName(name) {
  return name.startsWith('motion.') ? name.slice('motion.'.length) : name
}

function isHostElement(name) {
  return /^[a-z]/.test(name)
}

function isControl(openingElement, name) {
  if (isHostElement(name)) {
    if (CONTROL_ELEMENTS.has(name)) return true
  } else if (name.split('.').some((segment) => CONTROL_COMPONENT.test(segment))) {
    return true
  }
  if (findAttribute(openingElement, 'onClick')) return true
  const role = staticAttributeValue(findAttribute(openingElement, 'role'))
  return typeof role === 'string' && CONTROL_ROLES.has(role)
}

function isFlagSet(attribute) {
  if (!attribute) return false
  if (!attribute.value) return true
  return staticAttributeValue(attribute) !== false
}

function isFrameComponent(openingElement, name) {
  const entry = FRAME_COMPONENTS.find((candidate) => candidate.component === name)
  if (!entry) return false
  if (entry.unlessFlag) return !isFlagSet(findAttribute(openingElement, entry.unlessFlag))
  if (!entry.attribute) return true
  const attribute = findAttribute(openingElement, entry.attribute)
  if (!attribute) return entry.appliesByDefault === true
  return staticAttributeValue(attribute) === entry.value
}

function unwrapComponent(node) {
  if (!node) return null
  if (NESTED_FUNCTIONS.has(node.type)) return node
  if (node.type !== 'CallExpression') return null
  const callee = node.callee.type === 'MemberExpression' ? node.callee.property : node.callee
  if (callee.type !== 'Identifier' || !COMPONENT_WRAPPERS.has(callee.name)) return null
  return node.arguments.map(unwrapComponent).find(Boolean) ?? null
}

function returnedExpressions(functionNode) {
  if (functionNode.body.type !== 'BlockStatement') return [functionNode.body]
  const found = []
  const queue = [functionNode.body]
  while (queue.length > 0) {
    const current = queue.pop()
    if (current.type === 'ReturnStatement') {
      if (current.argument) found.push(current.argument)
      continue
    }
    for (const key of Object.keys(current)) {
      if (SKIPPED_KEYS.has(key)) continue
      const value = current[key]
      const children = Array.isArray(value) ? value : [value]
      for (const child of children) {
        if (child && typeof child.type === 'string' && !NESTED_FUNCTIONS.has(child.type)) queue.push(child)
      }
    }
  }
  return found
}

function rootElements(expression) {
  if (!expression) return []
  if (expression.type === 'JSXElement') return [expression]
  if (expression.type === 'ConditionalExpression') {
    return [...rootElements(expression.consequent), ...rootElements(expression.alternate)]
  }
  if (expression.type === 'LogicalExpression') return rootElements(expression.right)
  return []
}

export function createFrameClassifier(context) {
  const classified = new WeakMap()
  const localComponents = new Map()
  const resolving = new Set()

  function localSurface(name) {
    const functionNode = localComponents.get(name)
    if (!functionNode || resolving.has(name)) return null
    resolving.add(name)
    const roots = returnedExpressions(functionNode).flatMap(rootElements)
    const kinds = roots.map((root) => classify(root)?.kind ?? null)
    resolving.delete(name)
    if (kinds.length === 0 || kinds.some((kind) => kind !== kinds[0])) return null
    return kinds[0]
  }

  function compute(element) {
    const openingElement = element.openingElement
    const name = hostName(jsxName(openingElement.name))
    if (!name) return null
    if (OVERLAY_BOUNDARIES.has(name) || OVERLAY_PRIMITIVE.test(name)) return { kind: 'boundary', name }
    const classAttribute = findAttribute(openingElement, 'className')
    const look = describeClasses(classAttribute ? alwaysAppliedClasses(context, classAttribute.value) : [])
    const local = isHostElement(name) ? null : localSurface(name)
    if (local === 'boundary') return { kind: 'boundary', name }
    if (local === 'frame' || (!localComponents.has(name) && isFrameComponent(openingElement, name))) {
      return look.borderRemoved ? null : { kind: 'frame', name }
    }
    if (!look.border || !look.radius) return null
    if (look.floating) return { kind: 'boundary', name }
    if (look.small || look.inline || look.dashed || look.controlChrome) return null
    if (isControl(openingElement, name)) return null
    return { kind: 'frame', name }
  }

  function classify(element) {
    if (!classified.has(element)) classified.set(element, compute(element))
    return classified.get(element)
  }

  function registerComponent(name, node) {
    const functionNode = unwrapComponent(node)
    if (functionNode && /^[A-Z]/.test(name)) localComponents.set(name, functionNode)
  }

  return { classify, registerComponent }
}

function baselineIndex(baseline) {
  const index = new Map()
  for (const entry of baseline) {
    index.set(`${entry.file}#${entry.outer}>${entry.inner}`, entry.count ?? 1)
  }
  return index
}

const baselineIndexes = new WeakMap()

function allowedCount(baseline, filename, outer, inner) {
  if (baseline.length === 0) return 0
  let index = baselineIndexes.get(baseline)
  if (!index) {
    index = { entries: baselineIndex(baseline), files: [...new Set(baseline.map((entry) => entry.file))] }
    baselineIndexes.set(baseline, index)
  }
  const normalized = normalizePath(filename)
  const file = index.files.find((candidate) => normalized === candidate || normalized.endsWith(`/${candidate}`))
  if (!file) return 0
  return index.entries.get(`${file}#${outer}>${inner}`) ?? 0
}

export const noNestedFrames = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow a framed surface (border plus radius) nested inside another framed surface',
    },
    messages: {
      nestedFrame:
        'Frame `<{{inner}}>` is nested inside frame `<{{outer}}>` — separate it with spacing, a heading, a divider or a muted background instead of a second border (see "Frames: one level only" in .ai/ds-rules.md).',
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
                outer: { type: 'string', minLength: 1 },
                inner: { type: 'string', minLength: 1 },
                count: { type: 'integer', minimum: 1 },
              },
              required: ['file', 'outer', 'inner'],
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
    const classifier = createFrameClassifier(context)
    const elements = []

    function enclosingSurface(element) {
      let current = element.parent
      while (current) {
        if (current.type === 'JSXElement') {
          const surface = classifier.classify(current)
          if (surface) return surface
        }
        current = current.parent
      }
      return null
    }

    return {
      FunctionDeclaration(node) {
        if (node.id) classifier.registerComponent(node.id.name, node)
      },
      VariableDeclarator(node) {
        if (node.id.type === 'Identifier') classifier.registerComponent(node.id.name, node.init)
      },
      JSXElement(node) {
        elements.push(node)
      },
      'Program:exit'() {
        const seen = new Map()
        for (const element of elements) {
          const own = classifier.classify(element)
          if (!own || own.kind !== 'frame') continue
          const outer = enclosingSurface(element)
          if (!outer || outer.kind !== 'frame') continue
          const pair = `${outer.name}>${own.name}`
          const occurrence = seen.get(pair) ?? 0
          seen.set(pair, occurrence + 1)
          if (occurrence < allowedCount(baseline, filename, outer.name, own.name)) continue
          context.report({
            node: element.openingElement,
            messageId: 'nestedFrame',
            data: { inner: own.name, outer: outer.name },
          })
        }
      },
    }
  },
}
