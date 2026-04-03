import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const isWindows = process.platform === 'win32'
const yarnCommand = isWindows ? 'yarn.cmd' : 'yarn'
const args = process.argv.slice(2)
const verbose = args.includes('--verbose') || process.env.MERCATO_DEV_OUTPUT === 'verbose'
const greenfield = args.includes('--greenfield')
const appOnly = args.includes('--app-only')
const autoOpenSplash = !appOnly && process.stdout.isTTY && process.env.CI !== 'true' && process.env.OM_DEV_AUTO_OPEN !== '0'

const children = new Set()
let shuttingDown = false
let splashServer = null
let splashUrl = null
let splashChildStateFile = null
let splashLogoSvg = null
let splashLocaleConfig = null
const splashState = {
  mode: greenfield ? 'greenfield' : 'dev',
  phase: greenfield ? 'Greenfield installation and first compilation is in progress...' : 'Installation and first compilation is in progress...',
  detail: greenfield ? 'Preparing clean environment and rebuilding packages' : 'Preparing workspace packages and app runtime',
  ready: false,
  readyUrl: null,
  loginUrl: null,
  memoryCurrentBytes: null,
  memoryPeakBytes: null,
  packageNames: [],
  workerQueues: [],
  schedulerActive: false,
  progressCurrent: 0,
  progressTotal: greenfield ? 5 : 3,
  progressPercent: 0,
  progressLabel: greenfield ? 'Greenfield setup pending' : 'Workspace preparation pending',
  activities: [],
}

function formatDuration(durationMs) {
  if (durationMs < 1000) return `${durationMs}ms`
  return `${(durationMs / 1000).toFixed(1)}s`
}

function clampPercent(value) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function resolveProgressPercent(current, total, explicitPercent) {
  if (Number.isFinite(explicitPercent)) {
    return clampPercent(explicitPercent)
  }

  if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) {
    return 0
  }

  return clampPercent((current / total) * 100)
}

function formatProgressBar(percent, width = 18) {
  const filled = Math.max(0, Math.min(width, Math.round((clampPercent(percent) / 100) * width)))
  return `[${'#'.repeat(filled)}${'-'.repeat(width - filled)}]`
}

function formatProgressLine(label, current, total, percent) {
  const meta = Number.isFinite(current) && Number.isFinite(total) && total > 0
    ? `${current}/${total}`
    : `${clampPercent(percent)}%`
  return `${formatProgressBar(percent)} ${String(meta).padStart(4)} ${label}`
}

function stripAnsi(value) {
  return value.replace(/\u001B\[[0-9;?]*[ -/]*[@-~]/g, '')
}

function hasEmojiPrefix(value) {
  return /^[\p{Extended_Pictographic}\u2600-\u27BF]/u.test(String(value ?? '').trim())
}

function decorateActivityMessage(message) {
  const plain = String(message ?? '').trim()
  if (!plain) return plain
  if (hasEmojiPrefix(plain)) return plain

  if (/splash page/i.test(plain)) return `🪟 ${plain}`
  if (/package/i.test(plain)) return `📦 ${plain}`
  if (/build/i.test(plain)) return `🧱 ${plain}`
  if (/generate|artifact/i.test(plain)) return `♻️ ${plain}`
  if (/watch/i.test(plain)) return `👀 ${plain}`
  if (/ready|login/i.test(plain)) return `🌐 ${plain}`
  if (/queue|scheduler|background/i.test(plain)) return `⚙️ ${plain}`
  if (/memory/i.test(plain)) return `🧠 ${plain}`
  if (/encrypt/i.test(plain)) return `🔐 ${plain}`
  if (/compile/i.test(plain)) return `🛠️ ${plain}`
  if (/warn|port/i.test(plain)) return `⚠️ ${plain}`
  return `✨ ${plain}`
}

function appendLines(target, chunk, onLine) {
  target.value += chunk

  while (true) {
    const newlineIndex = target.value.indexOf('\n')
    if (newlineIndex === -1) break

    const rawLine = target.value.slice(0, newlineIndex).replace(/\r$/, '')
    target.value = target.value.slice(newlineIndex + 1)
    onLine(rawLine)
  }
}

function connectLineStream(stream, onLine) {
  if (!stream) return

  const state = { value: '' }
  stream.setEncoding('utf8')
  stream.on('data', (chunk) => appendLines(state, chunk, onLine))
  stream.on('end', () => {
    const trailing = state.value.replace(/\r$/, '')
    if (trailing.length > 0) {
      onLine(trailing)
    }
  })
}

function spawnCommand(command, commandArgs, options = {}) {
  const child = spawn(command, commandArgs, {
    cwd: options.cwd ?? process.cwd(),
    env: {
      ...process.env,
      TURBO_NO_UPDATE_NOTIFIER: '1',
      ...options.env,
    },
    stdio: options.stdio ?? 'pipe',
  })

  children.add(child)

  child.on('close', () => {
    children.delete(child)
  })

  child.on('error', (error) => {
    console.error(error)
    shutdown(1)
  })

  return child
}

function writeSplashChildStateFileClear() {
  if (!splashChildStateFile) return
  fs.rmSync(splashChildStateFile, { force: true })
}

function pushSplashActivity(message) {
  if (!message) return
  const decorated = decorateActivityMessage(message)
  const activities = splashState.activities
  if (activities[activities.length - 1] === decorated) return
  activities.push(decorated)
  if (activities.length > 8) {
    activities.shift()
  }
}

function mergeActivities(primary, secondary) {
  const merged = []
  for (const candidate of [...(primary ?? []), ...(secondary ?? [])]) {
    if (typeof candidate !== 'string') continue
    const decorated = decorateActivityMessage(candidate)
    if (!decorated) continue
    if (merged[merged.length - 1] === decorated) continue
    merged.push(decorated)
  }
  return merged.slice(-14)
}

function resolveSplashLogoSvg() {
  if (splashLogoSvg !== null) return splashLogoSvg

  const candidatePaths = [
    path.join(process.cwd(), 'apps', 'mercato', 'public', 'open-mercato.svg'),
    path.join(process.cwd(), 'packages', 'create-app', 'template', 'public', 'open-mercato.svg'),
  ]

  for (const candidate of candidatePaths) {
    try {
      splashLogoSvg = fs.readFileSync(candidate, 'utf8')
      return splashLogoSvg
    } catch {}
  }

  splashLogoSvg = ''
  return splashLogoSvg
}

function parseStringArrayLiteral(source, variableName) {
  const match = source.match(new RegExp(`\\b${variableName}\\b\\s*:\\s*[^=]+=`))
  if (!match) return []

  const startIndex = source.indexOf('[', match.index)
  if (startIndex === -1) return []

  let depth = 0
  let endIndex = -1
  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index]
    if (char === '[') depth += 1
    if (char === ']') {
      depth -= 1
      if (depth === 0) {
        endIndex = index
        break
      }
    }
  }

  if (endIndex === -1) return []
  const literal = source.slice(startIndex, endIndex + 1)
  return Array.from(literal.matchAll(/'([^']+)'|"([^"]+)"/g), (entry) => entry[1] || entry[2]).filter(Boolean)
}

