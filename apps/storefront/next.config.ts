import type { NextConfig } from 'next'

const API_BASE = process.env.NEXT_PUBLIC_STOREFRONT_API_URL ?? ''

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
      {
        protocol: 'http',
        hostname: 'localhost',
      },
    ],
  },
  async rewrites() {
    if (!API_BASE) return []
    return [
      {
        source: '/api/:path*',
        destination: `${API_BASE}/api/:path*`,
      },
    ]
  },
}

export default nextConfig
