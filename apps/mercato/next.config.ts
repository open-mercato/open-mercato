import type { NextConfig } from "next";
import path from "node:path";

const nrExternals = require('newrelic/load-externals')

// Resolve to monorepo root (two levels up from apps/mercato)
const workspaceRoot = path.resolve(__dirname, '../..');

const nextConfig: NextConfig = {
  experimental: {
    serverMinification: false,
    turbopackMinify: false,
  },
  turbopack: {
    root: workspaceRoot,
  },
  /* config options here */
}

export default nextConfig
