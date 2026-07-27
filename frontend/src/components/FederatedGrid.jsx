import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { CircleNotch, Globe, ShareNetwork, EyeSlash } from '@phosphor-icons/react'
import { API_URL, UPLOADS_URL } from '../config'
import PhotoViewer from './PhotoViewer'
import usePeerHealth from '../hooks/usePeerHealth'

const PAGE_SIZE = 50

function useColumnCount(gridSize = 'comfortable') {
  const maxCols = { compact: 5, comfortable: 4, large: 3 }[gridSize] || 4
  const [cols, setCols] = useState(() => {
    const w = window.innerWidth
    if (w < 640) return 2
    if (w < 1024) return Math.min(maxCols, 3)
    return maxCols
  })
  useEffect(() => {
    const update = () => {
      const w = window.innerWidth
      if (w < 640) setCols(2)
      else if (w < 1024) setCols(Math.min(maxCols, 3))
      else setCols(maxCols)
    }
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [maxCols])
  return cols
}

function formatDuration(sec) {
  if (!sec || !isFinite(sec)) return null
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

// Grid card with the same viewport-gated video preview behavior as ImageCard —
// remote video previews stream from the peer, so only play while visible.
function FederatedCard({ image, onClick, blurNsfw = false }) {
  const ref = useRef(null)
  const videoRef = useRef(null)
  const [inViewport, setInViewport] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [nsfwRevealed, setNsfwRevealed] = useState(false)
  const hideNsfw = blurNsfw && !!image.is_nsfw && !nsfwRevealed

  const isVideo = image.media_type === 'video'
  const aspectRatio = image.width && image.height ? image.width / image.height : 1
  const thumbSrc = image.thumbnail_cached && image.thumbnail_path
    ? `${UPLOADS_URL}/${image.thumbnail_path}`
    : image.thumb_url || null
  const videoSrc = image.preview_url || image.full_url
  const duration = isVideo ? formatDuration(image.duration) : null

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => setInViewport(entry.isIntersecting),
      { rootMargin: '100px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (inViewport) video.play().catch(() => {})
    else video.pause()
  }, [inViewport])

  return (
    <div
      ref={ref}
      className="group relative rounded-2xl overflow-hidden cursor-pointer transition-all duration-300 ease-out hover:scale-[1.02] hover:shadow-2xl hover:shadow-black/40"
      onClick={() => hideNsfw ? setNsfwRevealed(true) : onClick(image)}
    >
      <div className="relative" style={{ paddingBottom: `${(1 / aspectRatio) * 100}%` }}>
        {hideNsfw && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-1.5 bg-black/40 backdrop-blur-2xl">
            <EyeSlash className="w-5 h-5 text-white/70" />
            <span className="text-[11px] font-medium text-white/80">NSFW — click to view</span>
          </div>
        )}
        {isVideo && videoSrc ? (
          <>
            {/* Poster — visible until the preview stream is ready */}
            {thumbSrc && (
              <img
                src={thumbSrc}
                alt=""
                className={`absolute inset-0 w-full h-full object-cover ${loaded ? 'opacity-0' : 'opacity-100'} transition-opacity duration-300`}
              />
            )}
            {inViewport && (
              <video
                ref={videoRef}
                src={videoSrc}
                loop
                muted
                playsInline
                preload="none"
                onLoadedData={() => setLoaded(true)}
                className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${loaded ? 'opacity-100' : 'opacity-0'}`}
              />
            )}
          </>
        ) : thumbSrc ? (
          <img
            src={thumbSrc}
            alt={image.title}
            className="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 bg-bg-card flex items-center justify-center">
            <Globe className="w-8 h-8 text-text-muted/30" />
          </div>
        )}

        {/* Instance badge */}
        <div className="absolute top-2 left-2 z-10 px-2 py-0.5 bg-black/60 backdrop-blur-md rounded-full flex items-center gap-1">
          <ShareNetwork className="w-2.5 h-2.5 text-white/70" />
          <span className="text-[10px] font-medium text-white/80">{image.peer_name}</span>
        </div>

        {/* Video duration badge — hidden on hover so it never overlaps overlay text */}
        {duration && (
          <div className="absolute bottom-2 right-2 z-10 px-1.5 py-0.5 bg-black/60 backdrop-blur-md rounded-md group-hover:opacity-0 transition-opacity duration-200">
            <span className="text-[10px] font-medium text-white/90">{duration}</span>
          </div>
        )}

        {/* Hover overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-4">
          <h3 className="text-[14px] font-medium text-white truncate">{image.title}</h3>
          {image.caption && (
            <p className="text-[11px] text-white/60 truncate mt-0.5">{image.caption}</p>
          )}
          <div className="flex items-center gap-2 mt-1">
            {image.uploaded_by && <span className="text-[11px] text-white/50">by {image.uploaded_by}</span>}
            {image.width && image.height && <span className="text-[11px] text-white/40 ml-auto">{image.width}x{image.height}</span>}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function FederatedGrid({ gridSize = 'comfortable', authHeaders = {}, blurNsfw = false }) {
  const [images, setImages] = useState([])
  const [peers, setPeers] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [selectedPeer, setSelectedPeer] = useState(null)
  const [selectedImage, setSelectedImage] = useState(null)
  const peerHealth = usePeerHealth(authHeaders)

  const fetchImages = useCallback(async (offset = 0, append = false) => {
    if (!append) setLoading(true)
    else setLoadingMore(true)
    try {
      const params = new URLSearchParams({ limit: PAGE_SIZE, offset })
      if (selectedPeer) params.set('peer', selectedPeer)
      const res = await fetch(`${API_URL}/federation/feed?${params}`, { headers: authHeaders })
      if (res.ok) {
        const data = await res.json()
        setImages(prev => append ? [...prev, ...data.images] : data.images)
        setTotal(data.total)
      }
    } catch {}
    setLoading(false)
    setLoadingMore(false)
  }, [selectedPeer, authHeaders])

  const fetchPeers = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/federation/peers`, { headers: authHeaders })
      if (res.ok) {
        const data = await res.json()
        setPeers(data.peers || [])
      }
    } catch {}
  }, [authHeaders])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- standard data-fetch on mount
  useEffect(() => { fetchPeers() }, [fetchPeers])
  // eslint-disable-next-line react-hooks/set-state-in-effect -- reset-and-refetch when filters change
  useEffect(() => { setImages([]); fetchImages(0) }, [fetchImages])

  const columnCount = useColumnCount(gridSize)

  const columns = useMemo(() => {
    const cols = Array.from({ length: columnCount }, () => ({ items: [], height: 0 }))
    images.forEach(image => {
      let shortest = 0
      for (let i = 1; i < cols.length; i++) {
        if (cols[i].height < cols[shortest].height) shortest = i
      }
      cols[shortest].items.push(image)
      const aspect = image.width && image.height ? image.height / image.width : 1
      cols[shortest].height += aspect
    })
    return cols
  }, [images, columnCount])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <CircleNotch className="w-6 h-6 animate-spin text-text-muted" />
      </div>
    )
  }

  if (images.length === 0 && peers.length === 0) {
    return (
      <div className="text-center py-20">
        <ShareNetwork className="w-12 h-12 text-text-muted/30 mx-auto mb-4" />
        <p className="text-[16px] font-semibold text-text mb-1">No Network Peers</p>
        <p className="text-[13px] text-text-muted">Add peers in Admin Settings to see federated content here.</p>
      </div>
    )
  }

  if (images.length === 0) {
    return (
      <div className="text-center py-20">
        <Globe className="w-12 h-12 text-text-muted/30 mx-auto mb-4" />
        <p className="text-[16px] font-semibold text-text mb-1">No Images Yet</p>
        <p className="text-[13px] text-text-muted">Waiting for peers to sync. Try a manual sync in Admin Settings.</p>
      </div>
    )
  }

  return (
    <div>
      {/* Peer filter */}
      {peers.length > 0 && (
        <div className="flex items-center gap-2 mb-4 overflow-x-auto">
          <button
            onClick={() => setSelectedPeer(null)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-[12px] font-medium transition-all duration-200
              ${!selectedPeer ? 'bg-accent text-white' : 'bg-white/[0.06] text-text-secondary hover:text-text'}`}
          >
            All Peers
          </button>
          {peers.map(peer => (
            <button
              key={peer.id}
              onClick={() => setSelectedPeer(selectedPeer === peer.id ? null : peer.id)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-[12px] font-medium transition-all duration-200 flex items-center gap-1.5
                ${selectedPeer === peer.id ? 'bg-accent text-white' : 'bg-white/[0.06] text-text-secondary hover:text-text'}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${peerHealth[peer.id] ? (peerHealth[peer.id].online ? 'bg-green' : 'bg-red') : (peer.status === 'active' ? 'bg-green' : 'bg-red')}`} />
              {peer.name}
              <span className="opacity-60">{peer.image_count}</span>
            </button>
          ))}
        </div>
      )}

      {/* Image grid */}
      <div className="flex gap-4">
        {columns.map((col, colIdx) => (
          <div key={colIdx} className="flex-1 flex flex-col gap-4">
            {col.items.map(image => (
              <FederatedCard
                key={`${image.peer_id}-${image.remote_id}`}
                image={image}
                onClick={setSelectedImage}
                blurNsfw={blurNsfw}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Load more */}
      {images.length < total && (
        <div className="flex justify-center py-8">
          <button
            onClick={() => fetchImages(images.length, true)}
            disabled={loadingMore}
            className="px-4 py-2 rounded-xl text-[13px] font-medium text-accent hover:bg-accent/10 transition-all duration-200"
          >
            {loadingMore ? <CircleNotch className="w-4 h-4 animate-spin" /> : `Load More (${total - images.length} remaining)`}
          </button>
        </div>
      )}

      {/* Shared viewer — full-res direct from peer, videos playable */}
      {selectedImage && (
        <PhotoViewer
          image={selectedImage}
          images={images}
          onClose={() => setSelectedImage(null)}
          onNavigate={setSelectedImage}
        />
      )}
    </div>
  )
}
