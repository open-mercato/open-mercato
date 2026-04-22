import {
  isBlockedHostname,
  isPrivateIpAddress,
  isPrivateUrl,
} from '../network'

describe('network helpers', () => {
  const privateV4 = [
    '0.0.0.0',
    '10.0.0.1',
    '10.255.255.255',
    '100.64.0.1',
    '100.127.255.255',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.254',
    '192.0.0.1',
    '192.0.0.255',
    '192.0.2.1',
    '192.168.1.1',
    '198.18.0.1',
    '198.19.255.255',
    '198.51.100.1',
    '203.0.113.5',
    '224.0.0.1',
    '239.255.255.255',
    '240.0.0.1',
    '255.255.255.255',
  ]

  const publicV4 = [
    '1.1.1.1',
    '8.8.8.8',
    '93.184.216.34',
    '100.63.255.255',
    '100.128.0.1',
    '172.15.255.255',
    '172.32.0.1',
    '192.0.1.1',
    '198.17.255.255',
    '198.20.0.1',
  ]

  it.each(privateV4)('flags private or reserved IPv4 %s', (address) => {
    expect(isPrivateIpAddress(address)).toBe(true)
  })

  it.each(publicV4)('allows public IPv4 %s', (address) => {
    expect(isPrivateIpAddress(address)).toBe(false)
  })

  it('flags private or reserved IPv6 ranges without regex shortcuts', () => {
    expect(isPrivateIpAddress('::')).toBe(true)
    expect(isPrivateIpAddress('::1')).toBe(true)
    expect(isPrivateIpAddress('fc00::1')).toBe(true)
    expect(isPrivateIpAddress('fd12:3456::1')).toBe(true)
    expect(isPrivateIpAddress('fe80::1')).toBe(true)
    expect(isPrivateIpAddress('ff02::1')).toBe(true)
    expect(isPrivateIpAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isPrivateIpAddress('::ffff:7f00:1')).toBe(true)
    expect(isPrivateIpAddress('64:ff9b::a9fe:a9fe')).toBe(true)
    expect(isPrivateIpAddress('2002:0a00:0001::1')).toBe(true)
    expect(isPrivateIpAddress('::8.8.8.8')).toBe(true)
    expect(isPrivateIpAddress('::808:808')).toBe(true)
  })

  it('allows public IPv6 ranges', () => {
    expect(isPrivateIpAddress('2606:4700:4700::1111')).toBe(false)
    expect(isPrivateIpAddress('2001:4860:4860::8888')).toBe(false)
  })

  it('blocks internal hostnames and suffixes', () => {
    expect(isBlockedHostname('localhost')).toBe(true)
    expect(isBlockedHostname('localhost.')).toBe(true)
    expect(isBlockedHostname('api.localhost')).toBe(true)
    expect(isBlockedHostname('metadata.google.internal')).toBe(true)
    expect(isBlockedHostname('service.internal')).toBe(true)
    expect(isBlockedHostname('printer.local')).toBe(true)
    expect(isBlockedHostname('hooks.example.com')).toBe(false)
  })

  it('detects private URLs from normalized URL hostnames', () => {
    expect(isPrivateUrl('http://2130706433/')).toBe(true)
    expect(isPrivateUrl('http://0177.0.0.1/')).toBe(true)
    expect(isPrivateUrl('http://0x7f.0.0.1/')).toBe(true)
    expect(isPrivateUrl('https://hooks.example.com/endpoint')).toBe(false)
  })
})
