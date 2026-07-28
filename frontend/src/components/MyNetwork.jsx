import { useState, useEffect, useCallback } from 'react'
import { ArrowLeft, Plus, Trash, CircleNotch, ArrowClockwise, ShareNetwork } from '@phosphor-icons/react'
import { API_URL } from '../config'
import { useAuth } from '../context/AuthContext'
import usePeerHealth from '../hooks/usePeerHealth'

const MAX_PERSONAL_PEERS = 10

// Personal peer management — every user keeps their own peer list alongside
// the instance-wide (admin) one. Personal peers feed only this user's views.
export default function MyNetwork({ onBack }) {
  const { user, authHeaders } = useAuth()
  const [peers, setPeers] = useState([])
  const [newPeerUrl, setNewPeerUrl] = useState('')
  const [adding, setAdding] = useState(false)
  const [syncing, setSyncing] = useState({})
  const [error, setError] = useState('')
  const [discovery, setDiscovery] = useState(null) // null=loading, {instances,directory_url} or {error}
  const [discoveryAdding, setDiscoveryAdding] = useState({})
  const peerHealth = usePeerHealth(authHeaders)

  const fetchPeers = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/federation/peers`, { headers: authHeaders })
      if (res.ok) { const d = await res.json(); setPeers(d.peers || []) }
    } catch { /* ignore */ }
  }, [authHeaders])

  const fetchDiscovery = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/federation/discovery`, { headers: authHeaders })
      const data = await res.json()
      setDiscovery(res.ok ? data : { error: data.error || `HTTP ${res.status}` })
    } catch { setDiscovery({ error: 'Failed to reach the server' }) }
  }, [authHeaders])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- standard data-fetch on mount
  useEffect(() => { fetchPeers(); fetchDiscovery() }, [fetchPeers, fetchDiscovery])

  const addFromDiscovery = async (inst, scope) => {
    const key = `${scope}:${inst.instance_id}`
    setDiscoveryAdding(prev => ({ ...prev, [key]: true }))
    try {
      const route = scope === 'global' ? 'peers' : 'my-peers'
      await fetch(`${API_URL}/federation/${route}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ url: inst.url })
      })
      await Promise.all([fetchPeers(), fetchDiscovery()])
    } catch { /* surfaced by refreshed state */ }
    setDiscoveryAdding(prev => ({ ...prev, [key]: false }))
  }

  const addPeer = async () => {
    if (!newPeerUrl.trim()) return
    setAdding(true); setError('')
    try {
      const res = await fetch(`${API_URL}/federation/my-peers`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ url: newPeerUrl.trim() })
      })
      const data = await res.json()
      if (!res.ok) setError(data.error)
      else { setNewPeerUrl(''); fetchPeers() }
    } catch { setError('Failed to connect') }
    setAdding(false)
  }

  const removePeer = async (id) => {
    if (!window.confirm('Remove this peer? Anything of theirs you saved to collections goes with it.')) return
    await fetch(`${API_URL}/federation/peers/${id}`, { method: 'DELETE', headers: authHeaders })
    fetchPeers()
  }

  const syncPeer = async (id) => {
    setSyncing(prev => ({ ...prev, [id]: true }))
    await fetch(`${API_URL}/federation/peers/${id}/sync`, { method: 'POST', headers: authHeaders })
    setSyncing(prev => ({ ...prev, [id]: false }))
    fetchPeers()
  }

  const setPeerMode = async (id, mode) => {
    await fetch(`${API_URL}/federation/peers/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ mode })
    })
    fetchPeers()
  }

  const mine = peers.filter(p => p.scope === 'mine')
  const globals = peers.filter(p => p.scope === 'global')

  const dotFor = (peer) => {
    const live = peerHealth[peer.id]
    if (live) return live.online ? 'bg-green' : 'bg-red'
    return peer.status === 'active' ? 'bg-green' : peer.status === 'error' ? 'bg-red' : 'bg-yellow'
  }

  return (
    <div className="min-h-screen bg-bg text-text">
      <div className="max-w-2xl mx-auto px-5 py-6">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={onBack} className="p-1.5 rounded-md text-text-secondary hover:text-text hover:bg-white/[0.06] transition-all">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h1 className="text-[17px] font-semibold">My Network</h1>
        </div>

        {/* Personal peers */}
        <div className="bg-bg-card rounded-2xl p-5 mb-6">
          <h3 className="text-[12px] font-semibold text-text-muted uppercase tracking-wide mb-1">My Peers ({mine.length}/{MAX_PERSONAL_PEERS})</h3>
          <p className="text-[12px] text-text-muted mb-4">Instances you follow personally — their public images appear only in your feeds.</p>

          <div className="flex items-center gap-2 mb-4">
            <input
              type="text" value={newPeerUrl} onChange={e => setNewPeerUrl(e.target.value)}
              placeholder="https://another-gallery.example.com"
              className="flex-1 h-8 bg-bg-elevated rounded-lg px-3 text-[13px] text-text placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/30"
              onKeyDown={e => e.key === 'Enter' && addPeer()}
            />
            <button onClick={addPeer} disabled={adding || !newPeerUrl.trim() || mine.length >= MAX_PERSONAL_PEERS} className="h-8 px-3 bg-accent text-white rounded-lg text-[12px] font-semibold hover:bg-accent-hover disabled:opacity-40 transition-all flex items-center gap-1">
              {adding ? <CircleNotch className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Add
            </button>
          </div>
          {error && <p className="text-[12px] text-red mb-3">{error}</p>}

          {mine.length === 0 ? (
            <div className="text-center py-6">
              <ShareNetwork className="w-8 h-8 text-text-muted/30 mx-auto mb-2" />
              <p className="text-[13px] text-text-muted">No personal peers yet</p>
              <p className="text-[11px] text-text-muted/60 mt-0.5">Add another Artifex instance URL above</p>
            </div>
          ) : (
            <div className="space-y-2">
              {mine.map(peer => (
                <div key={peer.id} className="flex items-center gap-3 p-3 bg-bg-elevated rounded-xl">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${dotFor(peer)}`} title={peerHealth[peer.id] ? (peerHealth[peer.id].online ? `Online (${peerHealth[peer.id].latency_ms}ms)` : 'Offline') : 'Status from last sync'} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-text truncate">{peer.name}</span>
                      <span className="text-[11px] text-text-muted">{peer.image_count} images</span>
                      {peerHealth[peer.id] && !peerHealth[peer.id].online && <span className="text-[10px] font-medium text-red">offline</span>}
                    </div>
                    <p className="text-[11px] text-text-muted/60 truncate">{peer.url}</p>
                    {peer.mode === 'live'
                      ? <p className="text-[10px] text-text-muted/40">Live — pulled from peer on demand, nothing cached</p>
                      : peer.last_synced_at && <p className="text-[10px] text-text-muted/40">Last sync: {new Date(peer.last_synced_at).toLocaleString()}</p>}
                  </div>
                  <button
                    onClick={() => setPeerMode(peer.id, peer.mode === 'live' ? 'synced' : 'live')}
                    className={`shrink-0 px-2 py-1 rounded-md text-[11px] font-semibold transition-all ${peer.mode === 'live' ? 'bg-accent/15 text-accent' : 'bg-white/[0.06] text-text-muted hover:text-text'}`}
                    title={peer.mode === 'live' ? 'Pulling live from peer — click to sync & cache locally' : 'Caching locally — click to pull live (removes cached copies)'}
                  >
                    {peer.mode === 'live' ? 'Live' : 'Cached'}
                  </button>
                  {peer.mode !== 'live' && (
                    <button onClick={() => syncPeer(peer.id)} disabled={syncing[peer.id]} className="p-1.5 rounded-md text-text-muted hover:text-accent hover:bg-accent/10 transition-all" title="Sync now">
                      {syncing[peer.id] ? <CircleNotch className="w-4 h-4 animate-spin" /> : <ArrowClockwise className="w-4 h-4" />}
                    </button>
                  )}
                  <button onClick={() => removePeer(peer.id)} className="p-1.5 rounded-md text-text-muted hover:text-red hover:bg-red/10 transition-all" title="Remove">
                    <Trash className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Discovery — browse the public directory */}
        <div className="bg-bg-card rounded-2xl p-5 mb-6">
          <h3 className="text-[12px] font-semibold text-text-muted uppercase tracking-wide mb-1">Discovery</h3>
          <p className="text-[12px] text-text-muted mb-4">Instances listed on the public directory — add one to follow it.</p>
          {discovery === null ? (
            <div className="flex justify-center py-4"><CircleNotch className="w-4 h-4 animate-spin text-text-muted" /></div>
          ) : discovery.error ? (
            <p className="text-[12px] text-red text-center py-3">{discovery.error}</p>
          ) : !discovery.directory_url ? (
            <p className="text-[13px] text-text-muted text-center py-3">No directory configured{user?.role === 'admin' ? ' — set one in Admin → Federation → Discovery' : ' on this instance yet'}</p>
          ) : discovery.instances.length === 0 ? (
            <p className="text-[13px] text-text-muted text-center py-3">No instances listed yet</p>
          ) : (
            <div className="space-y-2">
              {discovery.instances.map(inst => (
                <div key={inst.instance_id} className="flex items-center gap-3 p-3 bg-bg-elevated rounded-xl">
                  <ShareNetwork className="w-4 h-4 text-text-muted shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-text truncate">{inst.name}</span>
                      <span className="text-[11px] text-text-muted">{inst.public_images} images · {inst.users} users</span>
                    </div>
                    {inst.description && <p className="text-[11px] text-text-muted truncate">{inst.description}</p>}
                    <p className="text-[11px] text-text-muted/60 truncate">{inst.url}</p>
                  </div>
                  {inst.added_mine ? (
                    <span className="text-[11px] font-medium text-green shrink-0">In your list</span>
                  ) : (
                    <button onClick={() => addFromDiscovery(inst, 'mine')} disabled={discoveryAdding[`mine:${inst.instance_id}`] || mine.length >= MAX_PERSONAL_PEERS} className="shrink-0 h-7 px-2.5 bg-accent text-white rounded-lg text-[11px] font-semibold hover:bg-accent-hover disabled:opacity-40 transition-all flex items-center gap-1">
                      {discoveryAdding[`mine:${inst.instance_id}`] ? <CircleNotch className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Add
                    </button>
                  )}
                  {user?.role === 'admin' && (
                    inst.added_global ? (
                      <span className="text-[11px] font-medium text-text-muted shrink-0">Instance-wide</span>
                    ) : (
                      <button onClick={() => addFromDiscovery(inst, 'global')} disabled={discoveryAdding[`global:${inst.instance_id}`]} className="shrink-0 h-7 px-2.5 bg-white/[0.06] text-text-secondary hover:text-text rounded-lg text-[11px] font-semibold disabled:opacity-40 transition-all">
                        {discoveryAdding[`global:${inst.instance_id}`] ? <CircleNotch className="w-3 h-3 animate-spin" /> : 'Add for everyone'}
                      </button>
                    )
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Instance-wide peers (read-only here) */}
        <div className="bg-bg-card rounded-2xl p-5">
          <h3 className="text-[12px] font-semibold text-text-muted uppercase tracking-wide mb-1">Instance Peers ({globals.length})</h3>
          <p className="text-[12px] text-text-muted mb-4">Followed by this whole instance — everyone sees their content. Managed by admins.</p>
          {globals.length === 0 ? (
            <p className="text-[13px] text-text-muted text-center py-4">This instance follows no peers</p>
          ) : (
            <div className="space-y-2">
              {globals.map(peer => (
                <div key={peer.id} className="flex items-center gap-3 p-3 bg-bg-elevated rounded-xl">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${dotFor(peer)}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-text truncate">{peer.name}</span>
                      <span className="text-[11px] text-text-muted">{peer.image_count} images</span>
                    </div>
                    <p className="text-[11px] text-text-muted/60 truncate">{peer.url}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