function parseStringLiteral(source, variableName) {
  const match = source.match(new RegExp(`\\b${variableName}\\b\\s*:\\s*[^=]+=\\s*('([^']+)'|"([^"]+)")`))
  return match?.[2] || match?.[3] || null
}

function resolveSplashLocaleConfig() {
  if (splashLocaleConfig) return splashLocaleConfig

  const fallback = {
    locales: ['en', 'pl', 'es', 'de'],
    defaultLocale: 'en',
  }

  const candidatePath = path.join(process.cwd(), 'packages', 'shared', 'src', 'lib', 'i18n', 'config.ts')

  try {
    const source = fs.readFileSync(candidatePath, 'utf8')
    const locales = parseStringArrayLiteral(source, 'locales')
    const defaultLocale = parseStringLiteral(source, 'defaultLocale')

    splashLocaleConfig = {
      locales: locales.length > 0 ? locales : fallback.locales,
      defaultLocale: defaultLocale || (locales[0] ?? fallback.defaultLocale),
    }
    return splashLocaleConfig
  } catch {
    splashLocaleConfig = fallback
    return splashLocaleConfig
  }
}

function normalizeLocaleToken(value) {
  return String(value ?? '').trim().toLowerCase().replace(/_/g, '-')
}

function resolveSupportedSplashLocale(value, localeConfig = resolveSplashLocaleConfig()) {
  if (typeof value !== 'string') return null

  const normalized = normalizeLocaleToken(value)
  if (!normalized) return null

  if (localeConfig.locales.includes(normalized)) {
    return normalized
  }

  const baseLocale = normalized.split('-')[0]
  if (baseLocale && localeConfig.locales.includes(baseLocale)) {
    return baseLocale
  }

  return null
}

function resolveSplashLocaleFromAcceptLanguage(acceptLanguage, localeConfig = resolveSplashLocaleConfig()) {
  if (typeof acceptLanguage !== 'string' || acceptLanguage.trim().length === 0) {
    return null
  }

  const rankedCandidates = acceptLanguage
    .split(',')
    .map((entry, index) => {
      const [rawLocale, ...rawParams] = entry.split(';')
      const locale = rawLocale?.trim() ?? ''
      const qParam = rawParams.find((param) => param.trim().startsWith('q='))
      const parsedQ = qParam ? Number.parseFloat(qParam.trim().slice(2)) : 1
      const quality = Number.isFinite(parsedQ) ? Math.min(Math.max(parsedQ, 0), 1) : 1

      return { locale, quality, index }
    })
    .filter((entry) => entry.locale.length > 0 && entry.quality > 0)
    .sort((left, right) => {
      if (right.quality !== left.quality) {
        return right.quality - left.quality
      }
      return left.index - right.index
    })

  for (const candidate of rankedCandidates) {
    const resolved = resolveSupportedSplashLocale(candidate.locale, localeConfig)
    if (resolved) return resolved
  }

  return null
}

function readCookieFromHeader(cookieHeader, key) {
  if (typeof cookieHeader !== 'string' || !cookieHeader) return null

  for (const entry of cookieHeader.split(';')) {
    const [rawName, ...rest] = entry.split('=')
    if ((rawName ?? '').trim() !== key) continue
    const rawValue = rest.join('=').trim()
    if (!rawValue) return null
    try {
      return decodeURIComponent(rawValue)
    } catch {
      return rawValue
    }
  }

  return null
}

function resolveSplashRequestLocale(req, localeConfig = resolveSplashLocaleConfig()) {
  const cookieLocale = resolveSupportedSplashLocale(
    readCookieFromHeader(req?.headers?.cookie, 'locale'),
    localeConfig,
  )
  if (cookieLocale) return cookieLocale

  const acceptLocale = resolveSplashLocaleFromAcceptLanguage(req?.headers?.['accept-language'], localeConfig)
  if (acceptLocale) return acceptLocale

  return localeConfig.defaultLocale
}

