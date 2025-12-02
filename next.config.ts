import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverMinification: false,
    turbopackMinify: false,
  },
  turbopack: {
    root: __dirname,
  },
  /* config options here */
}

export default nextConfig
