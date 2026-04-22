/**
 * Network and URL security utilities.
 */

/**
 * Returns true if the dotted-decimal IPv4 string is in a private/internal range.
 * Covers RFC 1918, loopback (127/8), link-local (169.254/16), and 0.0.0.0/8
 * (which the Linux kernel routes to loopback for outbound TCP connections).
 */
export function isPrivateIPv4(ip: string): boolean {
    const parts = ip.split('.').map(Number)
    const [a, b] = parts
    return (
        a === 0 ||
        a === 10 ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        a === 127 ||
        (a === 169 && b === 254)
    )
}

/**
 * Returns true if the bare IPv6 address (brackets already stripped) is private.
 * Covers: loopback (::1), link-local (fe80::/10), unique local (fc00::/7),
 * and IPv4-mapped addresses (::ffff:<ipv4>) whose embedded IPv4 is private.
 */
export function isPrivateIPv6(addr: string): boolean {
    const lower = addr.toLowerCase()
    if (lower === '::1') return true
    if (/^fe[89ab]/i.test(lower)) return true
    if (/^f[cd]/i.test(lower)) return true
    const mixedMatch = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
    if (mixedMatch) return isPrivateIPv4(mixedMatch[1])
    const hexMatch = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
    if (hexMatch) {
        const hi = parseInt(hexMatch[1].padStart(4, '0'), 16)
        const lo = parseInt(hexMatch[2].padStart(4, '0'), 16)
        return isPrivateIPv4(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`)
    }
    return false
}

/**
 * Returns true if the URL targets a private/internal host.
 * Covers IPv4 RFC 1918/loopback/link-local/0.0.0.0, IPv6 loopback/link-local/unique-local,
 * IPv4-mapped IPv6, and the localhost hostname family (including trailing-dot forms).
 * Does not perform DNS resolution — checks the literal host only.
 */
export function isPrivateUrl(rawUrl: string): boolean {
    // Strip IPv6 zone IDs before parsing — WHATWG URL rejects zone IDs in http/https
    // (e.g. "http://[fe80::1%25eth0]/" → "http://[fe80::1]/").
    // The underlying address is still private, so we strip and check to fail closed.
    const urlToParse = rawUrl.replace(/\[([0-9a-fA-F:]+)%25[^\]]*\]/g, '[$1]')

    let hostname: string
    try {
        hostname = new URL(urlToParse).hostname
    } catch {
        return false
    }
    // Normalize: strip trailing dot preserved by the WHATWG URL parser
    // (e.g. "http://localhost./" parses to hostname "localhost.")
    const host = hostname.replace(/\.$/, '')

    if (host.startsWith('[') && host.endsWith(']')) {
        return isPrivateIPv6(host.slice(1, -1))
    }
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) {
        return isPrivateIPv4(host)
    }
    if (host === 'localhost' || host.endsWith('.localhost')) {
        return true
    }
    return false
}