function escapeForInlineScript(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

function updateSplashState(patch) {
  if (typeof patch.phase === 'string') splashState.phase = patch.phase
  if (typeof patch.detail === 'string') splashState.detail = patch.detail
  if (typeof patch.ready === 'boolean') splashState.ready = patch.ready
  if (typeof patch.readyUrl === 'string' || patch.readyUrl === null) splashState.readyUrl = patch.readyUrl
  if (typeof patch.loginUrl === 'string' || patch.loginUrl === null) splashState.loginUrl = patch.loginUrl
  if (typeof patch.progressCurrent === 'number') splashState.progressCurrent = patch.progressCurrent
  if (typeof patch.progressTotal === 'number') splashState.progressTotal = patch.progressTotal
  if (typeof patch.progressLabel === 'string') splashState.progressLabel = patch.progressLabel
  if (typeof patch.progressPercent === 'number') {
    splashState.progressPercent = clampPercent(patch.progressPercent)
  } else if (
    typeof patch.progressCurrent === 'number'
    || typeof patch.progressTotal === 'number'
  ) {
    splashState.progressPercent = resolveProgressPercent(
      splashState.progressCurrent,
      splashState.progressTotal,
      undefined,
    )
  }
  if (typeof patch.activity === 'string') pushSplashActivity(patch.activity)
}

function readSplashChildState() {
  if (!splashChildStateFile || !fs.existsSync(splashChildStateFile)) return null
  try {
    return JSON.parse(fs.readFileSync(splashChildStateFile, 'utf8'))
  } catch {
    return null
  }
}

function getMergedSplashState() {
  const childState = readSplashChildState()
  if (!childState) {
    return { ...splashState }
  }

  return {
    ...splashState,
    ...childState,
    activities: mergeActivities(splashState.activities, childState.activities),
  }
}

function renderSplashHtml(req) {
  const inlineLogoSvg = resolveSplashLogoSvg()
  const localeConfig = resolveSplashLocaleConfig()
  const initialLocale = resolveSplashRequestLocale(req, localeConfig)
  const localeLabels = {
    en: 'English',
    pl: 'Polski',
    es: 'Español',
    de: 'Deutsch',
  }
  const splashBootstrap = escapeForInlineScript({
    supportedLocales: localeConfig.locales,
    defaultLocale: localeConfig.defaultLocale,
    initialLocale,
    localeLabels,
  })
  return `<!doctype html>
<html lang="${initialLocale}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Open Mercato Dev</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700;800&display=swap"
    />
    <style>
      :root {
        --bg: #090909;
        --bg-deep: #090909;
        --panel: #1c1c1c;
        --panel-strong: #1c1c1c;
        --panel-border: rgba(255, 255, 255, 0.12);
        --surface: rgba(255, 255, 255, 0.03);
        --surface-strong: rgba(255, 255, 255, 0.05);
        --muted: #a1a1aa;
        --text: #fafafa;
        --accent: #f5f5f5;
        --accent-strong: #ffffff;
        --warning: #f5f5f5;
        --activity-text: #f5f5f5;
        --activity-time: #a1a1aa;
        --shadow: 0 24px 64px rgba(0, 0, 0, 0.28);
      }
      html[data-theme="light"] {
        --bg: #f5f5f5;
        --bg-deep: #ebebeb;
        --panel: rgba(255, 255, 255, 0.96);
        --panel-strong: rgba(255, 255, 255, 0.98);
        --panel-border: rgba(17, 24, 39, 0.1);
        --surface: rgba(17, 24, 39, 0.035);
        --surface-strong: rgba(17, 24, 39, 0.055);
        --muted: #5f5f67;
        --text: #111111;
        --warning: #111111;
        --activity-text: #111111;
        --activity-time: #52525b;
        --shadow: 0 22px 52px rgba(15, 23, 42, 0.08);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: "Geist", ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: var(--text);
        background:
          radial-gradient(circle at 50% 0%, rgba(255, 255, 255, 0.03), transparent 28%),
          linear-gradient(180deg, var(--bg), var(--bg-deep));
        display: grid;
        place-items: center;
        padding: 24px;
      }
      .shell {
        width: min(1280px, 100%);
        height: min(860px, calc(100vh - 48px));
        display: grid;
        grid-template-columns: minmax(0, 1.35fr) minmax(360px, 0.85fr);
        gap: 24px;
        align-items: stretch;
      }
      .panel {
        background: var(--panel);
        border: 1px solid var(--panel-border);
        border-radius: 28px;
        box-shadow: var(--shadow);
        min-height: 0;
        overflow: hidden;
      }
      .hero {
        padding: 28px 34px 30px;
        display: grid;
        grid-template-rows: auto auto auto minmax(0, 1fr);
        gap: 18px;
        min-height: 0;
      }
      .hero-top {
        display: flex;
        justify-content: flex-end;
        align-items: center;
      }
      .hero-mark {
        display: grid;
        justify-items: center;
        gap: 14px;
        text-align: center;
      }
      .hero-logo {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: auto;
        height: auto;
        padding: 0;
        border-radius: 0;
        background: transparent;
        border: none;
        box-shadow: none;
        line-height: 0;
      }
      .hero-logo svg {
        width: 156px;
        height: 156px;
        display: block;
      }
      .control-row {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        justify-content: flex-end;
      }
      .control-button {
        min-height: 42px;
        padding: 0 14px;
        border-radius: 999px;
        border: 1px solid var(--panel-border);
        background: var(--surface);
        color: var(--text);
        font: inherit;
        font-size: 13px;
        font-weight: 600;
        letter-spacing: 0.04em;
        cursor: pointer;
      }
      .summary {
        color: var(--muted);
        font-size: 18px;
        line-height: 1.5;
        max-width: 34rem;
        margin: 0 auto;
        text-align: center;
      }
      .stream-shell {
        display: grid;
        gap: 10px;
        min-height: 0;
      }
      .hero-body {
        display: grid;
        gap: 14px;
        min-height: 0;
        overflow-y: auto;
        padding-right: 8px;
        align-content: start;
        scrollbar-width: thin;
        scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
      }
      .hero-body::-webkit-scrollbar {
        width: 10px;
      }
      .hero-body::-webkit-scrollbar-track {
        background: transparent;
      }
      .hero-body::-webkit-scrollbar-thumb {
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.18);
        border: 2px solid transparent;
        background-clip: padding-box;
      }
      .summary-folds {
        display: grid;
        gap: 14px;
        align-content: start;
      }
      .stream-heading {
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.11em;
        text-transform: uppercase;
        color: var(--muted);
      }
      .status-card {
        padding: 28px 28px 30px;
        display: flex;
        flex-direction: column;
        gap: 18px;
        justify-content: flex-start;
        background: var(--panel-strong);
      }
      .status-line {
        font-size: 15px;
        color: var(--muted);
      }
      .phase {
        font-size: 32px;
        line-height: 1.12;
        margin: 0;
        letter-spacing: -0.04em;
        font-weight: 700;
      }
      .spinner {
        width: 56px;
        height: 56px;
        border-radius: 999px;
        border: 5px solid rgba(255, 255, 255, 0.12);
        border-top-color: var(--accent);
        animation: spin 1s linear infinite;
      }
      .ready .spinner {
        animation: none;
        border-color: rgba(115, 239, 194, 0.26);
        position: relative;
      }
      .ready .spinner::after {
        content: "";
        position: absolute;
        inset: 11px;
        border-radius: 999px;
        background: var(--accent);
      }
      .actions {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
      }
      .progress-stack {
        display: grid;
        gap: 10px;
      }
      .progress-meta {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        color: var(--muted);
        font-size: 13px;
      }
      .progress-track {
        width: 100%;
        height: 12px;
        border-radius: 999px;
        overflow: hidden;
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid var(--panel-border);
      }
      .progress-fill {
        height: 100%;
        width: 0%;
        background: linear-gradient(90deg, #d4d4d8, var(--accent-strong));
        transition: width 0.3s ease;
      }
      .button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 52px;
        padding: 0 18px;
        border-radius: 14px;
        border: 1px solid transparent;
        text-decoration: none;
        font-weight: 600;
        transition: transform 0.18s ease, opacity 0.18s ease, border-color 0.18s ease;
      }
      .button.primary {
        background: #f4f4f5;
        color: #111111;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.36);
      }
      .button.secondary {
        border-color: var(--panel-border);
        color: var(--text);
      }
      html[data-theme="light"] .button.primary {
        background: #111111;
        color: #fafafa;
        box-shadow: none;
      }
      html[data-theme="light"] .stream-heading,
      html[data-theme="light"] .fold-card summary,
      html[data-theme="light"] .status-line,
      html[data-theme="light"] .terminal-hint {
        color: #52525b;
      }
      html[data-theme="light"] .progress-track {
        background: rgba(17, 24, 39, 0.06);
      }
      html[data-theme="light"] .spinner {
        border-color: rgba(17, 24, 39, 0.12);
        border-top-color: #111111;
      }
      html[data-theme="light"] .list li,
      html[data-theme="light"] details.fold-card {
        background: rgba(17, 24, 39, 0.055);
        border-color: rgba(17, 24, 39, 0.1);
      }
      html[data-theme="light"] .activity-time {
        color: #52525b;
      }
      html[data-theme="light"] .activity-message,
      html[data-theme="light"] .fold-list li {
        color: #111111;
      }
      .button[aria-disabled="true"] {
        opacity: 0.55;
        pointer-events: none;
      }
      .terminal-hint {
        display: inline-flex;
        align-items: center;
        min-height: 52px;
        padding: 0 4px;
        color: var(--muted);
        font-size: 14px;
        font-weight: 600;
      }
      details.fold-card {
        display: grid;
        gap: 8px;
        padding: 16px 18px;
        border-radius: 20px;
        background: var(--surface);
        border: 1px solid var(--panel-border);
      }
      .fold-card summary {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        width: 100%;
        cursor: pointer;
        font-size: 13px;
        color: var(--muted);
        list-style: none;
      }
      .fold-card summary::after {
        content: "⌄";
        margin-left: auto;
        color: var(--muted);
        font-size: 18px;
        line-height: 1;
        transform: rotate(0deg);
        transition: transform 0.18s ease, color 0.18s ease;
      }
      .fold-card[open] summary {
        margin-bottom: 12px;
        padding-bottom: 12px;
        border-bottom: 1px solid var(--panel-border);
      }
      .fold-card[open] summary::after {
        transform: rotate(180deg);
        color: var(--text);
      }
      .fold-card summary::-webkit-details-marker {
        display: none;
      }
      .fold-list,
      .list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
      }
      .fold-list {
        gap: 8px;
        margin-top: 12px;
      }
      .fold-list li {
        font-size: 14px;
        color: var(--text);
      }
      .list {
        gap: 10px;
        height: clamp(176px, 22vh, 228px);
        overflow-y: auto;
        padding-right: 8px;
        align-content: start;
        scrollbar-width: thin;
        scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
        scroll-snap-type: y proximity;
      }
      .list::-webkit-scrollbar {
        width: 10px;
      }
      .list::-webkit-scrollbar-track {
        background: transparent;
      }
      .list::-webkit-scrollbar-thumb {
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.18);
        border: 2px solid transparent;
        background-clip: padding-box;
      }
      .list li {
        padding: 14px 16px;
        border-radius: 20px;
        background: var(--surface);
        border: 1px solid var(--panel-border);
        scroll-snap-align: start;
      }
      .activity-entry {
        display: grid;
        gap: 6px;
      }
      .activity-time {
        color: var(--activity-time);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .activity-message {
        color: var(--activity-text);
        font-size: 16px;
        line-height: 1.45;
        font-weight: 600;
      }
      .url {
        color: var(--warning);
        word-break: break-all;
      }
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
      @media (max-width: 960px) {
        .shell { grid-template-columns: 1fr; height: auto; }
        .hero, .status-card { padding: 30px 24px; }
        .hero-top { justify-content: flex-start; }
        .control-row { justify-content: flex-start; }
        .hero-logo {
          width: auto;
          height: auto;
        }
        .hero-logo svg {
          width: 128px;
          height: 128px;
        }
        .summary { font-size: 18px; }
        .list {
          height: auto;
          max-height: min(232px, 34vh);
        }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <section class="panel hero">
        <div class="hero-top">
          <div class="control-row">
            <button class="control-button" id="theme-toggle" type="button">🌙 Dark</button>
            <button class="control-button" id="locale-toggle" type="button">🌐 EN</button>
          </div>
        </div>
        <div class="hero-mark" aria-hidden="true">
          <div class="hero-logo">${inlineLogoSvg}</div>
        </div>
        <p class="summary" id="hero-summary">
          The workspace is being prepared in the terminal. This page switches to a ready state as soon as the dev server becomes available.
        </p>
        <div class="hero-body">
          <section class="stream-shell" aria-labelledby="stream-heading">
            <div class="stream-heading" id="stream-heading">✨ Live startup stream</div>
            <ul class="list" id="activity-list">
              <li>🪟 Preparing dev environment…</li>
            </ul>
          </section>
          <section class="summary-folds" aria-label="Runtime summaries">
            <details class="fold-card" id="packages-card">
              <summary id="packages-summary">📦 Active packages</summary>
              <ul class="fold-list" id="packages-list">
                <li>Waiting for app package manifest…</li>
              </ul>
            </details>
            <details class="fold-card" id="workers-card">
              <summary id="workers-summary">⚙️ Background services</summary>
              <ul class="fold-list" id="workers-list">
                <li>Waiting for queue worker startup…</li>
              </ul>
            </details>
          </section>
        </div>
      </section>
      <aside class="panel status-card" id="status-card">
        <div class="spinner" aria-hidden="true"></div>
        <div class="status-line" id="mode-line">Waiting for current status…</div>
        <h2 class="phase" id="phase-text">Preparing app runtime</h2>
        <div class="status-line" id="detail-text">Builds, generators, queue workers, and scheduler will start automatically.</div>
        <div class="progress-stack">
          <div class="progress-meta">
            <span id="progress-label">Preparing startup pipeline</span>
            <span id="progress-value">0%</span>
          </div>
          <div class="progress-track" aria-hidden="true">
            <div class="progress-fill" id="progress-fill"></div>
          </div>
        </div>
        <div class="status-line"><span id="target-label">Current target:</span> <span class="url" id="ready-url">pending</span></div>
        <div class="actions">
          <a class="button primary" id="login-button" href="#" aria-disabled="true">🚀 App is preparing…</a>
          <div class="terminal-hint" id="terminal-hint">🖥 Keep terminal visible</div>
        </div>
      </aside>
    </main>
    <script>
      const splashBootstrap = ${splashBootstrap}
      const modeLine = document.getElementById('mode-line')
      const phaseText = document.getElementById('phase-text')
      const detailText = document.getElementById('detail-text')
      const progressLabel = document.getElementById('progress-label')
      const progressValue = document.getElementById('progress-value')
      const progressFill = document.getElementById('progress-fill')
      const packagesCard = document.getElementById('packages-card')
      const packagesSummary = document.getElementById('packages-summary')
      const packagesList = document.getElementById('packages-list')
      const workersCard = document.getElementById('workers-card')
      const workersSummary = document.getElementById('workers-summary')
      const workersList = document.getElementById('workers-list')
      const heroSummary = document.getElementById('hero-summary')
      const streamHeading = document.getElementById('stream-heading')
      const targetLabel = document.getElementById('target-label')
      const themeToggle = document.getElementById('theme-toggle')
      const localeToggle = document.getElementById('locale-toggle')
      const readyUrl = document.getElementById('ready-url')
      const loginButton = document.getElementById('login-button')
      const terminalHint = document.getElementById('terminal-hint')
      const activityList = document.getElementById('activity-list')
      const statusCard = document.getElementById('status-card')
      const THEME_KEY = 'om-dev-theme'
      const LOCALE_KEY = 'om-dev-locale'
      const supportedLocales = Array.isArray(splashBootstrap.supportedLocales) && splashBootstrap.supportedLocales.length > 0
        ? splashBootstrap.supportedLocales
        : ['en', 'pl', 'es', 'de']
      const defaultLocale = supportedLocales.includes(splashBootstrap.defaultLocale)
        ? splashBootstrap.defaultLocale
        : supportedLocales[0]
      const localeLabels = splashBootstrap.localeLabels || {}
      const activitySeenAt = new Map()
      const translations = {
        en: {
          badge: 'Open Mercato Dev',
          heroTitle: 'Installation and first compilation is in progress…',
          heroSummary: 'The workspace is being prepared in the terminal. This page switches to a ready state as soon as the dev server becomes available.',
          streamHeading: '✨ Live startup stream',
          packagesSummary: '📦 Active packages',
          workersSummary: '⚙️ Background services',
          targetLabel: 'Current target:',
          targetPending: 'pending',
          loginPreparing: '🚀 App is preparing…',
          loginReady: '🚪 App is ready, open login',
          terminalHint: '🖥 Keep terminal visible',
          themeLight: '☀️ Light',
          themeDark: '🌙 Dark',
          waitingStatus: 'Waiting for dev runner status…',
          progressOverview: 'Startup progress',
          emptyPackages: 'Waiting for app package manifest…',
          emptyWorkers: 'Waiting for queue worker startup…',
          packagesCount: '📦 Active packages ({count})',
          workersCount: '⚙️ Background services ({count})',
          modeDev: 'Standard dev flow',
          modeGreenfield: 'Greenfield dev flow',
        },
        pl: {
          badge: 'Open Mercato Dev',
          heroTitle: 'Instalacja i pierwsza kompilacja są w toku…',
          heroSummary: 'Workspace przygotowuje się w terminalu. Ta strona przełączy się w stan gotowości, gdy tylko serwer developerski będzie dostępny.',
          streamHeading: '✨ Strumień startu na żywo',
          packagesSummary: '📦 Aktywne pakiety',
          workersSummary: '⚙️ Usługi w tle',
          targetLabel: 'Aktualny adres:',
          targetPending: 'oczekiwanie',
          loginPreparing: '🚀 Aplikacja się przygotowuje…',
          loginReady: '🚪 Aplikacja gotowa, otwórz logowanie',
          terminalHint: '🖥 Zachowaj terminal',
          themeLight: '☀️ Jasny',
          themeDark: '🌙 Ciemny',
          waitingStatus: 'Oczekiwanie na status runnera…',
          progressOverview: 'Postęp uruchamiania',
          emptyPackages: 'Oczekiwanie na manifest pakietów aplikacji…',
          emptyWorkers: 'Oczekiwanie na start workerów kolejki…',
          packagesCount: '📦 Aktywne pakiety ({count})',
          workersCount: '⚙️ Usługi w tle ({count})',
          modeDev: 'Standardowy tryb dev',
          modeGreenfield: 'Tryb greenfield',
        },
        es: {
          badge: 'Open Mercato Dev',
          heroTitle: 'La instalación y la primera compilación están en curso…',
          heroSummary: 'El workspace se está preparando en la terminal. Esta página cambiará al estado listo en cuanto el servidor de desarrollo esté disponible.',
          streamHeading: '✨ Flujo de arranque en vivo',
          packagesSummary: '📦 Paquetes activos',
          workersSummary: '⚙️ Servicios en segundo plano',
          targetLabel: 'Destino actual:',
          targetPending: 'pendiente',
          loginPreparing: '🚀 La aplicación se está preparando…',
          loginReady: '🚪 La aplicación está lista, abrir login',
          terminalHint: '🖥 Mantener la terminal visible',
          themeLight: '☀️ Claro',
          themeDark: '🌙 Oscuro',
          waitingStatus: 'Esperando el estado del runner de desarrollo…',
          progressOverview: 'Progreso del arranque',
          emptyPackages: 'Esperando el manifiesto de paquetes de la aplicación…',
          emptyWorkers: 'Esperando el arranque de los workers de cola…',
          packagesCount: '📦 Paquetes activos ({count})',
          workersCount: '⚙️ Servicios en segundo plano ({count})',
          modeDev: 'Flujo dev estándar',
          modeGreenfield: 'Flujo dev greenfield',
        },
        de: {
          badge: 'Open Mercato Dev',
          heroTitle: 'Installation und erste Kompilierung laufen…',
          heroSummary: 'Der Workspace wird im Terminal vorbereitet. Diese Seite wechselt in den Bereitschaftszustand, sobald der Dev-Server verfügbar ist.',
          streamHeading: '✨ Live-Startstream',
          packagesSummary: '📦 Aktive Pakete',
          workersSummary: '⚙️ Hintergrunddienste',
          targetLabel: 'Aktuelles Ziel:',
          targetPending: 'ausstehend',
          loginPreparing: '🚀 Die App wird vorbereitet…',
          loginReady: '🚪 App ist bereit, Login öffnen',
          terminalHint: '🖥 Terminal sichtbar lassen',
          themeLight: '☀️ Hell',
          themeDark: '🌙 Dunkel',
          waitingStatus: 'Warte auf den Status des Dev-Runners…',
          progressOverview: 'Startfortschritt',
          emptyPackages: 'Warte auf das Paketmanifest der App…',
          emptyWorkers: 'Warte auf den Start der Queue-Worker…',
          packagesCount: '📦 Aktive Pakete ({count})',
          workersCount: '⚙️ Hintergrunddienste ({count})',
          modeDev: 'Standard-Dev-Ablauf',
          modeGreenfield: 'Greenfield-Dev-Ablauf',
        },
      }
      const exactTranslations = {
        pl: {
          'Installation and first compilation is in progress...': 'Instalacja i pierwsza kompilacja są w toku…',
          'Greenfield installation and first compilation is in progress...': 'Greenfield: instalacja i pierwsza kompilacja są w toku…',
          'Preparing app runtime': 'Przygotowywanie runtime aplikacji',
          'Waiting for current status…': 'Oczekiwanie na bieżący status…',
          'Preparing dev environment…': 'Przygotowywanie środowiska developerskiego…',
          'Waiting for app package manifest…': 'Oczekiwanie na manifest pakietów aplikacji…',
          'Waiting for queue worker startup…': 'Oczekiwanie na start workerów kolejki…',
          'pending': 'oczekiwanie',
          'scheduler · polling engine': 'scheduler · silnik odpytywania',
        },
        es: {
          'Installation and first compilation is in progress...': 'La instalación y la primera compilación están en curso…',
          'Greenfield installation and first compilation is in progress...': 'Greenfield: la instalación y la primera compilación están en curso…',
          'Preparing app runtime': 'Preparando el runtime de la aplicación',
          'Waiting for current status…': 'Esperando el estado actual…',
          'Preparing dev environment…': 'Preparando el entorno de desarrollo…',
          'Waiting for app package manifest…': 'Esperando el manifiesto de paquetes de la aplicación…',
          'Waiting for queue worker startup…': 'Esperando el arranque de los workers de cola…',
          'pending': 'pendiente',
          'scheduler · polling engine': 'scheduler · motor de sondeo',
        },
        de: {
          'Installation and first compilation is in progress...': 'Installation und erste Kompilierung laufen…',
          'Greenfield installation and first compilation is in progress...': 'Greenfield: Installation und erste Kompilierung laufen…',
          'Preparing app runtime': 'App-Laufzeit wird vorbereitet',
          'Waiting for current status…': 'Warte auf den aktuellen Status…',
          'Preparing dev environment…': 'Entwicklungsumgebung wird vorbereitet…',
          'Waiting for app package manifest…': 'Warte auf das Paketmanifest der App…',
          'Waiting for queue worker startup…': 'Warte auf den Start der Queue-Worker…',
          'pending': 'ausstehend',
          'scheduler · polling engine': 'scheduler · Polling-Engine',
        },
      }
      let currentLocale = 'en'
      let currentTheme = 'dark'

      themeToggle.addEventListener('click', () => {
        currentTheme = currentTheme === 'dark' ? 'light' : 'dark'
        localStorage.setItem(THEME_KEY, currentTheme)
        applyTheme()
        renderStaticText()
      })

      localeToggle.addEventListener('click', () => {
        const currentIndex = Math.max(0, supportedLocales.indexOf(currentLocale))
        currentLocale = supportedLocales[(currentIndex + 1) % supportedLocales.length] || defaultLocale
        localStorage.setItem(LOCALE_KEY, currentLocale)
        renderStaticText()
      })

      function template(value, vars = {}) {
        return String(value).replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? ''))
      }

      function t(key, vars = {}) {
        const dict = translations[currentLocale] || translations.en
        const fallback = translations.en[key] || key
        return template(dict[key] || fallback, vars)
      }

      function getLocaleLabel(locale) {
        return localeLabels[locale] || String(locale || '').toUpperCase()
      }

      function splitEmoji(value) {
        const match = String(value ?? '').match(/^([\p{Extended_Pictographic}\u2600-\u27BF][\uFE0F]?\s*)(.*)$/u)
        if (!match) return { emoji: '', body: String(value ?? '') }
        return { emoji: match[1], body: match[2] }
      }

      function translateMessage(value) {
        const raw = String(value ?? '')
        if (!raw) return raw
        const { emoji, body } = splitEmoji(raw)
        const exact = exactTranslations[currentLocale]?.[body] || exactTranslations[currentLocale]?.[raw]
        if (exact) {
          return emoji ? emoji + exact : exact
        }
        return raw
      }

      function normalizeStatusComparisonValue(value) {
        const raw = String(value ?? '')
        if (!raw) return ''

        const { body } = splitEmoji(raw)
        return body
          .toLowerCase()
          .replace(/\s+in\s+\d+(?:\.\d+)?(?:ms|s)\b.*$/i, '')
          .replace(/[^\p{L}\p{N}]+/gu, ' ')
          .trim()
      }

      function shouldCollapseProgressLabel(detail, label) {
        const normalizedDetail = normalizeStatusComparisonValue(detail)
        const normalizedLabel = normalizeStatusComparisonValue(label)
        if (!normalizedDetail || !normalizedLabel) return false
        return normalizedDetail === normalizedLabel
          || normalizedDetail.startsWith(normalizedLabel)
          || normalizedLabel.startsWith(normalizedDetail)
      }

      function detectLocale() {
        const stored = localStorage.getItem(LOCALE_KEY)
        if (supportedLocales.includes(stored)) return stored

        if (supportedLocales.includes(splashBootstrap.initialLocale)) {
          return splashBootstrap.initialLocale
        }

        const browserCandidates = Array.isArray(navigator.languages) ? navigator.languages : []
        for (const candidate of [...browserCandidates, navigator.language]) {
          if (typeof candidate !== 'string') continue
          const normalized = candidate.trim().toLowerCase().replace(/_/g, '-')
          if (supportedLocales.includes(normalized)) return normalized
          const baseLocale = normalized.split('-')[0]
          if (supportedLocales.includes(baseLocale)) return baseLocale
        }

        return defaultLocale
      }

      function detectTheme() {
        const stored = localStorage.getItem(THEME_KEY)
        if (stored === 'light' || stored === 'dark') return stored
        return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
      }

      function applyTheme() {
        document.documentElement.dataset.theme = currentTheme
      }

      function renderStaticText() {
        document.documentElement.lang = currentLocale
        heroSummary.textContent = t('heroSummary')
        streamHeading.textContent = t('streamHeading')
        targetLabel.textContent = t('targetLabel')
        terminalHint.textContent = t('terminalHint')
        localeToggle.textContent = '🌐 ' + getLocaleLabel(currentLocale)
        themeToggle.textContent = currentTheme === 'dark' ? t('themeDark') : t('themeLight')
      }

      function formatActivityTimestamp(value) {
        const date = new Date(value)
        if (Number.isNaN(date.getTime())) return ''
        return new Intl.DateTimeFormat(currentLocale, {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }).format(date)
      }

      function renderActivities(items) {
        if (!Array.isArray(items) || items.length === 0) return
        const ordered = items.slice().reverse()
        activityList.innerHTML = ordered.map((item) => {
          const key = String(item ?? '')
          if (!activitySeenAt.has(key)) {
            activitySeenAt.set(key, Date.now())
          }
          const timestamp = formatActivityTimestamp(activitySeenAt.get(key))
          const safeMessage = escapeHtml(translateMessage(item))
          const safeTimestamp = escapeHtml(timestamp)
          return '<li><div class="activity-entry"><span class="activity-time">' + safeTimestamp + '</span><span class="activity-message">' + safeMessage + '</span></div></li>'
        }).join('')
      }

      function escapeHtml(value) {
        return String(value).replace(/[&<>"]/g, (char) => ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;'
        }[char]))
      }

      function renderSimpleList(target, items, emptyLabel) {
        const normalized = Array.isArray(items) && items.length > 0 ? items : [emptyLabel]
        target.innerHTML = normalized.map((item) => '<li>' + escapeHtml(item) + '</li>').join('')
      }

      async function refresh() {
        try {
          const response = await fetch('/status', { cache: 'no-store' })
          const state = await response.json()
          modeLine.textContent = state.mode === 'greenfield' ? t('modeGreenfield') : t('modeDev')
          const rawPhase = state.phase || 'Preparing app runtime'
          const rawDetail = state.detail || 'Preparing app runtime'
          const rawProgressLabel = state.progressLabel || 'Preparing startup pipeline'
          phaseText.textContent = translateMessage(rawPhase)
          detailText.textContent = translateMessage(rawDetail)
          const percent = Number.isFinite(state.progressPercent) ? Math.max(0, Math.min(100, state.progressPercent)) : 0
          progressLabel.textContent = shouldCollapseProgressLabel(rawDetail, rawProgressLabel)
            ? t('progressOverview')
            : translateMessage(rawProgressLabel)
          progressValue.textContent = Number.isFinite(state.progressCurrent) && Number.isFinite(state.progressTotal) && state.progressTotal > 0
            ? state.progressCurrent + '/' + state.progressTotal + ' · ' + percent + '%'
            : percent + '%'
          progressFill.style.width = percent + '%'
          const packages = Array.isArray(state.packageNames) ? state.packageNames : []
          packagesSummary.textContent = packages.length > 0 ? t('packagesCount', { count: packages.length }) : t('packagesSummary')
          renderSimpleList(packagesList, packages, t('emptyPackages'))
          const workerItems = []
          if (state.schedulerActive) {
            workerItems.push(translateMessage('scheduler · polling engine'))
          }
          if (Array.isArray(state.workerQueues)) {
            for (const entry of state.workerQueues) {
              if (!entry || typeof entry !== 'object') continue
              const queue = entry.queue || 'unknown'
              const handlers = Number.isFinite(entry.handlers) ? entry.handlers : 0
              const concurrency = Number.isFinite(entry.concurrency) ? entry.concurrency : 0
              workerItems.push(queue + ' · ' + handlers + ' handler' + (handlers === 1 ? '' : 's') + ' · c' + concurrency)
            }
          }
          workersSummary.textContent = workerItems.length > 0 ? t('workersCount', { count: workerItems.length }) : t('workersSummary')
          renderSimpleList(workersList, workerItems, t('emptyWorkers'))
          readyUrl.textContent = state.readyUrl || t('targetPending')
          renderActivities(state.activities)

          if (state.ready && state.loginUrl) {
            statusCard.classList.add('ready')
            loginButton.textContent = t('loginReady')
            loginButton.href = state.loginUrl
            loginButton.setAttribute('aria-disabled', 'false')
          } else {
            statusCard.classList.remove('ready')
            loginButton.textContent = t('loginPreparing')
            loginButton.href = '#'
            loginButton.setAttribute('aria-disabled', 'true')
          }
        } catch {
          modeLine.textContent = t('waitingStatus')
        }
      }

      currentLocale = detectLocale()
      currentTheme = detectTheme()
      if (packagesCard) packagesCard.open = false
      if (workersCard) workersCard.open = false
      applyTheme()
      renderStaticText()
      refresh()
      setInterval(refresh, 1000)
    </script>
  </body>
</html>`
}

async function startSplashServer() {
  if (!autoOpenSplash) return

  splashChildStateFile = path.join(process.cwd(), '.mercato', 'dev-splash-child-state.json')
  fs.mkdirSync(path.dirname(splashChildStateFile), { recursive: true })
  writeSplashChildStateFileClear()

  splashServer = createServer((req, res) => {
    if (!req.url) {
      res.statusCode = 404
      res.end('Not found')
      return
    }

    if (req.url === '/status') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify(getMergedSplashState()))
      return
    }

    if (req.url === '/' || req.url.startsWith('/?')) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(renderSplashHtml(req))
      return
    }

    res.statusCode = 404
    res.end('Not found')
  })

  await new Promise((resolve, reject) => {
    splashServer.once('error', reject)
    splashServer.listen(0, '127.0.0.1', () => resolve())
  })

  const address = splashServer.address()
  if (!address || typeof address === 'string') return
  splashUrl = `http://localhost:${address.port}`
  console.log(`🪟 Dev splash ${splashUrl}`)
  updateSplashState({ activity: 'Splash page opened for live startup status' })
  openBrowser(splashUrl)
}

