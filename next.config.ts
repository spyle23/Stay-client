import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Conteneurisation : build autonome pour l'image Docker (Story 1.1, AC-1/AC-6)
  output: "standalone",
};

export default nextConfig;
