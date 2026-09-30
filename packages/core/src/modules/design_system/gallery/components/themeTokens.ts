export type ThemeTokens = { light: Record<string, string>; dark: Record<string, string> }

export function readThemeTokens(sheets: Iterable<CSSStyleSheet>): ThemeTokens {
  const light: Record<string, string> = {}
  const dark: Record<string, string> = {}
  function readRules(rules: CSSRuleList) {
    for (const rule of Array.from(rules)) {
      if ('selectorText' in rule && 'style' in rule) {
        const styleRule = rule as CSSStyleRule
        const selectors = styleRule.selectorText.split(',').map(selector => selector.trim())
        const target = selectors.includes('.dark') ? dark : selectors.includes(':root') ? light : null
        if (target) {
          for (const property of Array.from(styleRule.style)) {
            if (property.startsWith('--')) target[property] = styleRule.style.getPropertyValue(property).trim()
          }
        }
      }
      if ('cssRules' in rule) readRules((rule as CSSGroupingRule).cssRules)
    }
  }
  for (const sheet of sheets) {
    if (sheet.ownerNode instanceof Element && sheet.ownerNode.id === 'om-brand-style') continue
    try { readRules(sheet.cssRules) } catch { continue }
  }
  return { light, dark: { ...light, ...dark } }
}
