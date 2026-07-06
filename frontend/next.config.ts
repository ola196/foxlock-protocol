import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required for @stellar/stellar-sdk in the browser
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
    };
    return config;
  },
};

export default nextConfig;
