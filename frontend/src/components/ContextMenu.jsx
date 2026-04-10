import { useEffect, useRef } from 'react'
import { Eye, Heart, Copy, DownloadSimple, Globe, Lock, Trash, FolderPlus, ShareNetwork } from '@phosphor-icons/react'
import { UPLOADS_URL } from '../config'

export default function ContextMenu({ x, y, image, onClose, onOpen, onFavorite, onCopyPrompt, onDownload, onToggleVisibility, onDelete, onAddToCollection, onShare, isOwner }) {
  const menuRef = useRef(null)

  // Position adjustment to stay in viewport
  useEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const rect = menu.getBoundingClientRect()
    if (rect.right > window.innerWidth) menu.style.left = `${x - rect.width}px`
    if (rect.bottom > window.innerHeight) menu.style.top = `${y - rect.height}px`
  }, [x, y])

  // Close on Escape, scroll, or outside click
  useEffect(() => {
    const handleClose = (e) => {
      if (e.type === 'keydown' && e.key !== 'Escape') return
      onClose()
    }
    window.addEventListener('keydown', handleClose)
    window.addEventListener('scroll', onClose, true)
    window.addEventListener('mousedown', (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose()
    })
    return () => {
      window.removeEventListener('keydown', handleClose)
      window.removeEventListener('scroll', onClose, true)
    }
  }, [onClose])

  const items = [
    { label: 'Open', icon: Eye, onClick: onOpen },
    { divider: true },
    { label: image.is_favorited ? 'Unfavorite' : 'Favorite', icon: Heart, onClick: onFavorite, accent: image.is_favorited },
    onAddToCollection ? { label: 'Add to Collection', icon: FolderPlus, onClick: onAddToCollection } : null,
    image.prompt ? { label: 'Copy Prompt', icon: Copy, onClick: onCopyPrompt } : null,
    { divider: true },
    { label: 'Download', icon: DownloadSimple, onClick: onDownload },
    image.visibility === 'public' ? { label: 'Copy Link', icon: ShareNetwork, onClick: onShare } : null,
    { divider: true },
    isOwner ? { label: image.visibility === 'public' ? 'Make Private' : 'Make Public', icon: image.visibility === 'public' ? Lock : Globe, onClick: onToggleVisibility } : null,
    isOwner ? { label: 'Delete', icon: Trash, onClick: onDelete, destructive: true } : null,
  ].filter(Boolean)

  // Remove trailing/leading/double dividers
  const cleaned = items.reduce((acc, item, i) => {
    if (item.divider && (i === 0 || i === items.length - 1 || acc[acc.length - 1]?.divider)) return acc
    acc.push(item)
    return acc
  }, [])

  return (
    <div
      ref={menuRef}
      className="fixed z-[100] animate-in fade-in zoom-in-95 duration-150"
      style={{ left: x, top: y }}
    >
      <div className="w-52 bg-bg-elevated/95 backdrop-blur-xl rounded-xl shadow-2xl shadow-black/50 border border-white/[0.08] overflow-hidden py-1">
        {cleaned.map((item, i) => {
          if (item.divider) return <div key={`d${i}`} className="h-px bg-white/[0.06] mx-2.5 my-1" />
          const Icon = item.icon
          return (
            <button
              key={item.label}
              onClick={(e) => { e.stopPropagation(); item.onClick(); onClose() }}
              className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-[13px] text-left transition-colors
                ${item.destructive ? 'text-red hover:bg-red/10' : 'text-text hover:bg-white/[0.06]'}`}
            >
              <Icon className={`w-4 h-4 shrink-0 ${item.destructive ? '' : item.accent ? 'text-red' : 'text-text-secondary'}`} weight={item.accent ? 'fill' : 'regular'} />
              {item.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
