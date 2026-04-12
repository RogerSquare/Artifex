import { useState, useRef, useEffect } from 'react'
import { Sparkle, Lock, Heart, ChatCircle, ShareNetwork } from '@phosphor-icons/react'
import { UPLOADS_URL } from '../config'

export default function ImageCard({ image, onClick, selectable, selected, onToggleSelect, onToggleFavorite, onContextMenu, currentUserId }) {
  const isRemote = !!image.is_remote;
  const isOwner = !isRemote && (!currentUserId || image.user_id === currentUserId);
  const canSelect = selectable && isOwner;
  const [loaded, setLoaded] = useState(false)
  const [inViewport, setInViewport] = useState(false)
  const ref = useRef(null)
  const videoRef = useRef(null)

  const isVideo = image.media_type === 'video'
  const thumbSrc = image.thumbnail_path ? `${UPLOADS_URL}/${image.thumbnail_path}` : null
  const videoSrc = `${UPLOADS_URL}/${image.preview_path || image.filepath}`
  const aspectRatio = image.width && image.height ? image.width / image.height : 1

  // Continuous viewport tracking — play when visible, pause when not
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

  // Control video playback based on viewport
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (inViewport) {
      video.play().catch(() => {})
    } else {
      video.pause()
    }
  }, [inViewport])

  return (
    <div
      ref={ref}
      onClick={canSelect ? () => onToggleSelect?.(image.id) : selectable && !isOwner ? undefined : () => onClick(image)}
      onContextMenu={(e) => { if (onContextMenu) { e.preventDefault(); onContextMenu(e, image) } }}
      className={`group relative rounded-2xl overflow-hidden transition-all duration-300 ease-out
        ${selectable && !isOwner ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        ${selected ? 'ring-2 ring-accent ring-offset-2 ring-offset-bg scale-[0.98]' : selectable && !isOwner ? '' : 'hover:scale-[1.02] hover:shadow-2xl hover:shadow-black/40'}`}
    >
      <div className="relative" style={{ paddingBottom: `${(1 / aspectRatio) * 100}%` }}>
        {/* Video: show poster thumbnail, overlay <video> when in viewport */}
        {isVideo ? (
          <>
            {/* Static poster — always rendered, visible until video loads */}
            {thumbSrc && (
              <img
                src={thumbSrc}
                alt=""
                className={`absolute inset-0 w-full h-full object-cover ${loaded ? 'opacity-0' : 'opacity-100'} transition-opacity duration-300`}
              />
            )}
            {/* Video — only mounts when near viewport, plays when visible */}
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
        ) : (
          /* Image: lazy load as before */
          inViewport && (
            <img
              src={thumbSrc}
              alt={image.title || image.original_name}
              onLoad={() => setLoaded(true)}
              className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${loaded ? 'opacity-100' : 'opacity-0'}`}
            />
          )
        )}

        {/* Skeleton */}
        {!loaded && (
          <div className="absolute inset-0 bg-bg-card animate-pulse rounded-2xl" />
        )}

        {/* Peer badge for federated images */}
        {isRemote && image.peer_name && (
          <div className="absolute top-3 left-3 z-10 px-2 py-0.5 bg-black/60 backdrop-blur-md rounded-full flex items-center gap-1">
            <ShareNetwork className="w-2.5 h-2.5 text-white/70" />
            <span className="text-[10px] font-medium text-white/80">{image.peer_name}</span>
          </div>
        )}

        {/* Favorite heart — only rendered when handler is provided and not remote */}
        {!selectable && !isRemote && onToggleFavorite && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleFavorite?.(image.id) }}
            className={`absolute top-3 right-3 z-10 w-8 h-8 rounded-full flex items-center justify-center transition-all duration-200
              ${image.is_favorited ? 'bg-red/20 backdrop-blur-md text-red scale-100' : 'bg-black/30 backdrop-blur-md text-white/60 opacity-0 group-hover:opacity-100 hover:text-red hover:bg-red/20'}`}
          >
            <Heart className="w-4 h-4" weight={image.is_favorited ? 'fill' : 'regular'} />
          </button>
        )}

        {/* Video duration badge */}
        {isVideo && image.duration && (
          <div className="absolute bottom-3 left-3 z-10 px-1.5 py-0.5 bg-black/60 backdrop-blur-md rounded-md transition-opacity duration-300 group-hover:opacity-0">
            <span className="text-[11px] font-medium text-white tabular-nums">
              {Math.floor(image.duration / 60)}:{String(Math.floor(image.duration % 60)).padStart(2, '0')}
            </span>
          </div>
        )}

        {/* Private badge */}
        {image.visibility === 'private' && (
          <div className="absolute top-3 left-3 z-10 w-7 h-7 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center">
            <Lock className="w-3.5 h-3.5 text-white/70" />
          </div>
        )}

        {/* Hover overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-4">
          <h3 className="text-[14px] font-medium text-white truncate leading-snug">
            {image.title || image.original_name}
          </h3>
          <div className="flex items-center gap-2 mt-1">
            {image.model && (
              <span className="text-[11px] text-white/60 truncate max-w-[140px]">{image.model}</span>
            )}
            {image.has_metadata && (
              <Sparkle className="w-3 h-3 text-accent shrink-0" />
            )}
            {image.comment_count > 0 && (
              <span className="flex items-center gap-0.5 text-[11px] text-white/50">
                <ChatCircle className="w-3 h-3" />{image.comment_count}
              </span>
            )}
            <span className="text-[11px] text-white/40 ml-auto">{image.width}x{image.height}</span>
          </div>
        </div>

        {/* Selection checkmark — bottom right (only on owned images) */}
        {canSelect && (
          <div className="absolute bottom-3 right-3 z-10">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center transition-all duration-200 shadow-sm
              ${selected ? 'bg-accent' : 'bg-black/30 backdrop-blur-md border-2 border-white/40'}`}
            >
              {selected && (
                <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
