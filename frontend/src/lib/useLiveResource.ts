'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from './api'

interface Options<T> {
  /** SSE endpoint, or null to skip the stream and rely on polling alone. */
  url: string | null
  /** Named SSE event carrying the payload. */
  eventName: string
  /** Fetches the resource. Used for the first load and as the polling fallback. */
  load: (signal: AbortSignal) => Promise<T>
  /** How often to re-fetch while the stream is down. */
  pollMs?: number
  enabled?: boolean
}

interface LiveResource<T> {
  data: T | null
  error: ApiError | null
  /** True while the SSE connection is open, so the UI can be honest about how fresh it is. */
  live: boolean
  loading: boolean
  refresh: () => void
}

/**
 * Keeps one resource in sync with the server.
 *
 * The first read is a plain fetch rather than the stream, because `EventSource` cannot report a
 * status code - a missing ticket has to surface as "this ticket does not exist", not as a silent
 * connection failure. Once that succeeds the stream takes over and pushes every change.
 *
 * Polling is the safety net, not the mechanism: it only runs while the stream is down, so a proxy
 * that blocks `text/event-stream` degrades to a slightly slower app instead of a broken one.
 */
export function useLiveResource<T>({
  url,
  eventName,
  load,
  pollMs = 5000,
  enabled = true,
}: Options<T>): LiveResource<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [live, setLive] = useState(false)
  const [loading, setLoading] = useState(enabled)
  const [nonce, setNonce] = useState(0)

  const loadRef = useRef(load)
  loadRef.current = load

  const refresh = useCallback(() => setNonce((value) => value + 1), [])

  // Initial load, and any explicit refresh.
  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      return
    }
    const controller = new AbortController()
    let cancelled = false

    setLoading(true)
    loadRef
      .current(controller.signal)
      .then((value) => {
        if (cancelled) return
        setData(value)
        setError(null)
      })
      .catch((cause: unknown) => {
        if (cancelled || controller.signal.aborted) return
        setError(cause instanceof ApiError ? cause : new ApiError(0, 'UNKNOWN', 'Something went wrong.'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [enabled, nonce])

  // The stream.
  useEffect(() => {
    if (!enabled || !url) return

    const source = new EventSource(url)

    const onPayload = (event: MessageEvent<string>) => {
      try {
        setData(JSON.parse(event.data) as T)
        setError(null)
      } catch {
        // A malformed frame is not worth tearing the connection down for.
      }
    }

    source.addEventListener(eventName, onPayload as EventListener)
    source.onopen = () => setLive(true)
    source.onerror = () => setLive(false)

    return () => {
      source.removeEventListener(eventName, onPayload as EventListener)
      source.close()
      setLive(false)
    }
  }, [enabled, url, eventName])

  // Fallback polling, active only while the stream is not carrying updates.
  useEffect(() => {
    if (!enabled || live) return
    const timer = window.setInterval(() => {
      const controller = new AbortController()
      loadRef.current(controller.signal).then(
        (value) => {
          setData(value)
          setError(null)
        },
        () => {
          // Keep showing the last good state rather than blanking the screen on a blip.
        },
      )
    }, pollMs)

    return () => window.clearInterval(timer)
  }, [enabled, live, pollMs])

  return { data, error, live, loading, refresh }
}
