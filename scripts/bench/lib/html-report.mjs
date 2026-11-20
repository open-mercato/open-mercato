// Self-contained HTML view of saved request-cost reports (unit-tested in scripts/__tests__).
//
// No scripts, fonts or other external resources: charts are inline SVG rendered here, tooltips
// are SVG <title> elements, so the file opens from disk, as a CI artifact or attached to a PR.
// The first report is the baseline; later ones show the change in queries per request.

const MAX_CHART_RUNS = 8
const TOP_STATEMENTS = 10

// Categorical slots in fixed order (validated for adjacent bars in both themes). Runs past the
// eighth are left out of the charts but stay in the tables.
const SERIES = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const num = (value, digits = 1) => (value == null || Number.isNaN(Number(value)) ? '—' : Number(value).toFixed(digits))
const ms = (value) => (value == null ? '—' : value >= 1000 ? `${num(value / 1000, 2)} s` : `${num(value, value < 10 ? 1 : 0)} ms`)
const statuses = (s) => Object.entries(s?.statuses ?? {}).map(([k, v]) => `${escapeHtml(k)}×${escapeHtml(v)}`).join(' ')

export function queriesDelta(base, value) {
  if (!base || value == null) return null
  return (value / base - 1) * 100
}

function scenarioNames(reports) {
  return [...new Set(reports.flatMap((r) => Object.keys(r.scenarios ?? {})))]
}

function scopeText(scope = {}) {
  if (scope.source === 'dataset') return `${scope.plan ?? 'dataset'} · ${scope.target ?? ''}`
  return scope.source === 'largest-org' ? 'largest organization' : '—'
}

function runsTable(reports) {
  const rows = reports.map((r, i) => `<tr>
      <td>${i < MAX_CHART_RUNS ? `<i class="swatch s${i}"></i>` : ''}<span class="mono">${escapeHtml(r.label)}</span>${i === 0 ? ' <span class="pill">baseline</span>' : ''}</td>
      <td class="mono">${escapeHtml(String(r.startedAt ?? '').replace('T', ' ').slice(0, 19))}</td>
      <td>${escapeHtml(scopeText(r.scope))}</td>
      <td class="n">${escapeHtml(r.scope?.companiesInScope ?? '—')}</td>
      <td class="n">${escapeHtml(r.n ?? '—')} / ${escapeHtml(r.warmup ?? '—')}</td>
      <td class="mono">${escapeHtml(r.acceptLanguage ?? '—')}</td>
      <td class="mono">${escapeHtml(r.base ?? '—')}</td>
    </tr>`).join('')
  return `<div class="table-wrap"><table>
    <thead><tr><th>Run</th><th>Started (UTC)</th><th>Scope</th><th class="n">Companies</th><th class="n">Requests / warm-up</th><th>Accept-Language</th><th>Base URL</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`
}

