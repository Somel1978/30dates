/** @type {import('next').NextConfig} */
const apiOrigin = process.env.API_ORIGIN ?? 'http://localhost:4000';

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@thirtydates/shared'],
  // Same-origin API: the session cookie stays first-party and SameSite=Lax applies.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiOrigin}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          // Microphone for the voice exchange, location for onboarding; nothing else.
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=(self)' },
        ],
      },
    ];
  },
};

export default nextConfig;