function closeSplashServer() {
  if (splashServer) {
    splashServer.close()
    splashServer = null
  }
  writeSplashChildStateFileClear()
}

function openBrowser(url) {
  try {
    if (process.platform === 'darwin') {
      const child = spawn('open', [url], { detached: true, stdio: 'ignore' })
      child.unref()
      return
    }

    if (process.platform === 'win32') {
      const child = spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' })
      child.unref()
      return
    }

    const child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' })
    child.unref()
  } catch {}
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return
  shuttingDown = true
  closeSplashServer()

  for (const child of children) {
    if (!child.killed) {
      child.kill('SIGTERM')
    }
  }

  setTimeout(() => {
    for (const child of children) {
      if (!child.killed) {
        child.kill('SIGKILL')
      }
    }
  }, 3000).unref()

  process.exit(exitCode)
}

process.on('SIGINT', () => shutdown(130))
process.on('SIGTERM', () => shutdown(143))

function isIgnorableTurboLine(line) {
  const plain = stripAnsi(line).trim()
  if (plain.length === 0) return true
  if (plain.startsWith('• turbo ')) return true
  if (plain.startsWith('• Packages in scope:')) return true
  if (plain.startsWith('• Running build in ')) return true
  if (plain.startsWith('• Running watch in ')) return true
  if (plain.startsWith('• Remote caching disabled')) return true
  if (plain.startsWith('Tasks:')) return true
  if (plain.startsWith('Cached:')) return true
  if (plain.startsWith('Time:')) return true
  if (/^[╭│╰]/.test(plain)) return true
  if (plain === '^C    ...Finishing writing to cache...') return true
  return false
}

