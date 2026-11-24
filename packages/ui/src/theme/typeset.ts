export type TypesetContext = 'record' | 'document'

export type TypesetSettings = {
  size: number
  leading: number
  measure: number
}

export const typesetPresets: Record<TypesetContext, TypesetSettings> = {
  record: { size: 16, leading: 1.5, measure: 54 },
  document: { size: 18, leading: 1.65, measure: 66 },
}

export function typesetVariables(settings: TypesetSettings) {
  return {
    '--om-type-size': `${settings.size / 16}rem`,
    '--om-type-leading': String(settings.leading),
    '--om-type-measure': `${settings.measure}ch`,
  }
}

export const typesetRules = `.om-typeset {
  max-inline-size: min(100%, var(--om-type-measure, 66ch));
  min-inline-size: 0;
  color: var(--foreground);
  font-family: var(--font-sans, var(--font-geist-sans, system-ui)), sans-serif;
  font-size: var(--om-type-size, 1rem);
  line-height: var(--om-type-leading, 1.5);
  overflow-wrap: anywhere;
}
.om-typeset :where(h1, h2, h3, h4, h5, h6, p, ol, ul, dl, blockquote, pre, table) { margin: 0; }
.om-typeset > * + * { margin-block-start: 0.85em; }
.om-typeset :where(h1, h2, h3, h4, h5, h6) { font-weight: 600; line-height: 1.2; text-wrap: balance; }
.om-typeset h1 { font-size: 2em; letter-spacing: -0.025em; }
.om-typeset h2 { font-size: 1.375em; }
.om-typeset h3 { font-size: 1.125em; }
.om-typeset > * + :where(h2, h3, h4, h5, h6) { margin-block-start: 1.4em; }
.om-typeset :where(ol, ul) { padding-inline-start: 1.4em; }
.om-typeset ul { list-style: disc; }
.om-typeset ol { list-style: decimal; }
.om-typeset li + li { margin-block-start: 0.25em; }
.om-typeset a { color: inherit; text-decoration: underline; text-underline-offset: 0.18em; }
.om-typeset blockquote { padding-inline-start: 1em; border-inline-start: 0.2em solid var(--border); }
.om-typeset :where(code, pre, [data-type="id"]) { font-family: var(--font-geist-mono, ui-monospace), monospace; }
.om-typeset pre { max-inline-size: 100%; overflow-x: auto; padding: 0.75em; background: var(--muted); }
.om-typeset :where(dt, th, [data-type="meta"]) { font-size: 0.875em; color: var(--muted-foreground); }
.om-typeset dt { font-weight: 500; }
.om-typeset dd { margin: 0; }
.om-typeset dl { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 12em), 1fr)); gap: 0.75em 1.25em; }
.om-typeset table { inline-size: 100%; border-collapse: collapse; }
.om-typeset :where(th, td) { padding: 0.5em 0.25em; border-block-end: 1px solid var(--border); text-align: start; }
.om-typeset [data-type="amount"] { font-variant-numeric: tabular-nums; text-align: end; }`

export function createTypesetStylesheet(context: TypesetContext, settings = typesetPresets[context]): string {
  const declarations = Object.entries(typesetVariables(settings)).map(([name, value]) => `  ${name}: ${value};`)
  return `${typesetRules}\n\n.om-typeset-${context} {\n${declarations.join('\n')}\n}\n`
}
