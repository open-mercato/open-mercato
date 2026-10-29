// Console UX for the starter: colors, banner, staged progress, spinners.
// Node stdlib only. Honors NO_COLOR and degrades cleanly when not a TTY
// (CI logs get plain, timestamped lines instead of animations).

const isTty = Boolean(process.stdout.isTTY)
const colorEnabled = isTty && !process.env.NO_COLOR && process.env.TERM !== 'dumb'

function paint(code) {
  return (text) => (colorEnabled ? `[${code}m${text}[0m` : String(text))
}

export const color = {
  bold: paint('1'),
  dim: paint('2'),
  red: paint('31'),
  green: paint('32'),
  yellow: paint('33'),
  blue: paint('34'),
  magenta: paint('35'),
  cyan: paint('36'),
}

// The Open Mercato two-tone wordmark (carried over from the retired Windows
// launcher). Pure 7-bit ASCII on purpose: conhost and OEM code pages on
// managed Windows machines mangle box-drawing characters.
const LOGO_LEFT = [
  '  ___  ____  _____ _   _ ',
  ' / _ \\|  _ \\| ____| \\ | |',
  '| | | | |_) |  _| |  \\| |',
  '| |_| |  __/| |___| |\\  |',
  ' \\___/|_|   |_____|_| \\_|',
]

const LOGO_RIGHT = [
  ' __  __ _____ ____   ____    _  _____ ___',
  '|  \\/  | ____|  _ \\ / ___|  / \\|_   _/ _ \\',
  '| |\\/| |  _| | |_) | |     / _ \\ | || | | |',
  '| |  | | |___|  _ <| |___ / ___ \\| || |_| |',
  '|_|  |_|_____|_| \\_\\\\____/_/   \\_\\_| \\___/',
]

export function printBanner(subtitle, { log = console.log } = {}) {
  log('')
  for (let index = 0; index < LOGO_LEFT.length; index++) {
    log(`   ${color.dim(color.cyan(LOGO_LEFT[index]))}  ${color.cyan(LOGO_RIGHT[index])}`)
  }
  log('')
  if (subtitle) log(color.dim(`   ${subtitle}`))
  log('')
}

export function stepHeader(index, total, title, expectation, { log = console.log } = {}) {
  log('')
  log(`${color.bold(color.blue(`── Step ${index}/${total}`))} ${color.bold(title)}`)
  if (expectation) log(color.dim(`   Expected: ${expectation}`))
}

export const icons = {
  ok: color.green('OK'),
  warn: color.yellow('!!'),
  fail: color.red('XX'),
  info: color.cyan('--'),
}

export function statusLine(kind, message, { log = console.log } = {}) {
  log(`   ${icons[kind] ?? icons.info} ${message}`)
}

// Framed remediation guide so "what do I do next" never drowns in output.
export function guideBox(title, lines, { log = console.log } = {}) {
  log('')
  log(color.yellow(color.bold(`   ${title}`)))
  for (const line of lines) {
    log(line === '' ? '' : color.yellow(`   | `) + line)
  }
  log('')
}

const SPINNER_FRAMES = ['|', '/', '-', '\\']

// Spinner for long waits that produce no streamed output. In non-TTY contexts
// it prints the label once and then only meaningful updates via update().
export function createSpinner(label) {
  let frame = 0
  let currentLabel = label
  let timer = null
  const startedAt = Date.now()

  const render = () => {
    const elapsed = Math.round((Date.now() - startedAt) / 1000)
    process.stdout.write(`\r   ${color.cyan(SPINNER_FRAMES[frame % SPINNER_FRAMES.length])} ${currentLabel} ${color.dim(`(${elapsed}s)`)}   `)
    frame += 1
  }

  if (isTty) {
    timer = setInterval(render, 120)
    render()
  } else {
    console.log(`   ... ${label}`)
  }

  return {
    update(nextLabel) {
      if (nextLabel === currentLabel) return
      currentLabel = nextLabel
      if (!isTty) console.log(`   ... ${nextLabel}`)
    },
    stop(kind = null, message = null) {
      if (timer) {
        clearInterval(timer)
        process.stdout.write('\r' + ' '.repeat(100) + '\r')
      }
      if (kind && message) statusLine(kind, message)
    },
  }
}

export function formatDuration(ms) {
  const totalSeconds = Math.round(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  return `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`
}
