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

function renderSplashHtml() {
  const inlineLogoSvg = resolveSplashLogoSvg()
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Open Mercato Dev</title>
    <style>
      :root {
        --bg: #071427;
        --bg-deep: #06111f;
        --panel: rgba(9, 25, 46, 0.82);
        --panel-strong: rgba(11, 28, 50, 0.9);
        --panel-border: rgba(163, 184, 210, 0.16);
        --surface: rgba(255, 255, 255, 0.045);
        --surface-strong: rgba(255, 255, 255, 0.07);
        --muted: #98abc7;
        --text: #f6f8fb;
        --accent: #73efc2;
        --accent-strong: #2b9f7d;
        --warning: #ffcb4d;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: var(--text);
        background:
          radial-gradient(circle at top left, rgba(115, 239, 194, 0.14), transparent 32%),
          radial-gradient(circle at 85% 20%, rgba(119, 165, 255, 0.15), transparent 24%),
          linear-gradient(180deg, var(--bg), var(--bg-deep));
        display: grid;
        place-items: center;
        padding: 24px;
      }
      .shell {
        width: min(1280px, 100%);
        display: grid;
        grid-template-columns: minmax(0, 1.35fr) minmax(360px, 0.85fr);
        gap: 24px;
      }
      .panel {
        background: var(--panel);
        border: 1px solid var(--panel-border);
        border-radius: 36px;
        backdrop-filter: blur(18px);
        box-shadow: 0 32px 80px rgba(0, 0, 0, 0.32);
      }
      .hero {
        padding: 44px 48px;
        display: flex;
        flex-direction: column;
        gap: 22px;
      }
      .brand {
        display: flex;
        align-items: center;
        gap: 14px;
      }
      .logo-chip {
        width: 58px;
        height: 58px;
        display: grid;
        place-items: center;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
      }
      .logo-chip svg {
        width: 30px;
        height: 30px;
      }
      .brand-copy {
        display: grid;
        gap: 5px;
      }
      .badge {
        display: inline-flex;
        width: fit-content;
        align-items: center;
        gap: 8px;
        padding: 10px 16px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.06);
        color: var(--muted);
        font-size: 13px;
        letter-spacing: 0.1em;
        text-transform: uppercase;
      }
      .brand-title {
        font-size: 18px;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      h1 {
        margin: 0;
        font-size: clamp(56px, 7vw, 94px);
        line-height: 0.93;
        letter-spacing: -0.07em;
        max-width: 8.6ch;
      }
      .summary {
        color: var(--muted);
        font-size: 22px;
        line-height: 1.5;
        max-width: 31rem;
      }
      .stream-shell {
        display: grid;
        gap: 14px;
        margin-top: 8px;
      }
      .stream-heading {
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.11em;
        text-transform: uppercase;
        color: var(--muted);
      }
      .status-card {
        padding: 34px 30px;
        display: flex;
        flex-direction: column;
        gap: 18px;
        justify-content: center;
        background: var(--panel-strong);
      }
      .status-line {
        font-size: 15px;
        color: var(--muted);
      }
      .phase {
        font-size: 30px;
        line-height: 1.12;
        margin: 0;
        letter-spacing: -0.04em;
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
        border: 1px solid rgba(255, 255, 255, 0.1);
      }
      .progress-fill {
        height: 100%;
        width: 0%;
        background: linear-gradient(90deg, var(--accent), #79b7ff);
        transition: width 0.3s ease;
      }
      .button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 52px;
        padding: 0 18px;
        border-radius: 18px;
        border: 1px solid transparent;
        text-decoration: none;
        font-weight: 700;
        transition: transform 0.18s ease, opacity 0.18s ease, border-color 0.18s ease;
      }
      .button.primary {
        background: linear-gradient(135deg, #5bd6aa, #2c8f74);
        color: #062117;
      }
      .button.secondary {
        border-color: rgba(255, 255, 255, 0.16);
        color: var(--text);
      }
      .button[aria-disabled="true"] {
        opacity: 0.55;
        pointer-events: none;
      }
      .memory-card,
      details.fold-card {
        display: grid;
        gap: 8px;
        padding: 16px 18px;
        border-radius: 22px;
        background: var(--surface);
        border: 1px solid rgba(255, 255, 255, 0.08);
      }
      .memory-title {
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
      }
      .memory-value {
        font-size: 18px;
        color: var(--text);
      }
      .fold-card summary {
        cursor: pointer;
        font-size: 13px;
        color: var(--muted);
        list-style: none;
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
        gap: 12px;
      }
      .list li {
        padding: 16px 18px;
        border-radius: 22px;
        background: var(--surface);
        border: 1px solid rgba(255, 255, 255, 0.05);
        color: #c7d5e8;
        font-size: 18px;
        line-height: 1.45;
      }
      .url {
        color: var(--warning);
        word-break: break-all;
      }
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
      @media (max-width: 960px) {
        .shell { grid-template-columns: 1fr; }
        .hero, .status-card { padding: 32px 26px; }
        h1 { font-size: clamp(46px, 13vw, 72px); max-width: none; }
        .summary { font-size: 19px; }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <section class="panel hero">
        <div class="brand">
          <div class="logo-chip" aria-hidden="true">${inlineLogoSvg}</div>
          <div class="brand-copy">
            <span class="badge">Open Mercato Dev</span>
            <div class="brand-title">OPEN MERCATO</div>
          </div>
        </div>
        <h1>Installation and first compilation is in progress…</h1>
        <p class="summary">
          The workspace is being prepared in the terminal. This page switches to a ready state as soon as the dev server becomes available.
        </p>
        <section class="stream-shell" aria-labelledby="stream-heading">
          <div class="stream-heading" id="stream-heading">✨ Live startup stream</div>
          <ul class="list" id="activity-list">
            <li>🪟 Preparing dev environment…</li>
          </ul>
        </section>
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
        <div class="memory-card">
          <div class="memory-title">🧠 Runtime memory</div>
          <div class="memory-value" id="memory-value">pending</div>
        </div>
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
        <div class="status-line">Current target: <span class="url" id="ready-url">pending</span></div>
        <div class="actions">
          <a class="button primary" id="login-button" href="#" aria-disabled="true">🚀 App is preparing…</a>
          <a class="button secondary" id="terminal-button" href="#" aria-disabled="true">🖥 Keep terminal visible</a>
        </div>
      </aside>
    </main>
    <script>
      const modeLine = document.getElementById('mode-line')
      const phaseText = document.getElementById('phase-text')
      const detailText = document.getElementById('detail-text')
      const progressLabel = document.getElementById('progress-label')
      const progressValue = document.getElementById('progress-value')
      const progressFill = document.getElementById('progress-fill')
      const memoryValue = document.getElementById('memory-value')
      const packagesSummary = document.getElementById('packages-summary')
      const packagesList = document.getElementById('packages-list')
      const workersSummary = document.getElementById('workers-summary')
      const workersList = document.getElementById('workers-list')
      const readyUrl = document.getElementById('ready-url')
      const loginButton = document.getElementById('login-button')
      const terminalButton = document.getElementById('terminal-button')
      const activityList = document.getElementById('activity-list')
      const statusCard = document.getElementById('status-card')

      terminalButton.addEventListener('click', (event) => {
        event.preventDefault()
        window.focus()
      })

      function renderActivities(items) {
        if (!Array.isArray(items) || items.length === 0) return
        const ordered = items.slice().reverse()
        activityList.innerHTML = ordered.map((item) => '<li>' + item.replace(/[&<>"]/g, (char) => ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;'
        }[char])) + '</li>').join('')
      }

      function formatMemory(bytes) {
        if (!Number.isFinite(bytes) || bytes <= 0) return 'pending'
        if (bytes >= 1024 * 1024 * 1024) {
          return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB'
        }
        return Math.round(bytes / (1024 * 1024)) + ' MB'
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
          modeLine.textContent = state.mode === 'greenfield' ? 'Greenfield dev flow' : 'Standard dev flow'
          phaseText.textContent = state.phase || 'Preparing app runtime'
          detailText.textContent = state.detail || 'Preparing app runtime'
          const percent = Number.isFinite(state.progressPercent) ? Math.max(0, Math.min(100, state.progressPercent)) : 0
          progressLabel.textContent = state.progressLabel || 'Preparing startup pipeline'
          progressValue.textContent = Number.isFinite(state.progressCurrent) && Number.isFinite(state.progressTotal) && state.progressTotal > 0
            ? state.progressCurrent + '/' + state.progressTotal + ' · ' + percent + '%'
            : percent + '%'
          progressFill.style.width = percent + '%'
          memoryValue.textContent = Number.isFinite(state.memoryCurrentBytes) && state.memoryCurrentBytes > 0
            ? formatMemory(state.memoryCurrentBytes) + ' RSS · peak ' + formatMemory(state.memoryPeakBytes)
            : 'pending'
          const packages = Array.isArray(state.packageNames) ? state.packageNames : []
          packagesSummary.textContent = packages.length > 0
            ? '📦 Active packages (' + packages.length + ')'
            : '📦 Active packages'
          renderSimpleList(packagesList, packages, 'Waiting for app package manifest…')
          const workerItems = []
          if (state.schedulerActive) {
            workerItems.push('scheduler · polling engine')
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
          workersSummary.textContent = workerItems.length > 0
            ? '⚙️ Background services (' + workerItems.length + ')'
            : '⚙️ Background services'
          renderSimpleList(workersList, workerItems, 'Waiting for queue worker startup…')
          readyUrl.textContent = state.readyUrl || 'pending'
          renderActivities(state.activities)

          if (state.ready && state.loginUrl) {
            statusCard.classList.add('ready')
            loginButton.textContent = '🚪 App is ready, open login'
            loginButton.href = state.loginUrl
            loginButton.setAttribute('aria-disabled', 'false')
            terminalButton.setAttribute('aria-disabled', 'false')
          } else {
            statusCard.classList.remove('ready')
            loginButton.textContent = '🚀 App is preparing…'
            loginButton.href = '#'
            loginButton.setAttribute('aria-disabled', 'true')
            terminalButton.setAttribute('aria-disabled', 'false')
          }
        } catch {
          modeLine.textContent = 'Waiting for dev runner status…'
        }
      }

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
      res.end(renderSplashHtml())
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
  splashUrl = `http://127.0.0.1:${address.port}`
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

async function runStage(label, commandArgs) {
  const startedAt = Date.now()
  const stageTotal = greenfield ? 5 : 3
  const stageCurrent = commandArgs[0] === 'turbo' ? 1 : splashState.progressCurrent
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

async function runPassthroughStage(label, commandArgs) {
  const startedAt = Date.now()
  const stageOrder = {
    'build:packages': 1,
    generate: 2,
    initialize: 4,
  }
  const stageCurrent = stageOrder[commandArgs[0]] ?? (commandArgs[0] === 'build:packages' && splashState.progressCurrent >= 2 ? 3 : splashState.progressCurrent)
  console.log(`${formatProgressLine(label, stageCurrent, 5, resolveProgressPercent(stageCurrent, 5))}...`)
  updateSplashState({
    phase: label,
    detail: 'Streaming setup output in terminal',
    progressCurrent: stageCurrent,
    progressTotal: 5,
    progressPercent: resolveProgressPercent(stageCurrent, 5),
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
    progressTotal: 5,
    progressPercent: resolveProgressPercent(stageCurrent, 5),
    progressLabel: label,
    activity: `${label} completed in ${formatDuration(Date.now() - startedAt)}`,
  })
  console.log(`✅ ${formatProgressLine(label, stageCurrent, 5, resolveProgressPercent(stageCurrent, 5))} in ${formatDuration(Date.now() - startedAt)}`)
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
  await runPassthroughStage('🧱 Greenfield build packages', ['build:packages'])
  await runPassthroughStage('🧬 Greenfield generate artifacts', ['generate'])
  await runPassthroughStage('🧱 Greenfield rebuild packages', ['build:packages'])
  await runPassthroughStage('🛠️ Greenfield initialize', ['initialize', '--', '--reinstall'])

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
