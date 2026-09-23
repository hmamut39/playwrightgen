import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // Coverage Review lived at /intelligence, which named the machinery
      // rather than the job. The old address keeps working for anyone who
      // linked or bookmarked it.
      { source: "/intelligence", destination: "/coverage-review", permanent: true },
    ];
  },
};

export default nextConfig;