/** Grouped horizontal bars: queries per request, one bar per run, grouped by scenario. */
function queriesChart(reports, names) {
  const runs = reports.slice(0, MAX_CHART_RUNS)
  const barH = 14
  const gap = 4
  const groupGap = 16
  const labelW = 110
  const valueW = 110
  const W = 760
  const plotW = W - labelW - valueW
  const max = Math.max(1, ...names.flatMap((n) => runs.map((r) => r.scenarios?.[n]?.queriesPerRequest ?? 0)))
  let y = 4
  const parts = []
  for (const name of names) {
    const groupTop = y
    runs.forEach((run, i) => {
      const s = run.scenarios?.[name]
      if (!s) return
      const w = Math.max(1, (s.queriesPerRequest / max) * plotW)
      const delta = i > 0 ? queriesDelta(runs[0].scenarios?.[name]?.queriesPerRequest, s.queriesPerRequest) : null
      const deltaText = delta == null ? '' : ` (${delta >= 0 ? '+' : ''}${num(delta, 0)}%)`
      parts.push(`<g><title>${escapeHtml(name)} · ${escapeHtml(run.label)}: ${num(s.queriesPerRequest, 2)} queries per request${deltaText}</title>
        <rect x="${labelW}" y="${y}" width="${num(w, 1)}" height="${barH}" rx="3" class="s${i}"/>
        <text x="${num(labelW + w + 6, 1)}" y="${y + barH - 3}" class="val">${num(s.queriesPerRequest, 1)}${deltaText}</text></g>`)
      y += barH + gap
    })
    const mid = (groupTop + y - gap) / 2
    parts.push(`<text x="0" y="${num(mid + 4, 1)}" class="lbl">${escapeHtml(name)}</text>`)
    y += groupGap - gap
  }
  const H = y
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Queries per request by scenario and run">
    <line x1="${labelW}" x2="${labelW}" y1="0" y2="${H - groupGap + gap}" class="axis"/>
    ${parts.join('\n')}
  </svg>`
}

/** Mean latency of the latest run split into SQL time and everything else. */
function splitChart(report, names) {
  const rowH = 28
  const labelW = 110
  const valueW = 120
  const W = 760
  const plotW = W - labelW - valueW
  const max = Math.max(1, ...names.map((n) => report.scenarios?.[n]?.latencyMs?.mean ?? 0))
  const rows = names.map((name, i) => {
    const s = report.scenarios?.[name]
    if (!s?.latencyMs?.mean) return ''
    const mean = s.latencyMs.mean
    const sql = Math.min(s.sqlMsPerRequest ?? 0, mean)
    const rest = mean - sql
    const y = i * rowH + 4
    const wSql = (sql / max) * plotW
    const wRest = (rest / max) * plotW
    const gap = wSql > 2 && wRest > 2 ? 2 : 0
    return `<g><title>${escapeHtml(name)}: mean ${ms(mean)}, SQL ${ms(sql)} (${num((sql / mean) * 100, 0)}%), outside SQL ${ms(rest)}</title>
      <text x="0" y="${y + 13}" class="lbl">${escapeHtml(name)}</text>
      <rect x="${labelW}" y="${y}" width="${num(Math.max(wSql - gap / 2, 0.5), 1)}" height="18" rx="3" class="sql"/>
      <rect x="${num(labelW + wSql + gap / 2, 1)}" y="${y}" width="${num(Math.max(wRest - gap / 2, 0.5), 1)}" height="18" rx="3" class="rest"/>
      <text x="${num(labelW + wSql + wRest + 6, 1)}" y="${y + 13}" class="val">${ms(mean)}</text></g>`
  })
  return `<svg viewBox="0 0 ${W} ${names.length * rowH + 6}" role="img" aria-label="Mean latency split into SQL and the rest">${rows.join('\n')}</svg>`
}

function comparisonTable(reports, names) {
  const rows = []
  for (const name of names) {
    const base = reports[0].scenarios?.[name]
    reports.forEach((report, i) => {
      const s = report.scenarios?.[name]
      if (!s) return
      const delta = i > 0 ? queriesDelta(base?.queriesPerRequest, s.queriesPerRequest) : null
      const deltaClass = delta == null || Math.abs(delta) < 0.5 ? '' : delta < 0 ? 'better' : 'worse'
      rows.push(`<tr${i === 0 ? ' class="group-start"' : ''}>
        <td class="mono">${i === 0 ? escapeHtml(name) : ''}</td>
        <td class="mono">${escapeHtml(report.label)}</td>
        <td class="n"><b>${num(s.queriesPerRequest, 2)}</b>${delta == null ? '' : ` <span class="delta ${deltaClass}">${delta >= 0 ? '+' : ''}${num(delta, 0)}%</span>`}</td>
        <td class="n">${num(s.sqlMsPerRequest, 2)}</td>
        <td class="n">${num(s.latencyMs?.p50)}</td>
        <td class="n">${num(s.latencyMs?.p95)}</td>
        <td class="n">${num(s.latencyMs?.p99)}</td>
        <td class="n">${escapeHtml(s.distinctStatements ?? '—')}</td>
        <td>${statuses(s)}</td>
      </tr>`)
    })
  }
  return `<div class="table-wrap"><table>
    <thead><tr><th>Scenario</th><th>Run</th><th class="n">Queries / req</th><th class="n">SQL ms / req</th><th class="n">p50 ms</th><th class="n">p95 ms</th><th class="n">p99 ms</th><th class="n">Distinct</th><th>Statuses</th></tr></thead>
    <tbody>${rows.join('')}</tbody></table></div>`
}

function statementsSection(report, names) {
  return names.map((name) => {
    const s = report.scenarios?.[name]
    if (!s?.statements?.length) return ''
    const top = [...s.statements]
      .sort((a, b) => (b.callsPerRequest ?? 0) - (a.callsPerRequest ?? 0) || Number(b.total_exec_time ?? 0) - Number(a.total_exec_time ?? 0))
      .slice(0, TOP_STATEMENTS)
    const rows = top.map((st) => {
      const calls = Number(st.calls ?? 0)
      const query = String(st.query ?? '').replace(/\s+/g, ' ').trim()
      return `<tr>
        <td class="n">${num(st.callsPerRequest, 2)}</td>
        <td class="n">${calls ? num(Number(st.total_exec_time ?? 0) / calls, 2) : '—'}</td>
        <td class="n">${calls ? num(Number(st.rows ?? 0) / calls, 0) : '—'}</td>
        <td><code>${escapeHtml(query.length > 400 ? `${query.slice(0, 400)}…` : query)}</code></td>
      </tr>`
    }).join('')
    return `<details>
      <summary><span class="mono">${escapeHtml(name)}</span> · ${num(s.queriesPerRequest, 1)} queries per request, ${escapeHtml(s.distinctStatements)} distinct${s.example ? ` · <span class="mono">${escapeHtml(s.example)}</span>` : ''}</summary>
      <div class="table-wrap"><table>
        <thead><tr><th class="n">Calls / req</th><th class="n">ms / call</th><th class="n">Rows / call</th><th>Statement</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
    </details>`
  }).join('\n')
}

const STYLE = `
:root {
  --bg: #f7f7f5; --surface: #ffffff; --ink: #1d2220; --muted: #5d6662; --line: #dcdfdc; --grid: #e6e9e6;
  --better: #1a7f37; --worse: #b3261e; --code-bg: #f0f2f0;
  ${SERIES.light.map((c, i) => `--s${i}: ${c};`).join(' ')}
  --font: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --mono: ui-monospace, "SF Mono", Consolas, "Liberation Mono", monospace;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #141716; --surface: #1b1f1e; --ink: #e4e8e6; --muted: #9ba5a1; --line: #2e3533; --grid: #283030;
    --better: #5bbf73; --worse: #f2867e; --code-bg: #232927;
    ${SERIES.dark.map((c, i) => `--s${i}: ${c};`).join(' ')}
    color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --bg: #141716; --surface: #1b1f1e; --ink: #e4e8e6; --muted: #9ba5a1; --line: #2e3533; --grid: #283030;
  --better: #5bbf73; --worse: #f2867e; --code-bg: #232927;
  ${SERIES.dark.map((c, i) => `--s${i}: ${c};`).join(' ')}
  color-scheme: dark;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.55 var(--font); }
main { max-width: 1040px; margin: 0 auto; padding-block: 32px 64px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); display: grid; gap: 36px; }
h1 { font-size: 1.8rem; margin: 0; line-height: 1.2; }
h2 { font-size: 1.25rem; margin: 0; }
p { margin: 0; max-width: 75ch; }
section, header { display: grid; gap: 12px; }
.muted { color: var(--muted); }
.mono, code { font-family: var(--mono); font-size: 0.86em; }
code { background: var(--code-bg); padding: 1px 4px; border-radius: 4px; overflow-wrap: anywhere; }
.panel { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 16px; display: grid; gap: 12px; min-width: 0; }
.legend { display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: 0.85rem; color: var(--muted); }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.swatch { display: inline-block; width: 11px; height: 11px; border-radius: 3px; margin-right: 6px; vertical-align: -1px; }
${SERIES.light.map((_, i) => `.swatch.s${i} { background: var(--s${i}); } rect.s${i} { fill: var(--s${i}); }`).join('\n')}
.swatch.sql { background: var(--s0); } .swatch.rest { background: var(--s1); }
rect.sql { fill: var(--s0); } rect.rest { fill: var(--s1); }
svg { display: block; width: 100%; height: auto; overflow: visible; }
svg text { fill: var(--muted); font: 11px var(--font); font-variant-numeric: tabular-nums; }
svg text.lbl { font-family: var(--mono); fill: var(--ink); }
svg text.val { fill: var(--ink); font-weight: 600; }
svg .axis { stroke: var(--line); }
.table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
table { border-collapse: collapse; width: 100%; font-size: 0.88rem; }
th, td { text-align: left; vertical-align: top; padding: 7px 10px; border-bottom: 1px solid var(--line); }
th { font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); white-space: nowrap; }
th.n, td.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
tr:last-child td { border-bottom: none; }
tbody tr.group-start td { border-top: 2px solid var(--line); }
.delta { font-size: 0.85em; color: var(--muted); }
.delta.better { color: var(--better); } .delta.worse { color: var(--worse); }
.pill { font-size: 0.72rem; border: 1px solid var(--line); border-radius: 999px; padding: 0 7px; color: var(--muted); }
details { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 10px 14px; }
details[open] { display: grid; gap: 10px; }
summary { cursor: pointer; overflow-wrap: anywhere; }
summary:focus-visible { outline: 2px solid var(--s0); outline-offset: 2px; }
details .table-wrap { border: none; }
`

/**
 * @param {object[]} reports  request-cost reports, oldest first (the first is the baseline)
 * @param {object} [options]
 * @param {string} [options.title]
 * @param {string} [options.generatedAt] ISO timestamp shown in the header
 */
export function renderHtmlReport(reports, { title = 'Request cost', generatedAt = new Date().toISOString() } = {}) {
  const head = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body><main>`
  const foot = '</main></body></html>\n'
  if (!reports.length) {
    return `${head}<header><h1>${escapeHtml(title)}</h1><p class="muted">No reports found. Run <code>node scripts/bench/request-cost.mjs --label &lt;name&gt;</code> first.</p></header>${foot}`
  }
  const names = scenarioNames(reports)
  const latest = reports[reports.length - 1]
  const chartRuns = reports.slice(0, MAX_CHART_RUNS)
  return `${head}
<header>
  <h1>${escapeHtml(title)}</h1>
  <p class="muted">${reports.length} run${reports.length === 1 ? '' : 's'} of <code>scripts/bench/request-cost.mjs</code>, generated ${escapeHtml(generatedAt.replace('T', ' ').slice(0, 16))} UTC. The first run is the baseline. Queries per request are deterministic for a given dataset and code; SQL time and latency compare only between runs on the same machine.</p>
</header>

<section>
  <h2>Runs</h2>
  ${runsTable(reports)}
</section>

<section>
  <h2>Queries per request</h2>
  <div class="panel">
    <div class="legend">${chartRuns.map((r, i) => `<span><i class="swatch s${i}"></i>${escapeHtml(r.label)}</span>`).join('')}</div>
    ${queriesChart(reports, names)}
    ${reports.length > MAX_CHART_RUNS ? `<p class="muted">The chart shows the first ${MAX_CHART_RUNS} runs; the table below has all of them.</p>` : ''}
  </div>
  ${comparisonTable(reports, names)}
</section>

<section>
  <h2>Where the time goes: <span class="mono">${escapeHtml(latest.label)}</span></h2>
  <div class="panel">
    <div class="legend"><span><i class="swatch sql"></i>SQL (pg_stat_statements)</span><span><i class="swatch rest"></i>Outside SQL: application, network, serialization</span></div>
    ${splitChart(latest, names)}
    <p class="muted">Mean latency per request, sequential requests.</p>
  </div>
</section>

<section>
  <h2>Top statements: <span class="mono">${escapeHtml(latest.label)}</span></h2>
  <p class="muted">Up to ${TOP_STATEMENTS} statements per scenario, by calls per request.</p>
  ${statementsSection(latest, names)}
</section>
${foot}`
}