async function runStage(label, commandArgs, options = {}) {
  const startedAt = Date.now()
  const stageTotal = options.stageTotal ?? (greenfield ? 5 : 3)
  const stageCurrent = options.stageCurrent
    ?? (commandArgs[0] === 'turbo' ? 1 : splashState.progressCurrent)
  console.log(`${formatProgressLine(label, stageCurrent, stageTotal, resolveProgressPercent(stageCurrent, stageTotal))}...`)
  updateSplashState({
    phase: label,
    detail: 'In progress',
    progressCurrent: stageCurrent,
    progressTotal: stageTotal,
    progressPercent: resolveProgressPercent(stageCurrent, stageTotal),
    progressLabel: label,
    activity: `${label} started`,
  })

  if (verbose) {
    const child = spawnCommand(yarnCommand, commandArgs, { stdio: 'inherit' })
    const code = await new Promise((resolve) => child.on('close', resolve))
    if ((code ?? 1) !== 0) {
      shutdown(code ?? 1)
    }
    return
  }

  const child = spawnCommand(yarnCommand, commandArgs)
  const capturedLines = []
  const capture = (line) => {
    capturedLines.push(line)
    if (capturedLines.length > 500) {
      capturedLines.shift()
    }
  }

  connectLineStream(child.stdout, capture)
  connectLineStream(child.stderr, capture)

  const code = await new Promise((resolve) => child.on('close', resolve))

  if ((code ?? 1) !== 0) {
    console.error(`❌ ${label} failed`)
    for (const line of capturedLines) {
      console.error(line)
    }
    shutdown(code ?? 1)
  }

  updateSplashState({
    phase: label,
    detail: `Completed in ${formatDuration(Date.now() - startedAt)}`,
    progressCurrent: stageCurrent,
    progressTotal: stageTotal,
    progressPercent: resolveProgressPercent(stageCurrent, stageTotal),
    progressLabel: label,
    activity: `${label} completed in ${formatDuration(Date.now() - startedAt)}`,
  })
  console.log(`✅ ${formatProgressLine(label, stageCurrent, stageTotal, resolveProgressPercent(stageCurrent, stageTotal))} in ${formatDuration(Date.now() - startedAt)}`)
}

