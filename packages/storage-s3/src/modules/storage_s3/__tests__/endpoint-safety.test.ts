/** @jest-environment node */

import { createSafeS3EndpointLookup, UnsafeS3EndpointError } from '../lib/endpoint-safety'

function runLookup(
  lookup: NonNullable<ReturnType<typeof createSafeS3EndpointLookup>>,
  hostname: string,
): Promise<{ address: string; family: number | undefined }> {
  return new Promise((resolve, reject) => {
    lookup(hostname, {}, (err, address, family) => {
      if (err) {
        reject(err)
        return
      }
      if (typeof address !== 'string') {
        reject(new Error('Expected a single lookup result'))
        return
      }
      resolve({ address, family })
    })
  })
}

describe('S3 endpoint safety', () => {
  it('validates the DNS result used by the AWS SDK lookup callback', async () => {
    const lookupHost = jest
      .fn()
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValueOnce([{ address: '169.254.169.254', family: 4 }])

    const lookup = createSafeS3EndpointLookup('https://objects.example.com', { lookupHost })
    expect(lookup).toBeDefined()

    await expect(runLookup(lookup!, 'objects.example.com')).resolves.toEqual({
      address: '93.184.216.34',
      family: 4,
    })
    await expect(runLookup(lookup!, 'objects.example.com')).rejects.toMatchObject({
      reason: 'private_ip_resolved',
    })
  })

  it('validates virtual-hosted bucket endpoint hosts requested by the AWS SDK', async () => {
    const lookupHost = jest.fn().mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
    const lookup = createSafeS3EndpointLookup('https://objects.example.com', { lookupHost })

    await expect(runLookup(lookup!, 'test-bucket.objects.example.com')).resolves.toEqual({
      address: '93.184.216.34',
      family: 4,
    })

    expect(lookupHost).toHaveBeenCalledWith('test-bucket.objects.example.com')
  })

  it('rejects virtual-hosted bucket endpoint hosts that resolve to private addresses', async () => {
    const lookupHost = jest.fn().mockResolvedValueOnce([{ address: '169.254.169.254', family: 4 }])
    const lookup = createSafeS3EndpointLookup('https://objects.example.com', { lookupHost })

    await expect(runLookup(lookup!, 'test-bucket.objects.example.com')).rejects.toMatchObject({
      reason: 'private_ip_resolved',
    })
  })

  it('refuses lookup attempts for hosts other than the configured endpoint host', async () => {
    const lookup = createSafeS3EndpointLookup('https://objects.example.com')

    await expect(runLookup(lookup!, 'metadata.google.internal')).rejects.toBeInstanceOf(
      UnsafeS3EndpointError,
    )
  })
})
