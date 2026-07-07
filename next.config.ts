import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "1mb"
    }
  },
  webpack: (config) => {
    config.watchOptions = {
      ...config.watchOptions,
      ignored: [
        "**/.git/**",
        "**/.next/**",
        "**/node_modules/**",
        "**/AIDEVS_project_templates/**",
        "**/theory/**"
      ]
    };

    return config;
  }
};

export default nextConfig;