async function runPassthroughStage(label, commandArgs, options = {}) {
  const startedAt = Date.now()
  const stageOrder = {
    'build:packages': 1,
    generate: 2,
    initialize: 4,
  }
  const stageCurrent = options.stageCurrent
    ?? stageOrder[commandArgs[0]]
    ?? (commandArgs[0] === 'build:packages' && splashState.progressCurrent >= 2 ? 3 : splashState.progressCurrent)
  const stageTotal = options.stageTotal ?? 5
  console.log(`${formatProgressLine(label, stageCurrent, stageTotal, resolveProgressPercent(stageCurrent, stageTotal))}...`)
  updateSplashState({
    phase: label,
    detail: 'Streaming setup output in terminal',
    progressCurrent: stageCurrent,
    progressTotal: stageTotal,
    progressPercent: resolveProgressPercent(stageCurrent, stageTotal),
    progressLabel: label,
    activity: `${label} started`,
  })

  const child = spawnCommand(yarnCommand, commandArgs, { stdio: 'inherit' })
  const code = await new Promise((resolve) => child.on('close', resolve))
  if ((code ?? 1) !== 0) {
    shutdown(code ?? 1)
  }

  updateSplashState({
    phase: label,
    detail: `Completed in ${formatDuration(Date.now() - startedAt)}`,
    progressCurrent: stageCurrent,
    progressTotal: stageTotal,
    progressPercent: resolveProgressPercent(stageCurrent, stageTotal),
    progressLabel: label,
    activity: `${label} completed in ${formatDuration(Date.now() - startedAt)}`,
  })
  console.log(`✅ ${formatProgressLine(label, stageCurrent, stageTotal, resolveProgressPercent(stageCurrent, stageTotal))} in ${formatDuration(Date.now() - startedAt)}`)
}

