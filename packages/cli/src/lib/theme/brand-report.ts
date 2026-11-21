/**
 * Markdown import report renderer for `mercato theme from-figma`.
 *
 * A dated working artifact (`.ai/reports/` convention): regenerated on demand,
 * never a source of truth. Pure and deterministic — same inputs, same bytes.
 * Never sees the Figma token (it only receives the extraction artifact).
 */

import type { ContrastCheck } from './init'
import { formatContrastRatio } from './contrast'
import type { DerivedPalette } from './palette'
import type { BrandCandidate, BrandExtraction } from './figma-extract'

export type ConfirmedMapping = {
  primary: string
  primaryForeground: string | null
  radius: string | null
  font: string | null
  fontMono: string | null
}

export type BrandReportOptions = {
  extraction: BrandExtraction
  /** Null in `--report-only` mode — no mapping was performed. */
  mapping: ConfirmedMapping | null
  /** Derived by the shared `theme init` pipeline; null in `--report-only`. */
  palette: DerivedPalette | null
  checks: ContrastCheck[] | null
  /** Free-form notices (e.g. `--map` value not found in the file). */
  notes?: string[]
}

/**
 * Escapes `|` so a remote-sourced or user-supplied string cannot break out of
 * a markdown table cell. Control characters are already stripped at extraction
 * intake (`sanitizeRemoteString`); the pipe is the one remaining character with
 * structural meaning inside a GFM table row.
 */
function mdCell(value: string): string {
  return value.replace(/\|/g, '\\|')
}

/** One-line evidence string for a candidate — shared by prompt and report. */
export function describeCandidateEvidence(candidate: BrandCandidate): string {
  const parts: string[] = []
  if (candidate.variableName) parts.push(`variable "${candidate.variableName}"`)
  for (const name of candidate.styleNames) parts.push(`style "${name}"`)
  const usage = candidate.sources.filter((source) => source !== 'style' && source !== 'variable')
  if (usage.length > 0) parts.push(usage.join(' + '))
  return parts.length > 0 ? parts.join(', ') : 'no recorded usage'
}

function sourceLabel(availability: string): string {
  switch (availability) {
    case 'ok': return 'available'
    case 'unavailable-plan-gated': return 'unavailable (plan-gated — styles + fill analysis used instead)'
    default: return 'error'
  }
}

function candidateRank(extraction: BrandExtraction, hex: string): number | null {
  const index = extraction.candidates.findIndex((candidate) => candidate.hex === hex.toLowerCase())
  return index >= 0 ? index + 1 : null
}

function mappedEvidence(extraction: BrandExtraction, hex: string): string {
  const rank = candidateRank(extraction, hex)
  if (rank === null) return 'not found in the file (supplied directly)'
  const candidate = extraction.candidates[rank - 1]
  return `candidate #${rank}, ${candidate.count} uses, ${describeCandidateEvidence(candidate)}`
}

