import { parseUserAgent } from '../user-agent'

describe('parseUserAgent', () => {
  const cases = [
    ['Chrome on Windows', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36', 'Chrome', '131', 'Windows', '10.0', 'desktop'],
    ['Edge on Windows', 'Mozilla/5.0 (Windows NT 10.0) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.2903.70', 'Edge', '131', 'Windows', '10.0', 'desktop'],
    ['Edge on Android', 'Mozilla/5.0 (Linux; Android 14) Chrome/131.0.0.0 Mobile Safari/537.36 EdgA/131.0.0.0', 'Edge', '131', 'Android', '14', 'mobile'],
    ['Firefox on Linux', 'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0', 'Firefox', '132', 'Linux', null, 'desktop'],
    ['Firefox on iOS', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) FxiOS/132.0 Mobile/15E148 Safari/605.1.15', 'Firefox', '132', 'iOS', '18.1', 'mobile'],
    ['Safari on macOS', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.1 Safari/605.1.15', 'Safari', '18', 'macOS', '10.15.7', 'desktop'],
    ['Safari on iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) Version/18.1 Mobile/15E148 Safari/604.1', 'Safari', '18', 'iOS', '18.1', 'mobile'],
    ['Safari on iPad', 'Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) Version/18.1 Mobile/15E148 Safari/604.1', 'Safari', '18', 'iPadOS', '18.1', 'tablet'],
    ['iPad with a Macintosh token', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/18.1 Mobile/15E148 Safari/604.1', 'Safari', '18', 'iPadOS', null, 'tablet'],
    ['Opera on Windows', 'Mozilla/5.0 (Windows NT 10.0) Chrome/131.0.0.0 Safari/537.36 OPR/115.0.0.0', 'Opera', '115', 'Windows', '10.0', 'desktop'],
    ['Samsung Internet on Android', 'Mozilla/5.0 (Linux; Android 14; SM-S921B) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36', 'Samsung Internet', '27', 'Android', '14', 'mobile'],
    ['Chrome on Android tablet', 'Mozilla/5.0 (Linux; Android 13; Pixel Tablet) Chrome/131.0.0.0 Safari/537.36', 'Chrome', '131', 'Android', '13', 'tablet'],
    ['Chrome on ChromeOS', 'Mozilla/5.0 (X11; CrOS x86_64 16093.68.0) Chrome/131.0.0.0 Safari/537.36', 'Chrome', '131', 'ChromeOS', '16093.68.0', 'desktop'],
    ['Chrome on iOS', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) CriOS/131.0.0.0 Mobile/15E148 Safari/604.1', 'Chrome', '131', 'iOS', '18.1', 'mobile'],
    ['bot with browser tokens', 'Mozilla/5.0 (Linux; Android 6.0.1) Chrome/131.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1)', null, null, null, null, 'bot'],
    ['missing', null, null, null, null, null, 'unknown'],
    ['empty', '', null, null, null, null, 'unknown'],
    ['unrecognized', 'unrecognized-agent/1.0', null, null, null, null, 'unknown'],
    ['oversized', 'Firefox/132 on Linux ' + 'x'.repeat(512), null, null, null, null, 'unknown'],
  ] as const

  test.each(cases)('%s', (_label, userAgent, browserName, browserVersion, osName, osVersion, deviceType) => {
    expect(parseUserAgent(userAgent)).toEqual({ browserName, browserVersion, osName, osVersion, deviceType })
  })
})
