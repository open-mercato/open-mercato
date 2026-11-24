type DeviceType = 'desktop' | 'mobile' | 'tablet' | 'bot' | 'unknown'

type ParsedUserAgent = {
  browserName: string | null
  browserVersion: string | null
  osName: string | null
  osVersion: string | null
  deviceType: DeviceType
}

const browsers = [
  ['Edge', /\b(?:Edg|Edge|EdgiOS|EdgA)\/(\d+)/i],
  ['Opera', /\b(?:OPR|OPiOS|Opera Mini|Opera Mobi)\/(\d+)/i],
  ['Opera', /\bOpera\b.*\bVersion\/(\d+)/i],
  ['Opera', /\bOpera\/(\d+)/i],
  ['Samsung Internet', /\bSamsungBrowser\/(\d+)/i],
  ['Firefox', /\b(?:Firefox|FxiOS)\/(\d+)/i],
  ['Chrome', /\b(?:Chrome|CriOS)\/(\d+)/i],
  ['Safari', /\bVersion\/(\d+)[\d.]*.*\bSafari\//i],
] as const

const operatingSystems = [
  ['iPadOS', /\biPad\b(?:[^;)]*;[^)]*?\bOS ([\d_]+))?/i],
  ['iOS', /\b(?:iPhone|iPod)\b(?:[^;)]*;[^)]*?\bOS ([\d_]+))?/i],
  ['Android', /\bAndroid\b(?: ([\d.]+))?/i],
  ['Windows', /\bWindows\b(?: (?:NT|Phone(?: OS)?) ([\d.]+))?/i],
  ['ChromeOS', /\bCrOS\b(?: [\w-]+ ([\d.]+))?/i],
  ['macOS', /\bMacintosh\b(?:[^)]*?\bMac OS X ([\d_.]+))?/i],
  ['Linux', /\bLinux\b/i],
] as const

function matchFamily(userAgent: string, patterns: readonly (readonly [string, RegExp])[]) {
  for (const [name, pattern] of patterns) {
    const match = pattern.exec(userAgent)
    if (match) return { name, version: match[1]?.replace(/_/g, '.') ?? null }
  }
  return { name: null, version: null }
}

function classifyDevice(userAgent: string, osName: string | null): DeviceType {
  if (osName === 'iPadOS' || /\bTablet\b/i.test(userAgent)) return 'tablet'
  if (osName === 'iOS' || /\b(?:Mobile|Windows Phone)\b/i.test(userAgent)) return 'mobile'
  if (osName === 'Android') return 'tablet'
  return osName ? 'desktop' : 'unknown'
}

export function parseUserAgent(userAgent: string | null): ParsedUserAgent {
  const empty: ParsedUserAgent = {
    browserName: null,
    browserVersion: null,
    osName: null,
    osVersion: null,
    deviceType: 'unknown',
  }
  if (!userAgent || userAgent.length > 512) return empty
  if (/\b[\w-]*(?:bot|crawler|spider)\b|\bslurp\b/i.test(userAgent)) {
    return { ...empty, deviceType: 'bot' }
  }

  const browser = matchFamily(userAgent, browsers)
  const os = matchFamily(userAgent, operatingSystems)
  const isDesktopModeIPad = os.name === 'macOS' && /\bMobile\//i.test(userAgent)
  const osName = isDesktopModeIPad ? 'iPadOS' : os.name
  return {
    browserName: browser.name,
    browserVersion: browser.version,
    osName,
    osVersion: isDesktopModeIPad ? null : os.version,
    deviceType: classifyDevice(userAgent, osName),
  }
}
