export type MarkdownCodeBlockLanguageLabel = string | { label: string; labelKey?: string }

export type MarkdownCodeBlockLanguages = Readonly<Record<string, MarkdownCodeBlockLanguageLabel | null>>

const DEFAULT_CODE_BLOCK_LANGUAGES: Readonly<Record<string, string>> = {
  js: 'JavaScript',
  jsx: 'JavaScript (React)',
  ts: 'TypeScript',
  tsx: 'TypeScript (React)',
  json: 'JSON',
  html: 'HTML',
  css: 'CSS',
  sql: 'SQL',
  python: 'Python',
  bash: 'Bash',
  sh: 'Shell',
  yaml: 'YAML',
  markdown: 'Markdown',
}

export function resolveMarkdownCodeBlockLanguages(
  translate: (key: string, fallback: string) => string,
  overrides?: MarkdownCodeBlockLanguages,
): Record<string, string> {
  const languages = new Map(Object.entries({
    '': translate('ui.forms.richtext.plainText', 'Plain text'),
    ...DEFAULT_CODE_BLOCK_LANGUAGES,
  }))

  for (const [language, label] of Object.entries(overrides ?? {})) {
    if (label === null) {
      if (language !== '') languages.delete(language)
    } else {
      languages.set(language, typeof label === 'string'
        ? label
        : label.labelKey ? translate(label.labelKey, label.label) : label.label)
    }
  }

  return Object.fromEntries(languages)
}
