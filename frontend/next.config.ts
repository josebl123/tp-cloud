import type { NextConfig } from 'next'
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants'

/**
 * The app ships as a pure static SPA: `next build` writes `out/`, which is served straight from an
 * S3 bucket with no server and no idle compute.
 *
 * Every id travels in the query string - `/q/?id={queueId}`, `/t/?token={ticketToken}`, and the
 * staff pages under `/panel`. A path segment would read better on the printed QR poster, but a
 * static export cannot pre-render those ids, so each shell would need a rewrite rule in whatever
 * serves the site. Only a CDN can express that; plain static hosting on S3 cannot, and this
 * deployment has no CDN available. The query string costs nothing and keeps the hosting
 * configuration down to zero rules.
 */
/**
 * Where the site lives under its host. Empty in development; `/prod` when API Gateway serves it,
 * because a REST API puts the stage name at the start of every path. Next prefixes every link,
 * asset and router call with it - code that builds a URL by hand has to read the same variable.
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? ''

const nextConfig: NextConfig = {
  output: 'export',
  basePath,
  trailingSlash: true,
  reactStrictMode: true,
  images: { unoptimized: true },
}

/**
 * There is no local API: `next dev` runs against the one deployed in the lab. The deployed API
 * answers only its own origin (it serves the site, so it needs no CORS), so the browser cannot call
 * it from localhost. Instead the dev server proxies the API and `config.json` from the deployed
 * site, and the browser only ever talks to localhost - the same shape as in production.
 *
 * `DEV_API_URL` is the `site_url` output of Terraform, in `.env.local`. Only `next dev` reads it;
 * `next build` gets the plain config above.
 */
function developmentConfig(): NextConfig {
  const deployed = process.env.DEV_API_URL?.replace(/\/$/, '')
  if (!deployed) {
    throw new Error('Set DEV_API_URL in frontend/.env.local to the site_url output of Terraform (see .env.example).')
  }
  return {
    ...nextConfig,
    // With `trailingSlash`, Next would answer `/api/v1/health` with a redirect to `/api/v1/health/`,
    // a path the API does not have.
    skipTrailingSlashRedirect: true,
    rewrites: async () => [
      { source: '/api/v1/:path*', destination: `${deployed}/api/v1/:path*` },
      { source: '/config.json', destination: `${deployed}/config.json` },
    ],
  }
}

export default function config(phase: string): NextConfig {
  return phase === PHASE_DEVELOPMENT_SERVER ? developmentConfig() : nextConfig
}
