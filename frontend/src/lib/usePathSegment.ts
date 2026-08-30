'use client'

import { useEffect, useState } from 'react'

/**
 * Reads one segment of the current path on the client.
 *
 * `/q/{queueId}` and `/t/{ticketToken}` are served by a single exported shell page (see
 * `next.config.ts`), so the id cannot come from route params - it has to be read from the address
 * bar. Reading it after mount also keeps server and client markup identical, avoiding a hydration
 * mismatch.
 *
 * Returns `undefined` until it has been resolved, then the segment or `null` when absent.
 */
export function usePathSegment(index: number): string | null | undefined {
  const [segment, setSegment] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    const parts = window.location.pathname.split('/').filter(Boolean)
    setSegment(parts[index] ?? null)
  }, [index])

  return segment
}

/**
 * Reads a query parameter on the client.
 *
 * Deliberately not `useSearchParams`: that forces a Suspense boundary on every page under a static
 * export, and reading the address bar after mount does the same job with less ceremony.
 *
 * Returns `undefined` until resolved, then the value or `null` when absent.
 */
export function useQueryParam(name: string): string | null | undefined {
  const [value, setValue] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    setValue(new URLSearchParams(window.location.search).get(name))
  }, [name])

  return value
}
