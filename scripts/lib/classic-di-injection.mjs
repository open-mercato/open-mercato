/**
 * Analyser for Awilix CLASSIC-mode `asFunction` registrations in BUILT output.
 *
 * `createRequestContainer()` builds the request container with
 * `InjectionMode.CLASSIC`, so Awilix derives each factory's dependency keys by
 * parsing parameter names out of `fn.toString()`. That makes a parameter name a
 * load-bearing part of the wiring, and the bundler is free to rewrite it:
 * esbuild renames a parameter that shadows an enclosing binding (`em` -> `em2`),
 * after which the container looks up a key nobody registered.
 *
 * Nothing that runs on source can see this. Jest executes TypeScript through
 * ts-jest, where the name is still `em` and the registration resolves; the
 * failure exists only in `dist/`, which is what gets published and deployed.
 * Hence an analyser over the built artefact.
 *
 * Two distinct failure modes are detected:
 *
 *   1. A positional parameter whose name is not a registered DI key. Awilix
 *      throws `AwilixResolutionError` at resolve time — loud, but only in
 *      production, and only on the code path that resolves that key.
 *   2. A destructured parameter (`({ em, eventBus }) => ...`) on a registration
 *      that did not opt into PROXY mode. CLASSIC passes the dependencies
 *      POSITIONALLY, so the factory destructures the first dependency instead
 *      of a cradle and every field comes out `undefined`. Nothing throws; the
 *      service silently degrades.
 *
 * `.proxy()` opts a single registration back into cradle injection and makes
 * both moot, so such registrations are skipped.
 */

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/

function skipTrivia(source, index) {
  let cursor = index
  while (cursor < source.length) {
    const char = source[cursor]
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      cursor += 1
      continue
    }
    if (char === '/' && source[cursor + 1] === '/') {
      const lineEnd = source.indexOf('\n', cursor)
      cursor = lineEnd === -1 ? source.length : lineEnd + 1
      continue
    }
    if (char === '/' && source[cursor + 1] === '*') {
      const blockEnd = source.indexOf('*/', cursor + 2)
      cursor = blockEnd === -1 ? source.length : blockEnd + 2
      continue
    }
    return cursor
  }
  return cursor
}

/**
 * Index of the character after the `)` matching the `(` at `openIndex`.
 * String and template literals are skipped so a paren inside them cannot
 * unbalance the scan.
 */
function matchParen(source, openIndex) {
  let depth = 0
  let cursor = openIndex
  while (cursor < source.length) {
    const char = source[cursor]
    if (char === '"' || char === "'" || char === '`') {
      cursor += 1
      while (cursor < source.length && source[cursor] !== char) {
        cursor += source[cursor] === '\\' ? 2 : 1
      }
      cursor += 1
      continue
    }
    if (char === '(') depth += 1
    else if (char === ')') {
      depth -= 1
      if (depth === 0) return cursor + 1
    }
    cursor += 1
  }
  return -1
}

/**
 * Split a parameter list on top-level commas, ignoring commas nested in
 * destructuring patterns, defaults and call expressions.
 */
function splitTopLevel(text) {
  const parts = []
  let depth = 0
  let start = 0
  for (let cursor = 0; cursor < text.length; cursor += 1) {
    const char = text[cursor]
    if (char === '(' || char === '[' || char === '{') depth += 1
    else if (char === ')' || char === ']' || char === '}') depth -= 1
    else if (char === ',' && depth === 0) {
      parts.push(text.slice(start, cursor))
      start = cursor + 1
    }
  }
  parts.push(text.slice(start))
  return parts.map((part) => part.trim()).filter((part) => part.length > 0)
}

/**
 * Parameters of the factory expression starting at `index`.
 *
 * Returns `null` when the factory is a bare reference (`asFunction(makeThing)`)
 * rather than a literal, because its parameters are declared elsewhere and the
 * text at this call site cannot describe them.
 */
