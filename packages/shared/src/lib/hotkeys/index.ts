"use client"

type HotkeyRegistration = {
  combos: Set<string>
  callback: (event: KeyboardEvent) => void
  debounce: number
  lastTriggered: number
}

const scopes = new Map<string, Set<HotkeyRegistration>>()

const MODIFIER_SYNONYMS: Record<string, string> = {
  cmd: 'meta',
  command: 'meta',
  option: 'alt',
  opt: 'alt',
  control: 'ctrl',
  ctrl: 'ctrl',
  shift: 'shift',
  meta: 'meta',
  alt: 'alt',
}

let listenersAttached = false

const THIRTY_FPS_INTERVAL = 1000 / 30

function normalizeToken(token: string): string {
  const trimmed = token.trim().toLowerCase()
  if (!trimmed) return ''
  if (trimmed in MODIFIER_SYNONYMS) return MODIFIER_SYNONYMS[trimmed]
  if (trimmed === 'return') return 'enter'
  if (trimmed === 'space') return ' '
  return trimmed
}

function serializeCombination(tokens: string[]): string {
  const filtered = tokens.filter(Boolean)
  filtered.sort()
  return filtered.join('+')
}

function parseHotkeys(hotkeys: string): Set<string> {
  return new Set(
    hotkeys
      .split(/\s+/)
      .map((combo) =>
        serializeCombination(
          combo
            .split('+')
            .map(normalizeToken)
            .filter(Boolean),
        ),
      )
      .filter(Boolean),
  )
}

function createRegistration(
  hotkeys: string,
  callback: (event: KeyboardEvent) => void,
  debounce: number,
): HotkeyRegistration {
  const combos = parseHotkeys(hotkeys)
  return {
    combos,
    callback,
    debounce: Math.max(debounce, THIRTY_FPS_INTERVAL),
    lastTriggered: 0,
  }
}

function activeCombination(event: KeyboardEvent): string | null {
  const keys: string[] = []
  if (event.metaKey) keys.push('meta')
  if (event.ctrlKey) keys.push('ctrl')
  if (event.altKey) keys.push('alt')
  if (event.shiftKey) keys.push('shift')

  const key = normalizeToken(event.key)
  if (key && !(key in MODIFIER_SYNONYMS)) {
    keys.push(key.length === 1 ? key : normalizeToken(key))
  } else if (keys.length === 0) {
    // Ignore pure modifier presses
    return null
  }

  return serializeCombination(keys)
}

function handleKeydown(event: KeyboardEvent) {
  if (event.defaultPrevented) return
  const combo = activeCombination(event)
  if (!combo) return

  const now = Date.now()
  scopes.forEach((registrations) => {
    registrations.forEach((registration) => {
      if (!registration.combos.has(combo)) return
      if (event.repeat && now - registration.lastTriggered < registration.debounce) return
      if (now - registration.lastTriggered < registration.debounce) return
      registration.lastTriggered = now
      registration.callback(event)
    })
  })
}

function handleKeyup() {
  // No-op placeholder for future extensibility (mirrors API pattern from article reference)
}

function ensureListeners() {
  if (listenersAttached) return
  if (typeof document === 'undefined') return
  document.addEventListener('keydown', handleKeydown)
  document.addEventListener('keyup', handleKeyup)
  listenersAttached = true
}

function detachListenersIfIdle() {
  if (!listenersAttached) return
  if (scopes.size > 0) return
  if (typeof document === 'undefined') return
  document.removeEventListener('keydown', handleKeydown)
  document.removeEventListener('keyup', handleKeyup)
  listenersAttached = false
}

export function registerHotkey(
  hotkeys: string,
  scopeName: string,
  callback: (event: KeyboardEvent) => void,
  debounceTimeInMilliseconds = 150,
) {
  if (typeof document === 'undefined') {
    return {
      bind() {},
      unbind() {},
    }
  }

  const registration = createRegistration(hotkeys, callback, debounceTimeInMilliseconds)
  let scope = scopes.get(scopeName)

  const bind = () => {
    if (!scope) {
      scope = new Set()
      scopes.set(scopeName, scope)
    }
    scope.add(registration)
    ensureListeners()
  }

  const unbind = () => {
    const existingScope = scopes.get(scopeName)
    if (existingScope) {
      existingScope.delete(registration)
      if (existingScope.size === 0) {
        scopes.delete(scopeName)
      }
    }
    detachListenersIfIdle()
  }

  bind()

  return { bind, unbind }
}
