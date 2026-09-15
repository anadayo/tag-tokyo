import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  output: "export",
  basePath: isProduction ? "/tag-tokyo" : "",
  assetPrefix: isProduction ? "/tag-tokyo/" : "",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
