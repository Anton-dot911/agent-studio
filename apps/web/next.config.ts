import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  transpilePackages: ["@coinbase/onchainkit"],
  turbopack: {
    root: path.join(__dirname, "..", ".."),
  },
};

export default nextConfig;

