import type { NextConfig } from 'next'

/**
 * The app ships as a pure static SPA: `next build` writes `out/`, which is served straight from a
 * CDN with no server and no idle compute.
 *
 * Two public URLs are printed on physical things (the QR poster) or sent in a message, so they have
 * to stay clean: `/q/{queueId}` and `/t/{ticketToken}`. A static export cannot pre-render those ids,
 * so each is a single shell page that reads its id from the path at runtime. Production needs one
 * CDN rewrite per shell (see README); `next dev` gets the equivalent through the rewrites below.
 *
 * Staff URLs carry their ids in the query string instead - nobody prints those, and it keeps the
 * hosting configuration down to exactly two rules.
 */
const isDev = process.env.NODE_ENV === 'development'

const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  reactStrictMode: true,
  images: { unoptimized: true },

  ...(isDev
    ? {
        rewrites: async () => [
          { source: '/q/:queueId', destination: '/q' },
          { source: '/t/:ticketToken', destination: '/t' },
        ],
      }
    : {}),
}

export default nextConfig
