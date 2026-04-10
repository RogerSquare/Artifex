import { useState, useEffect, useCallback, useMemo } from 'react'
import { CircleNotch, Globe, ShareNetwork } from '@phosphor-icons/react'
import { API_URL, UPLOADS_URL } from '../config'

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

export default function FederatedGrid({ gridSize = 'comfortable', authHeaders = {} }) {
  const [images, setImages] = useState([])
  const [peers, setPeers] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [selectedPeer, setSelectedPeer] = useState(null)
  const [selectedImage, setSelectedImage] = useState(null)

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
    } catch (e) {}
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
    } catch (e) {}
  }, [authHeaders])

  useEffect(() => { fetchPeers() }, [fetchPeers])
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
              <span className={`w-1.5 h-1.5 rounded-full ${peer.status === 'active' ? 'bg-green' : 'bg-red'}`} />
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
            {col.items.map(image => {
              const aspectRatio = image.width && image.height ? image.width / image.height : 1
              const thumbSrc = image.thumbnail_cached && image.thumbnail_path
                ? `${UPLOADS_URL}/${image.thumbnail_path}`
                : null

              return (
                <div
                  key={`${image.peer_id}-${image.remote_id}`}
                  className="group relative rounded-2xl overflow-hidden cursor-pointer transition-all duration-300 ease-out hover:scale-[1.02] hover:shadow-2xl hover:shadow-black/40"
                  onClick={() => setSelectedImage(selectedImage?.remote_id === image.remote_id ? null : image)}
                >
                  <div className="relative" style={{ paddingBottom: `${(1 / aspectRatio) * 100}%` }}>
                    {thumbSrc ? (
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
            })}
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

      {/* Selected image detail */}
      {selectedImage && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setSelectedImage(null)}>
          <div className="bg-bg-card rounded-2xl shadow-2xl shadow-black/50 w-full max-w-lg max-h-[80vh] overflow-y-auto border border-white/[0.06]" onClick={e => e.stopPropagation()}>
            {/* Thumbnail */}
            {selectedImage.thumbnail_cached && selectedImage.thumbnail_path && (
              <img src={`${UPLOADS_URL}/${selectedImage.thumbnail_path}`} alt="" className="w-full rounded-t-2xl" />
            )}
            <div className="p-5 space-y-3">
              <div className="flex items-center gap-2">
                <ShareNetwork className="w-4 h-4 text-accent" />
                <span className="text-[12px] font-medium text-accent">{selectedImage.peer_name}</span>
              </div>
              <h2 className="text-[18px] font-bold text-text">{selectedImage.title}</h2>
              {selectedImage.caption && (
                <p className="text-[14px] text-text-secondary italic">{selectedImage.caption}</p>
              )}
              {/* Tags */}
              {selectedImage.tags?.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {selectedImage.tags.map((tag, i) => (
                    <span key={i} className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-white/[0.06] text-text-secondary">
                      {tag.name}
                    </span>
                  ))}
                </div>
              )}
              {/* Metadata */}
              {selectedImage.metadata && (
                <div className="bg-bg-elevated rounded-xl divide-y divide-white/[0.04]">
                  {Object.entries(selectedImage.metadata).filter(([,v]) => v).map(([k,v]) => (
                    <div key={k} className="flex items-center justify-between px-3 py-2">
                      <span className="text-[12px] text-text-muted capitalize">{k.replace('_',' ')}</span>
                      <span className="text-[12px] text-text truncate max-w-[200px]">{String(v)}</span>
                    </div>
                  ))}
                </div>
              )}
              {selectedImage.uploaded_by && (
                <p className="text-[12px] text-text-muted">Uploaded by {selectedImage.uploaded_by}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