export function renderBrandReport(options: BrandReportOptions): string {
  const { extraction, mapping, palette, checks } = options
  const notes = options.notes ?? []
  const lines: string[] = []
  const frames = extraction.source.frames
  const excluded = extraction.source.excluded

  lines.push(`# Figma brand import — ${extraction.file.name || extraction.file.key}`)
  lines.push('')
  lines.push('## Source summary')
  lines.push('')
  lines.push(`- **File:** \`${extraction.file.key}\`${extraction.file.name ? ` ("${extraction.file.name}")` : ''}`)
  lines.push(`- **Last modified:** ${extraction.file.lastModified || 'unknown'}`)
  lines.push(`- **Extracted:** ${extraction.file.extractedAt}`)
  lines.push(`- **Variables API:** ${sourceLabel(extraction.source.variables)}`)
  lines.push(`- **Local styles:** ${sourceLabel(extraction.source.styles)}`)
  lines.push(
    `- **Scan coverage:** ${frames.pagesScanned} page(s), ${frames.framesScanned} top-level frame(s), ` +
      `${frames.nodesVisited} node(s) visited (budget ${frames.nodeBudget})${frames.truncated ? ' — **truncated at the node budget**; re-run with `--pages` to focus the scan' : ''}`,
  )
  lines.push(
    `- **Excluded from ranking:** ${excluded.image} image fill(s), ${excluded.gradient} gradient(s), ` +
      `${excluded.alpha} semi-transparent fill(s) — raw hexes under opacity or imagery are not brand evidence`,
  )
  const failedBatches = extraction.source.failedBatches
  if (failedBatches && failedBatches.styles + failedBatches.frames > 0) {
    lines.push(
      `- **Failed request batches:** ${failedBatches.styles} style batch(es) and ${failedBatches.frames} frame batch(es) ` +
        'failed after retries — **the inventory is incomplete**; candidate and usage counts may be undercounted',
    )
  }
  lines.push('')

  for (const note of notes) {
    lines.push(`> ${note}`)
    lines.push('')
  }

  lines.push('## Mapped values')
  lines.push('')
  const mappedHexes = new Set<string>()
  if (!mapping || !palette) {
    lines.push('_No mapping performed (`--report-only`). Re-run without `--report-only` to map candidates onto the theme token contract._')
    lines.push('')
  } else {
    mappedHexes.add(mapping.primary.toLowerCase())
    lines.push('| Token | Value | Evidence |')
    lines.push('|---|---|---|')
    lines.push(`| \`--primary\` | \`${mapping.primary}\` | ${mdCell(mappedEvidence(extraction, mapping.primary))} |`)
    if (mapping.primaryForeground) {
      mappedHexes.add(mapping.primaryForeground.toLowerCase())
      lines.push(`| \`--primary-foreground\` | \`${mapping.primaryForeground}\` | explicit designer choice |`)
    }
    if (mapping.radius) lines.push(`| \`--radius\` | \`${mdCell(mapping.radius)}\` | radius histogram: ${extraction.radii.map((bucket) => `${bucket.px}px×${bucket.count}`).join(', ') || 'empty'} |`)
    if (mapping.font) lines.push(`| \`--font-geist-sans\` | \`${mdCell(mapping.font)}\` | fonts in file: ${mdCell(extraction.fonts.map((font) => font.family).join(', ')) || 'none extracted'} |`)
    if (mapping.fontMono) lines.push(`| \`--font-geist-mono\` | \`${mdCell(mapping.fontMono)}\` | manual step — the generator does not emit mono font overrides; add it to theme.css yourself |`)
    lines.push('')
    lines.push('Derived by the shared `theme init` pipeline:')
    lines.push('')
    lines.push('| Token | Light | Dark |')
    lines.push('|---|---|---|')
    lines.push(`| \`--primary\` | \`${palette.light.primary}\` | \`${palette.dark.primary}\` |`)
    lines.push(`| \`--primary-hover\` | \`${palette.light.primaryHover}\` | \`${palette.dark.primaryHover}\` |`)
    lines.push(
      `| \`--primary-foreground\` | \`${palette.light.primaryForeground.hex}\`${palette.light.primaryForeground.autoPicked ? ' (auto)' : ''} ` +
        `| \`${palette.dark.primaryForeground.hex}\`${palette.dark.primaryForeground.autoPicked ? ' (auto)' : ''} |`,
    )
    lines.push('')
  }

  lines.push('## Contrast results (WCAG 2.1)')
  lines.push('')
  if (!checks || checks.length === 0) {
    lines.push('_Not computed — contrast is checked when a mapping is confirmed._')
    lines.push('')
  } else {
    lines.push('| Mode | Pair | Ratio | Requires | Verdict |')
    lines.push('|---|---|---|---|---|')
    for (const check of checks) {
      lines.push(
        `| ${check.mode} | ${check.pair} | ${formatContrastRatio(check.ratio)} | ${formatContrastRatio(check.threshold)} | ${check.verdict}${check.detail ? ` — ${check.detail}` : ''} |`,
      )
    }
    lines.push('')
  }

  lines.push('## Unmapped candidates')
  lines.push('')
  const unmapped = extraction.candidates.filter((candidate) => !mappedHexes.has(candidate.hex))
  if (unmapped.length === 0) {
    lines.push('_None — every extracted candidate was mapped._')
    lines.push('')
  } else {
    lines.push(
      'Not imported, **by design**: the import surface is exactly the safe identity tokens. ' +
        'Secondary accents, illustration palettes, and neutral scales stay out of `theme.css` — ' +
        'see the advanced-overrides section of the Brand your app docs before touching anything below.',
    )
    lines.push('')
    lines.push('| # | Hex | Uses | Tier | Evidence |')
    lines.push('|---|---|---|---|---|')
    let rank = 0
    for (const candidate of extraction.candidates) {
      rank += 1
      if (mappedHexes.has(candidate.hex)) continue
      lines.push(`| ${rank} | \`${candidate.hex}\` | ${candidate.count} | ${candidate.tier} | ${mdCell(describeCandidateEvidence(candidate))} |`)
    }
    lines.push('')
  }

  lines.push('## Suggested next steps')
  lines.push('')
  if (mapping?.font) {
    lines.push(`- Load the "${mapping.font}" font (next/font in \`layout.tsx\`, or \`@font-face\` in \`theme.css\`) — the token override alone does nothing until the font is loaded.`)
  } else {
    lines.push('- If you map a font later, remember loading it (next/font or `@font-face`) is your responsibility.')
  }
  if (mapping?.fontMono) {
    lines.push(`- Add \`--font-geist-mono: ${mapping.fontMono}, …\` to \`theme.css\` by hand — the generator does not emit mono overrides.`)
  }
  lines.push("- Review the generated `.dark` block against the client's dark-mode designs, if any exist.")
  lines.push('- Re-run `mercato theme from-figma <key> --report-only` after the client updates their file.')
  lines.push('- Run MODE B of the `om-figma-design-with-ds` skill (attach the extraction JSON) for a full screen-level audit.')
  lines.push('')

  return lines.join('\n')
}
