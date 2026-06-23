import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@hilihili/shared"],
  images: {
    unoptimized: true
  }
};

export default nextConfig;
