import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["http://127.0.0.1:3000"],
};

export default nextConfig;