function readFactoryParameters(source, index) {
  let cursor = skipTrivia(source, index)
  if (source.startsWith('async', cursor) && !IDENTIFIER.test(source[cursor + 5] ?? '')) {
    cursor = skipTrivia(source, cursor + 5)
  }
  if (source.startsWith('function', cursor) && !IDENTIFIER.test(source[cursor + 8] ?? '')) {
    cursor = skipTrivia(source, cursor + 8)
    if (source[cursor] === '*') cursor = skipTrivia(source, cursor + 1)
    while (cursor < source.length && IDENTIFIER.test(source[cursor])) cursor += 1
    cursor = skipTrivia(source, cursor)
  }
  if (source[cursor] === '(') {
    const close = matchParen(source, cursor)
    if (close === -1) return null
    return splitTopLevel(source.slice(cursor + 1, close - 1))
  }
  // A paren-less arrow function (`em => ...`) has exactly one parameter; an
  // identifier NOT followed by `=>` is a reference to a factory declared
  // elsewhere, which this call site cannot describe.
  let end = cursor
  while (end < source.length && IDENTIFIER.test(source[end])) end += 1
  if (end === cursor) return null
  const name = source.slice(cursor, end)
  const after = skipTrivia(source, end)
  if (!source.startsWith('=>', after)) return null
  return [name]
}

/** The resolver modifier chain (`.scoped().proxy()`) following a registration. */
function readModifierChain(source, index) {
  const chain = source.slice(index, index + 200)
  const stop = chain.search(/[,;\n]/)
  return stop === -1 ? chain : chain.slice(0, stop)
}

const REGISTRATION_KEY = /(?:^|[\s,{(])(?:"([\w$]+)"|'([\w$]+)'|([\w$]+))\s*:\s*(asValue|asClass|asFunction|aliasTo)\s*\(/g

/** Every DI key the file registers, whatever the resolver kind. */
export function collectRegisteredKeys(source) {
  const keys = new Set()
  for (const match of source.matchAll(REGISTRATION_KEY)) {
    keys.add(match[1] ?? match[2] ?? match[3])
  }
  return keys
}

/**
 * Every `asFunction` registration in `source`, with the parameter names Awilix
 * would resolve under CLASSIC injection.
 */
export function collectAsFunctionRegistrations(source) {
  const registrations = []
  for (const match of source.matchAll(REGISTRATION_KEY)) {
    if (match[4] !== 'asFunction') continue
    const key = match[1] ?? match[2] ?? match[3]
    const openIndex = match.index + match[0].length - 1
    const closeIndex = matchParen(source, openIndex)
    const parameters = readFactoryParameters(source, openIndex + 1)
    registrations.push({
      key,
      line: source.slice(0, match.index).split('\n').length,
      parameters,
      modifiers: closeIndex === -1 ? '' : readModifierChain(source, closeIndex),
    })
  }
  return registrations
}

/**
 * Violations for one built file, given the DI keys registered across the whole
 * workspace.
 */
export function analyzeFile({ file, source, knownKeys }) {
  const violations = []
  for (const registration of collectAsFunctionRegistrations(source)) {
    const { key, line, parameters, modifiers } = registration
    if (parameters === null || parameters.length === 0) continue
    if (modifiers.includes('.proxy(')) continue

    for (const parameter of parameters) {
      if (parameter.startsWith('{')) {
        violations.push({
          file,
          line,
          key,
          parameter,
          kind: 'destructured-without-proxy',
          message:
            `\`${key}\` destructures its factory parameter but is not registered with \`.proxy()\`. ` +
            'CLASSIC injection passes dependencies positionally, so the factory would destructure ' +
            'the first dependency instead of the cradle and every field would be undefined. ' +
            'Add `.proxy()`, or take the dependencies as named positional parameters.',
        })
        continue
      }
      const name = parameter.split('=')[0].trim()
      if (!IDENTIFIER.test(name)) continue
      if (knownKeys.has(name)) continue
      violations.push({
        file,
        line,
        key,
        parameter: name,
        kind: 'unregistered-parameter',
        message:
          `\`${key}\` resolves a dependency named \`${name}\`, which no registration provides. ` +
          'Under CLASSIC injection the parameter NAME is the container key, and a bundler renames ' +
          'a parameter that shadows an enclosing binding — so this resolves in source and throws ' +
          'AwilixResolutionError in the built package. Close over the value instead of naming it, ' +
          'or rename the registration to match.',
      })
    }
  }
  return violations
}
