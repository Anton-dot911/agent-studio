import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@agent-studio/agents", "@agent-studio/tools"],
};

export default nextConfig;
