import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The pipeline templates are read from disk at request time, so nothing
  // static analysis can see tells the build they are needed. Without this they
  // are left out of the deployment and the download 500s in production only --
  // which is the worst place to find out.
  outputFileTracingIncludes: {
    "/ci/[...file]": ["./templates/**/*"],
  },
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
