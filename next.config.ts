import type { NextConfig } from "next";
import { securityHeaders } from "./src/lib/security/headers";

const nextConfig: NextConfig = {
  // No "X-Powered-By: Next.js": it tells a visitor nothing useful and an attacker what to try.
  poweredByHeader: false,
  // Polaris shows no images through next/image, so the image optimizer (/_next/image, which
  // decodes and resizes images on request with sharp) is turned off rather than left exposed.
  images: { unoptimized: true },
  // The static security headers, on every response. The per-request Content-Security-Policy
  // for pages is set in src/middleware.ts, which can give each response its own nonce.
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders() }];
  },
};

export default nextConfig;
