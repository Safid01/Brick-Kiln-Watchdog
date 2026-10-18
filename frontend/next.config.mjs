/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  // Demo snapshot (alerts, receptors, evidence crops) is read from ./data at runtime;
  // tell the file tracer to ship it with the serverless functions.
  outputFileTracingIncludes: {
    "/api/v1/[...path]": ["./data/*.json"],
    "/evidence/[...path]": ["./data/evidence/*.jpg"],
  },
};

export default nextConfig;
