'use client'

/**
 * What the site needs to know about the infrastructure it runs on, read at runtime.
 *
 * The Cognito ids only exist after `terraform apply`, but the site is built before it - so they
 * cannot be baked into the bundle. Terraform writes them to `config.json` next to the site, and this
 * reads it once per page load. In development `next dev` proxies the same file from the deployed
 * site, so both read the same values.
 */
export interface RuntimeConfig {
  region: string
  userPoolId: string
  userPoolClientId: string
  /** The realtime WebSocket. Without it the live views fall back to polling. */
  websocketUrl?: string
}

let pending: Promise<RuntimeConfig> | null = null

export function loadRuntimeConfig(): Promise<RuntimeConfig> {
  pending ??= fetchConfig().catch((cause) => {
    // Let a later call try again instead of caching the failure for the life of the tab.
    pending = null
    throw cause
  })
  return pending
}

async function fetchConfig(): Promise<RuntimeConfig> {
  const response = await fetch(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/config.json`, { cache: 'no-store' })
  if (!response.ok) throw new Error(`config.json answered ${response.status}`)
  return (await response.json()) as RuntimeConfig
}
