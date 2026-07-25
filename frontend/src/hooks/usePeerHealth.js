import { useState, useEffect } from 'react'
import { API_URL } from '../config'

// Polls /federation/peers/health while the consuming view is mounted and the
// browser tab is visible. Returns { [peerId]: { online, latency_ms } }.
export default function usePeerHealth(authHeaders, { intervalMs = 10000, enabled = true } = {}) {
  const [health, setHealth] = useState({})

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    const poll = async () => {
      if (document.hidden) return
      try {
        const res = await fetch(`${API_URL}/federation/peers/health`, { headers: authHeaders })
        if (!res.ok || cancelled) return
        const data = await res.json()
        if (!cancelled) setHealth(Object.fromEntries((data.peers || []).map(p => [p.id, p])))
      } catch { /* keep last known state */ }
    }

    poll()
    const timer = setInterval(poll, intervalMs)
    const onVisible = () => { if (!document.hidden) poll() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [authHeaders, intervalMs, enabled])

  return health
}
