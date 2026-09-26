/**
 * A very small XML writer whose output is already in canonical form.
 *
 * ZATCA hashes the invoice XML *after* canonicalizing it (C14N), so a builder
 * that produces accidental non-canonical XML would silently change every invoice
 * hash. Rather than canonicalizing afterwards with a general purpose library, this
 * writer refuses to emit anything canonicalization would rewrite:
 *
 *   - namespaces are declared once, on the root element, sorted by prefix (the
 *     default namespace first) — C14N sorts namespace nodes by prefix;
 *   - attributes are sorted by name and may not be prefixed, which makes the
 *     "namespace URI, then local name" ordering rule the plain lexicographic one;
 *   - text has `&`, `<`, `>` and carriage returns escaped;
 *   - attribute values are normalized (tabs, newlines and carriage returns become
 *     spaces) and then escaped, which is exactly what a parser hands to C14N;
 *   - empty elements are written as `<a></a>`, never `<a/>`;
 *   - no XML declaration, no comments, no processing instructions, no indentation
 *     (the reference implementation's pre-hash transform sets `indent="no"` and
 *     `omit-xml-declaration="yes"` too).
 *
 * Anything that cannot be represented canonically throws instead of being
 * papered over: an invoice that fails here fails before it is signed.
 */

export type XmlAttributes = Record<string, string | number | null | undefined>

export type XmlNode =
  | { readonly name: string; readonly attributes?: XmlAttributes; readonly children: readonly XmlNode[] }
  | { readonly name: string; readonly attributes?: XmlAttributes; readonly text: string }

const ELEMENT_NAME = /^[A-Za-z_][\w.-]*(?::[\w.-]+)?$/

export class CanonicalXmlError extends Error {
  constructor(message: string) {
    super(`[internal] ${message}`)
    this.name = 'CanonicalXmlError'
  }
}

function assertName(name: string, kind: 'element' | 'attribute'): void {
  const valid = kind === 'element' ? ELEMENT_NAME.test(name) : !name.includes(':') && ELEMENT_NAME.test(name)
  if (!valid) {
    throw new CanonicalXmlError(
      kind === 'element'
        ? `"${name}" is not a usable element name.`
        : `"${name}" is not a usable attribute name (prefixed attributes would make canonical ordering ambiguous).`,
    )
  }
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#xD;')
}

function escapeAttribute(value: string): string {
  return value
    .replace(/[\t\n\r]/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function serializeAttributes(attributes: XmlAttributes | undefined): string {
  if (!attributes) return ''
  const names = Object.keys(attributes)
    .filter((name) => attributes[name] !== null && attributes[name] !== undefined)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
  let output = ''
  for (const name of names) {
    assertName(name, 'attribute')
    output += ` ${name}="${escapeAttribute(String(attributes[name]))}"`
  }
  return output
}

export function xmlElement(
  name: string,
  children: readonly XmlNode[] = [],
  attributes?: XmlAttributes,
): XmlNode {
  assertName(name, 'element')
  return { name, children, attributes }
}

export function xmlText(name: string, text: string | number, attributes?: XmlAttributes): XmlNode {
  assertName(name, 'element')
  return { name, text: String(text), attributes }
}

function serializeNode(node: XmlNode, output: string[]): void {
  const attributes = serializeAttributes(node.attributes)
  if ('text' in node) {
    output.push(`<${node.name}${attributes}>${escapeText(node.text)}</${node.name}>`)
    return
  }
  output.push(`<${node.name}${attributes}>`)
  for (const child of node.children) serializeNode(child, output)
  output.push(`</${node.name}>`)
}

function serializeNamespaces(namespaces: Readonly<Record<string, string>>): string {
  const entries = Object.entries(namespaces).map(([prefix, uri]) => [prefix, uri] as const)
  for (const [prefix, uri] of entries) {
    if (prefix !== '' && !ELEMENT_NAME.test(prefix)) {
      throw new CanonicalXmlError(`"${prefix}" is not a usable namespace prefix.`)
    }
    if (uri.trim() === '') {
      throw new CanonicalXmlError(`The namespace "${prefix}" has an empty URI.`)
    }
  }
  entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  return entries.map(([prefix, uri]) => (prefix === '' ? ` xmlns="${escapeAttribute(uri)}"` : ` xmlns:${prefix}="${escapeAttribute(uri)}"`)).join('')
}

/**
 * Serializes one root element plus its namespace declarations, in canonical form.
 */
export function serializeCanonicalXml(
  root: XmlNode,
  namespaces: Readonly<Record<string, string>> = {},
): string {
  const output: string[] = [`<${root.name}${serializeNamespaces(namespaces)}${serializeAttributes(root.attributes)}>`]
  if ('text' in root) {
    output.push(escapeText(root.text), `</${root.name}>`)
    return output.join('')
  }
  for (const child of root.children) serializeNode(child, output)
  output.push(`</${root.name}>`)
  return output.join('')
}