function startPackageWatch() {
  const stageCurrent = greenfield ? 5 : 2
  const stageTotal = greenfield ? 5 : 3
  console.log(`👀 ${formatProgressLine('Watching workspace packages', stageCurrent, stageTotal, resolveProgressPercent(stageCurrent, stageTotal))}`)
  updateSplashState({
    phase: 'Watching workspace packages',
    detail: 'Package watchers are running in the background',
    progressCurrent: stageCurrent,
    progressTotal: stageTotal,
    progressPercent: resolveProgressPercent(stageCurrent, stageTotal),
    progressLabel: 'Watching workspace packages',
    activity: 'Workspace package watch started',
  })

  const child = spawnCommand(yarnCommand, [
    'turbo',
    'run',
    'watch',
    '--filter=./packages/*',
    '--parallel',
    '--output-logs=errors-only',
    '--log-order=grouped',
    '--log-prefix=none',
  ], {
    stdio: verbose ? 'inherit' : 'pipe',
  })

  if (verbose) {
    child.on('close', (code) => {
      if (!shuttingDown && (code ?? 1) !== 0) {
        console.error('❌ Package watch stopped')
        shutdown(code ?? 1)
      }
    })
    return child
  }

  let surfacedFailure = false

  const handleLine = (line) => {
    if (isIgnorableTurboLine(line)) return

    if (!surfacedFailure) {
      surfacedFailure = true
      console.error('❌ Package watch emitted raw output')
    }

    console.error(line)
  }

  connectLineStream(child.stdout, handleLine)
  connectLineStream(child.stderr, handleLine)

  child.on('close', (code) => {
    if (!shuttingDown && (code ?? 1) !== 0) {
      console.error('❌ Package watch stopped')
      shutdown(code ?? 1)
    }
  })

  return child
}

