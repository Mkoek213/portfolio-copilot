import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfjs-dist ships a worker script it dynamically imports at runtime. Webpack's server
  // bundle doesn't emit that file at the path the fallback ("fake") worker expects, so it
  // must run un-bundled from node_modules instead, where the worker script actually lives.
  serverExternalPackages: ["pdfjs-dist"],
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
