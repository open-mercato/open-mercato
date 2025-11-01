import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    experimental: {
    serverMinification: false,
    turbo: {
      minify: false,

    },
  }
  /* config options here */
};

export default nextConfig;