function launchAppWorkspaceDev() {
  const appArgs = ['workspace', '@open-mercato/app', 'dev']
  if (verbose) {
    appArgs.push('--verbose')
  }

  const stageCurrent = greenfield ? 5 : 3
  const stageTotal = greenfield ? 5 : 3
  console.log(`🚀 ${formatProgressLine('Starting app runtime', stageCurrent, stageTotal, resolveProgressPercent(stageCurrent, stageTotal))}`)
  updateSplashState({
    phase: 'Preparing app runtime',
    detail: 'Launching app runtime, queue workers, and scheduler',
    progressCurrent: stageCurrent,
    progressTotal: stageTotal,
    progressPercent: resolveProgressPercent(stageCurrent, stageTotal),
    progressLabel: 'Launching app runtime',
    activity: 'App runtime is starting',
  })
  const app = spawnCommand(yarnCommand, appArgs, {
    stdio: 'inherit',
    env: splashChildStateFile ? {
      OM_DEV_SPLASH_CHILD_STATE_FILE: splashChildStateFile,
      OM_DEV_SPLASH_MODE: greenfield ? 'greenfield' : 'dev',
    } : undefined,
  })

  app.on('close', (code) => {
    if (!shuttingDown) {
      shutdown(code ?? 0)
    }
  })
}

async function runStandardDev() {
  await runStage('🧱 Building workspace packages', [
    'turbo',
    'run',
    'build',
    '--filter=./packages/*',
    '--output-logs=errors-only',
    '--log-order=grouped',
    '--log-prefix=none',
  ])

  startPackageWatch()
  launchAppWorkspaceDev()
}

async function runGreenfieldDev() {
  await runStage('🧱 Greenfield build packages', ['build:packages'], { stageCurrent: 1, stageTotal: 5 })
  await runStage('🧬 Greenfield generate artifacts', ['generate'], { stageCurrent: 2, stageTotal: 5 })
  await runStage('🧱 Greenfield rebuild packages', ['build:packages'], { stageCurrent: 3, stageTotal: 5 })
  await runPassthroughStage('🛠️ Greenfield initialize', ['initialize', '--', '--reinstall'], { stageCurrent: 4, stageTotal: 5 })

  startPackageWatch()
  launchAppWorkspaceDev()
}

async function main() {
  await startSplashServer()

  if (appOnly) {
    launchAppWorkspaceDev()
    return
  }

  if (greenfield) {
    await runGreenfieldDev()
    return
  }

  await runStandardDev()
}

await main()
