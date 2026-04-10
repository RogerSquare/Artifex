import { useState, useCallback, useEffect, useRef } from 'react'
import { Globe, Lock, Trash, X, CheckSquare, Square, Warning, FolderPlus, Check, Columns, CircleNotch, Funnel, GridFour, GridNine, Image } from '@phosphor-icons/react'
import Header from './components/Header'
import GalleryGrid from './components/GalleryGrid'
import PhotoViewer from './components/PhotoViewer'
import UploadZone from './components/UploadZone'
import ImportModal from './components/ImportModal'
import SearchFilterBar from './components/SearchFilterBar'
import LoginPage from './components/LoginPage'
import AdminSettings from './components/AdminSettings'
import ThemePage from './components/ThemePage'
import ProfilePage from './components/ProfilePage'
import CollectionsPage from './components/CollectionsPage'
import CollectionDetail from './components/CollectionDetail'
import CompareView from './components/CompareView'
import ContextMenu from './components/ContextMenu'
import ShortcutsOverlay from './components/ShortcutsOverlay'
import FederatedGrid from './components/FederatedGrid'
import StatsDashboard from './components/StatsDashboard'
import ErrorBoundary from './components/ErrorBoundary'
import { useAuth } from './context/AuthContext'
import { API_URL, UPLOADS_URL } from './config'

function App() {
  const { user, authHeaders, loading: authLoading } = useAuth()
  const [selectedImage, setSelectedImage] = useState(null)
  const [galleryImages, setGalleryImages] = useState([])
  const [showUpload, setShowUpload] = useState(false)
  const [pastedFiles, setPastedFiles] = useState(null)
  const [pasteToast, setPasteToast] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [filters, setFilters] = useState({})
  const [galleryTab, setGalleryTab] = useState('public')
  const [imageCount, setImageCount] = useState(0)
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState([])
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCollection, setSelectedCollection] = useState(null)
  const [showCompare, setShowCompare] = useState(false)
  const [reorderMode, setReorderMode] = useState(false)
  const [reorderImageIds, setReorderImageIds] = useState(null)
  const [reorderSaving, setReorderSaving] = useState(false)
  const [contextMenu, setContextMenu] = useState(null) // { x, y, image }
  const [showBulkCollectionPicker, setShowBulkCollectionPicker] = useState(false)
  const [bulkCollections, setBulkCollections] = useState([])
  const [bulkAddedMsg, setBulkAddedMsg] = useState(null)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [libraryTab, setLibraryTab] = useState('favorites') // 'favorites' | 'collections'
  const [dragOverGrid, setDragOverGrid] = useState(false)
  const dragCounter = useRef(0)
  const [currentPage, setCurrentPage] = useState('gallery') // 'gallery' | 'admin' | 'theme' | 'profile'
  const [profileUsername, setProfileUsername] = useState(null)
  const [theme, setTheme] = useState(() => localStorage.getItem('galleryTheme') || 'midnight')
  const [gridSize, setGridSize] = useState(() => localStorage.getItem('galleryGridSize') || 'comfortable')
  const searchDebounce = useRef(null)

  // Apply theme to <html> element
  useEffect(() => {
    if (theme === 'midnight') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('galleryTheme', theme)
  }, [theme])

  useEffect(() => {
    localStorage.setItem('galleryGridSize', gridSize)
  }, [gridSize])

  // Debounced search → filters
  const handleSearchChange = useCallback((value) => {
    setSearchQuery(value)
    if (searchDebounce.current) clearTimeout(searchDebounce.current)
    searchDebounce.current = setTimeout(() => {
      setFilters(prev => {
        const next = { ...prev }
        if (value) next.query = value
        else delete next.query
        return next
      })
    }, 400)
  }, [])

  const toggleSelectMode = useCallback(() => {
    setSelectMode(prev => { if (prev) setSelectedIds([]); return !prev })
  }, [])

  const toggleSelectImage = useCallback((id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id])
  }, [])

  const exitSelectMode = useCallback(() => {
    setSelectMode(false); setSelectedIds([]); setShowDeleteConfirm(false)
  }, [])

  const handleBulkVisibility = useCallback(async (visibility) => {
    if (selectedIds.length === 0) return
    try {
      const res = await fetch(`${API_URL}/images/batch/visibility`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...authHeaders }, body: JSON.stringify({ ids: selectedIds, visibility }) })
      if (res.ok) { exitSelectMode(); setRefreshKey(prev => prev + 1) }
    } catch (e) { /* ignore */ }
  }, [selectedIds, authHeaders, exitSelectMode])

  const handleBulkDelete = useCallback(async () => {
    if (selectedIds.length === 0) return
    try {
      const res = await fetch(`${API_URL}/images/batch`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', ...authHeaders }, body: JSON.stringify({ ids: selectedIds }) })
      if (res.ok) { exitSelectMode(); setRefreshKey(prev => prev + 1) }
    } catch (e) { /* ignore */ }
  }, [selectedIds, authHeaders, exitSelectMode])

  const openBulkCollectionPicker = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/collections`, { headers: authHeaders })
      if (res.ok) {
        const data = await res.json()
        setBulkCollections(data.filter(c => c.user_id === user?.id))
      }
    } catch (e) {}
    setShowBulkCollectionPicker(true)
  }, [authHeaders, user?.id])

  const handleBulkAddToCollection = useCallback(async (collectionId) => {
    if (selectedIds.length === 0) return
    try {
      const res = await fetch(`${API_URL}/collections/${collectionId}/images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ imageIds: selectedIds })
      })
      if (res.ok) {
        const data = await res.json()
        const col = bulkCollections.find(c => c.id === collectionId)
        setBulkAddedMsg(`Added ${data.added} to "${col?.name}"`)
        setTimeout(() => setBulkAddedMsg(null), 2500)
      }
    } catch (e) {}
    setShowBulkCollectionPicker(false)
  }, [selectedIds, authHeaders, bulkCollections])

  const handleBulkRemoveFromCollection = useCallback(async () => {
    if (selectedIds.length === 0 || !selectedCollection) return
    try {
      await Promise.all(
        selectedIds.map(imageId =>
          fetch(`${API_URL}/collections/${selectedCollection.id}/images/${imageId}`, { method: 'DELETE', headers: authHeaders })
        )
      )
      exitSelectMode()
      setRefreshKey(prev => prev + 1)
    } catch (e) { /* ignore */ }
  }, [selectedIds, selectedCollection, authHeaders, exitSelectMode])

  const handleToggleFavorite = useCallback(async (imageId) => {
    const toggle = (img) => ({ ...img, is_favorited: !img.is_favorited, favorite_count: (img.favorite_count || 0) + (img.is_favorited ? -1 : 1) })
    setGalleryImages(prev => prev.map(img => img.id === imageId ? toggle(img) : img))
    setSelectedImage(prev => prev?.id === imageId ? toggle(prev) : prev)
    try {
      const res = await fetch(`${API_URL}/images/${imageId}/favorite`, { method: 'POST', headers: authHeaders })
      if (!res.ok) { setGalleryImages(prev => prev.map(img => img.id === imageId ? toggle(img) : img)); setSelectedImage(prev => prev?.id === imageId ? toggle(prev) : prev) }
    } catch (e) { setGalleryImages(prev => prev.map(img => img.id === imageId ? toggle(img) : img)); setSelectedImage(prev => prev?.id === imageId ? toggle(prev) : prev) }
  }, [authHeaders])

  useEffect(() => {
    const handleKey = (e) => {
      const tag = e.target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === 'Escape' && selectMode) exitSelectMode()
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'A') { e.preventDefault(); toggleSelectMode() }
      if (e.key === '?') setShowShortcuts(prev => !prev)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [selectMode, exitSelectMode, toggleSelectMode])

  // Clipboard paste upload — Ctrl+V anywhere (except text inputs)
  useEffect(() => {
    const handlePaste = (e) => {
      const tag = e.target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (showUpload || selectedImage) return

      const items = Array.from(e.clipboardData?.items || [])
      const imageFiles = items
        .filter(item => item.type.startsWith('image/'))
        .map(item => item.getAsFile())
        .filter(Boolean)

      if (imageFiles.length === 0) return
      e.preventDefault()
      setPastedFiles(imageFiles)
      setShowUpload(true)
      setPasteToast(true)
      setTimeout(() => setPasteToast(false), 2000)
    }
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [showUpload, selectedImage])

  const handleSelectImage = useCallback((image) => {
    fetch(`${API_URL}/images/${image.id}`, { headers: authHeaders }).then(res => res.json()).then(full => setSelectedImage(full)).catch(() => setSelectedImage(image))
  }, [authHeaders])

  const handleNavigate = useCallback((image) => {
    fetch(`${API_URL}/images/${image.id}`, { headers: authHeaders }).then(res => res.json()).then(full => setSelectedImage(full)).catch(() => setSelectedImage(image))
  }, [authHeaders])

  const handleClose = useCallback(() => setSelectedImage(null), [])
  const handleUploadComplete = useCallback(() => setRefreshKey(prev => prev + 1), [])

  const handleDelete = useCallback(async (id) => {
    try { const res = await fetch(`${API_URL}/images/${id}`, { method: 'DELETE', headers: authHeaders }); if (res.ok) { setSelectedImage(null); setRefreshKey(prev => prev + 1) } } catch (e) { /* ignore */ }
  }, [authHeaders])

  const handleToggleVisibility = useCallback(async (id, newVisibility) => {
    try {
      const res = await fetch(`${API_URL}/images/${id}/visibility`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...authHeaders }, body: JSON.stringify({ visibility: newVisibility }) })
      if (res.ok) { setSelectedImage(prev => prev?.id === id ? { ...prev, visibility: newVisibility } : prev); setRefreshKey(prev => prev + 1) }
    } catch (e) { /* ignore */ }
  }, [authHeaders])

  const handleImagesChange = useCallback((images) => { setGalleryImages(images); setImageCount(images.length) }, [])

  const navigateToProfile = useCallback((username) => {
    setProfileUsername(username)
    setCurrentPage('profile')
  }, [])

  useEffect(() => {
    if (selectedImage) document.body.style.overflow = 'hidden'
    else document.body.style.overflow = ''
    return () => { document.body.style.overflow = '' }
  }, [selectedImage])

  // Reset to gallery after login
  useEffect(() => {
    if (user && currentPage === 'login') setCurrentPage('gallery')
    if (user && galleryTab === 'public') setGalleryTab('mine')
  }, [user])

  if (authLoading) return <div className="min-h-screen bg-bg flex items-center justify-center text-text-muted text-[15px]">Loading...</div>
  if (currentPage === 'login' && !user) return <LoginPage onBack={() => setCurrentPage('gallery')} />
  if (currentPage === 'admin' && user?.role === 'admin') return <ErrorBoundary message="Admin panel encountered an error."><AdminSettings onBack={() => setCurrentPage('gallery')} /></ErrorBoundary>
  if (currentPage === 'stats' && user) return <ErrorBoundary message="Stats failed to load."><StatsDashboard onBack={() => setCurrentPage('gallery')} /></ErrorBoundary>
  if (currentPage === 'theme' && user) return <ErrorBoundary><ThemePage theme={theme} onThemeChange={setTheme} onBack={() => setCurrentPage('gallery')} /></ErrorBoundary>
  if (currentPage === 'profile' && profileUsername) return <ErrorBoundary message="Profile failed to load."><ProfilePage username={profileUsername} onBack={() => setCurrentPage('gallery')} onSelectImage={handleSelectImage} /></ErrorBoundary>

  return (
    <div className="min-h-screen bg-bg text-text">
      <Header
        imageCount={imageCount}
        onUpload={() => setShowUpload(true)}
        onImport={() => setShowImport(true)}
        galleryTab={galleryTab}
        onTabChange={(tab) => { setGalleryTab(tab); setSelectedCollection(null); setReorderMode(false) }}
        searchQuery={searchQuery}
        onSearchChange={handleSearchChange}
        onOpenProfile={() => navigateToProfile(user.username)}
        onOpenAdmin={() => setCurrentPage('admin')}
        onOpenTheme={() => setCurrentPage('theme')}
        onOpenShortcuts={() => setShowShortcuts(true)}
        onOpenStats={() => setCurrentPage('stats')}
        onLogin={() => setCurrentPage('login')}
      />

      {galleryTab === 'network' ? (
        <main className="max-w-[1400px] mx-auto px-5 sm:px-8 pt-4 pb-20 sm:pb-8">
          <ErrorBoundary message="Network feed failed to load.">
            <FederatedGrid gridSize={gridSize} authHeaders={authHeaders} />
          </ErrorBoundary>
        </main>
      ) : galleryTab === 'library' ? (
        selectedCollection ? (
          <ErrorBoundary message="Collection failed to load.">
            <CollectionDetail
              key={refreshKey}
              collection={selectedCollection}
              onBack={() => setSelectedCollection(null)}
              onSelectImage={handleSelectImage}
              selectMode={selectMode}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelectImage}
              onImagesChange={handleImagesChange}
            />
          </ErrorBoundary>
        ) : (
          <main className="max-w-[1400px] mx-auto px-5 sm:px-8 pt-4 pb-20 sm:pb-8">
            {/* Library sub-tabs: Favorites | Collections */}
            <div className="flex items-center gap-0.5 mb-4 p-[3px] rounded-lg bg-white/[0.04] w-fit">
              {[{ id: 'favorites', label: 'Favorites' }, { id: 'collections', label: 'Collections' }].map(t => (
                <button
                  key={t.id}
                  onClick={() => setLibraryTab(t.id)}
                  className={`px-4 py-1.5 rounded-md text-[13px] font-medium transition-all duration-200
                    ${libraryTab === t.id ? 'bg-white/[0.08] text-text shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {libraryTab === 'favorites' ? (
              <>
                {/* Reorder controls */}
                <div className="flex items-center gap-2 mb-4">
                  <div className="flex-1" />
                  {user && !selectMode && (
                    reorderMode ? (
                      <>
                        <button onClick={() => { setReorderMode(false); setReorderImageIds(null) }} disabled={reorderSaving} className="px-2.5 h-7 rounded-md text-[13px] font-medium text-text-secondary hover:text-text transition-all duration-200 shrink-0">Cancel</button>
                        <button onClick={async () => {
                          if (!reorderImageIds) return
                          setReorderSaving(true)
                          try {
                            const res = await fetch(`${API_URL}/images/favorites/reorder`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...authHeaders }, body: JSON.stringify({ imageIds: reorderImageIds }) })
                            if (res.ok) { setReorderMode(false); setReorderImageIds(null); setRefreshKey(prev => prev + 1) }
                          } catch (e) {} finally { setReorderSaving(false) }
                        }} disabled={reorderSaving} className="px-2.5 h-7 rounded-md text-[13px] font-medium bg-accent text-white hover:bg-accent-hover transition-all duration-200 shrink-0 flex items-center gap-1.5">
                          {reorderSaving && <CircleNotch className="w-3 h-3 animate-spin" />} Save Order
                        </button>
                      </>
                    ) : (
                      <button onClick={() => setReorderMode(true)} className="px-2.5 h-7 rounded-md text-[13px] font-medium text-text-secondary hover:text-text transition-all duration-200 shrink-0">Reorder</button>
                    )
                  )}
                </div>
                <ErrorBoundary message="Favorites failed to load.">
                  <GalleryGrid
                    key={`${refreshKey}-favorites`}
                    filters={filters}
                    galleryTab="favorites"
                    gridSize={gridSize}
                    onSelectImage={handleSelectImage}
                    onImagesChange={handleImagesChange}
                    authHeaders={authHeaders}
                    selectable={selectMode}
                    selectedIds={selectedIds}
                    onToggleSelect={toggleSelectImage}
                    onToggleFavorite={handleToggleFavorite}
                    onContextMenu={(e, image) => setContextMenu({ x: e.clientX, y: e.clientY, image })}
                    reorderMode={reorderMode}
                    onReorderChange={setReorderImageIds}
                    currentUserId={user?.id}
                  />
                </ErrorBoundary>
              </>
            ) : (
              <ErrorBoundary message="Collections failed to load.">
                <CollectionsPage
                  onSelectCollection={setSelectedCollection}
                  onSelectImage={handleSelectImage}
                />
              </ErrorBoundary>
            )}
          </main>
        )
      ) : (
        <main
          className="max-w-[1400px] mx-auto px-5 sm:px-8 pt-4 pb-20 sm:pb-8 relative"
          onDragEnter={(e) => {
            if (!e.dataTransfer.types.includes('Files')) return
            e.preventDefault()
            dragCounter.current++
            setDragOverGrid(true)
          }}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes('Files')) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
          }}
          onDragLeave={(e) => {
            if (!e.dataTransfer.types.includes('Files')) return
            e.preventDefault()
            dragCounter.current--
            if (dragCounter.current <= 0) { dragCounter.current = 0; setDragOverGrid(false) }
          }}
          onDrop={async (e) => {
            if (!e.dataTransfer.types.includes('Files') || !user) return
            e.preventDefault()
            dragCounter.current = 0
            setDragOverGrid(false)
            const files = Array.from(e.dataTransfer.files).filter(f => {
              const ext = f.name.toLowerCase().split('.').pop()
              return ['png','jpg','jpeg','webp','mp4','webm','mov'].includes(ext)
            })
            if (files.length === 0) return
            // Upload directly without opening the modal
            const formData = new FormData()
            files.forEach(f => formData.append('images', f))
            try {
              await fetch(`${API_URL}/images/upload`, { method: 'POST', body: formData, headers: authHeaders })
              setRefreshKey(prev => prev + 1)
            } catch (e) { /* ignore */ }
          }}
        >
          <div className="flex items-center gap-2 mb-4">
            {/* Filter toggle */}
            <button
              onClick={() => setShowFilters(prev => !prev)}
              className={`relative p-1.5 rounded-lg transition-all duration-200 shrink-0
                ${showFilters ? 'text-accent bg-accent/10' : 'text-text-secondary hover:text-text hover:bg-white/[0.06]'}`}
              title="Filters"
            >
              <Funnel className="w-4 h-4" />
              {Object.keys(filters).length > 0 && !showFilters && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-accent rounded-full" />
              )}
            </button>

            {/* Grid size toggle */}
            <div className="hidden sm:flex items-center bg-white/[0.04] rounded-md p-[2px]">
              {[
                { id: 'large', icon: Columns, title: 'Large' },
                { id: 'comfortable', icon: GridFour, title: 'Comfortable' },
                { id: 'compact', icon: GridNine, title: 'Compact' },
              ].map(opt => (
                <button
                  key={opt.id}
                  onClick={() => setGridSize(opt.id)}
                  className={`p-1 rounded transition-all duration-200 ${gridSize === opt.id ? 'bg-white/[0.1] text-text' : 'text-text-muted hover:text-text-secondary'}`}
                  title={opt.title}
                >
                  <opt.icon className="w-3.5 h-3.5" />
                </button>
              ))}
            </div>

            <div className="flex-1" />

            {/* Clear filters */}
            {Object.keys(filters).length > 0 && (
              <button
                onClick={() => setFilters({})}
                className="px-2.5 h-7 rounded-md text-[12px] font-medium text-red hover:bg-red/10 transition-all duration-200 shrink-0"
              >
                Clear
              </button>
            )}

            {/* Select / Cancel (logged in only) */}
            {user && !reorderMode && (
              <button
                onClick={toggleSelectMode}
                className={`px-2.5 h-7 rounded-md text-[13px] font-medium transition-all duration-200 shrink-0
                  ${selectMode ? 'text-accent' : 'text-text-secondary hover:text-text'}`}
              >
                {selectMode ? 'Cancel' : 'Select'}
              </button>
            )}
          </div>
          {showFilters && (
            <div className="mb-4">
              <SearchFilterBar filters={filters} onFiltersChange={setFilters} galleryTab={galleryTab} authHeaders={authHeaders} />
            </div>
          )}

          <ErrorBoundary message="Gallery failed to load.">
            <GalleryGrid
              key={`${refreshKey}-${galleryTab}`}
              filters={filters}
              galleryTab={galleryTab}
              gridSize={gridSize}
              onSelectImage={handleSelectImage}
              onImagesChange={handleImagesChange}
              authHeaders={authHeaders}
              selectable={selectMode}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelectImage}
              onToggleFavorite={handleToggleFavorite}
              onContextMenu={(e, image) => setContextMenu({ x: e.clientX, y: e.clientY, image })}
              reorderMode={false}
              onReorderChange={setReorderImageIds}
              currentUserId={user?.id}
            />
          </ErrorBoundary>
          {/* Drop zone overlay */}
          {dragOverGrid && (
            <div className="absolute inset-0 z-30 bg-accent/5 border-2 border-dashed border-accent/40 rounded-2xl flex items-center justify-center pointer-events-none">
              <div className="bg-bg-elevated/90 backdrop-blur-xl rounded-2xl px-8 py-6 text-center shadow-2xl">
                <Image className="w-10 h-10 text-accent mx-auto mb-3" />
                <p className="text-[15px] font-semibold text-text">Drop to upload</p>
                <p className="text-[13px] text-text-muted mt-1">Images and videos</p>
              </div>
            </div>
          )}
        </main>
      )}

      {/* Floating action bar — Apple Photos style */}
      {selectMode && selectedIds.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
          <div className="flex items-center gap-3 bg-bg-elevated/90 backdrop-blur-xl rounded-full px-5 py-2.5 shadow-2xl shadow-black/50 border border-white/[0.08]">
            <button onClick={() => { const ownedIds = galleryImages.filter(i => i.user_id === user?.id).map(i => i.id); setSelectedIds(selectedIds.length < ownedIds.length ? ownedIds : []) }} className="text-[13px] font-medium text-accent hover:text-accent-hover transition-colors">
              {selectedIds.length < galleryImages.filter(i => i.user_id === user?.id).length ? 'Select All' : 'Deselect All'}
            </button>
            {galleryTab === 'library' && selectedCollection ? (
              <>
                <div className="w-px h-5 bg-white/[0.1]" />
                <span className="text-[13px] text-text-muted tabular-nums">{selectedIds.length} selected</span>
                <div className="w-px h-5 bg-white/[0.1]" />
                {!showDeleteConfirm ? (
                  <button onClick={() => setShowDeleteConfirm(true)} className="p-2 rounded-full text-text-secondary hover:text-red hover:bg-red/10 transition-all duration-200" title="Remove from collection"><Trash className="w-[18px] h-[18px]" /></button>
                ) : (
                  <>
                    <button onClick={handleBulkRemoveFromCollection} className="px-3 py-1.5 bg-red text-white rounded-full text-[12px] font-semibold hover:bg-red/80 transition-colors">Remove {selectedIds.length}</button>
                    <button onClick={() => setShowDeleteConfirm(false)} className="text-[13px] font-medium text-text-secondary hover:text-text transition-colors">Cancel</button>
                  </>
                )}
              </>
            ) : (
              <>
                {selectedIds.length === 2 && (
                  <>
                    <div className="w-px h-5 bg-white/[0.1]" />
                    <button onClick={() => setShowCompare(true)} className="p-2 rounded-full text-text-secondary hover:text-accent hover:bg-accent/10 transition-all duration-200" title="Compare">
                      <Columns className="w-[18px] h-[18px]" />
                    </button>
                  </>
                )}
                <div className="w-px h-5 bg-white/[0.1]" />
                <div className="relative">
                  <button onClick={openBulkCollectionPicker} className={`p-2 rounded-full transition-all duration-200 ${showBulkCollectionPicker ? 'text-accent bg-accent/10' : 'text-text-secondary hover:text-accent hover:bg-accent/10'}`} title="Add to collection">
                    {bulkAddedMsg ? <Check className="w-[18px] h-[18px]" style={{ color: 'var(--color-green)' }} /> : <FolderPlus className="w-[18px] h-[18px]" />}
                  </button>
                  {showBulkCollectionPicker && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setShowBulkCollectionPicker(false)} />
                      <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-50 w-52 bg-bg-elevated/95 backdrop-blur-xl rounded-xl shadow-2xl shadow-black/40 border border-white/[0.08] overflow-hidden">
                        {bulkCollections.length === 0 ? (
                          <div className="px-3.5 py-3 text-[13px] text-text-muted text-center">No collections yet</div>
                        ) : bulkCollections.map(col => (
                          <button key={col.id} onClick={() => handleBulkAddToCollection(col.id)} className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] text-white hover:bg-white/[0.06] transition-colors text-left">
                            <FolderPlus className="w-4 h-4 text-white/40 shrink-0" />
                            <span className="truncate">{col.name}</span>
                            <span className="text-[11px] text-white/25 ml-auto shrink-0">{col.image_count}</span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
                {bulkAddedMsg && <span className="text-[12px] font-medium text-green whitespace-nowrap">{bulkAddedMsg}</span>}
                <div className="w-px h-5 bg-white/[0.1]" />
                <button onClick={() => handleBulkVisibility('public')} className="p-2 rounded-full text-text-secondary hover:text-green hover:bg-green/10 transition-all duration-200" title="Make public"><Globe className="w-[18px] h-[18px]" /></button>
                <button onClick={() => handleBulkVisibility('private')} className="p-2 rounded-full text-text-secondary hover:text-text hover:bg-white/[0.06] transition-all duration-200" title="Make private"><Lock className="w-[18px] h-[18px]" /></button>
                {!showDeleteConfirm ? (
                  <button onClick={() => setShowDeleteConfirm(true)} className="p-2 rounded-full text-text-secondary hover:text-red hover:bg-red/10 transition-all duration-200" title="Delete"><Trash className="w-[18px] h-[18px]" /></button>
                ) : (
                  <>
                    <button onClick={handleBulkDelete} className="px-3 py-1.5 bg-red text-white rounded-full text-[12px] font-semibold hover:bg-red/80 transition-colors">Delete {selectedIds.length}</button>
                    <button onClick={() => setShowDeleteConfirm(false)} className="text-[13px] font-medium text-text-secondary hover:text-text transition-colors">Cancel</button>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {showUpload && <UploadZone onClose={() => { setShowUpload(false); setPastedFiles(null) }} onUploadComplete={handleUploadComplete} authHeaders={authHeaders} initialFiles={pastedFiles} />}

      {/* Paste toast */}
      {pasteToast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[60] px-4 py-2 bg-bg-elevated/90 backdrop-blur-xl rounded-full shadow-lg border border-white/[0.08] text-[13px] font-medium text-text animate-fade-in">
          Image pasted
        </div>
      )}
      {showImport && <ImportModal onClose={() => setShowImport(false)} onImportComplete={handleUploadComplete} />}
      {selectedImage && (
        <ErrorBoundary message="Image viewer encountered an error.">
          <PhotoViewer image={selectedImage} images={galleryImages} onClose={handleClose} onNavigate={handleNavigate} onDelete={handleDelete} onToggleVisibility={handleToggleVisibility} onToggleFavorite={handleToggleFavorite} currentUserId={user?.id} onViewProfile={(username) => { handleClose(); navigateToProfile(username) }} onTagFilter={(tag) => setFilters(prev => ({ ...prev, tag }))} />
        </ErrorBoundary>
      )}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          image={contextMenu.image}
          isOwner={contextMenu.image.user_id === user?.id}
          onClose={() => setContextMenu(null)}
          onOpen={() => handleSelectImage(contextMenu.image)}
          onFavorite={() => handleToggleFavorite(contextMenu.image.id)}
          onCopyPrompt={() => { navigator.clipboard.writeText(contextMenu.image.prompt || ''); }}
          onDownload={() => { const a = document.createElement('a'); a.href = `${UPLOADS_URL}/${contextMenu.image.filepath}`; a.download = contextMenu.image.original_name; a.click() }}
          onToggleVisibility={() => handleToggleVisibility(contextMenu.image.id, contextMenu.image.visibility === 'public' ? 'private' : 'public')}
          onDelete={() => { if (window.confirm('Delete this image permanently?')) handleDelete(contextMenu.image.id) }}
          onShare={() => { navigator.clipboard.writeText(`${window.location.origin}?image=${contextMenu.image.id}`) }}
          onAddToCollection={() => { handleSelectImage(contextMenu.image) }}
        />
      )}
      {showCompare && selectedIds.length === 2 && (
        <CompareView
          imageA={galleryImages.find(i => i.id === selectedIds[0])}
          imageB={galleryImages.find(i => i.id === selectedIds[1])}
          onClose={() => setShowCompare(false)}
        />
      )}
      {showShortcuts && (
        <ShortcutsOverlay
          onClose={() => setShowShortcuts(false)}
          context={selectedImage ? 'viewer' : 'gallery'}
        />
      )}
    </div>
  )
}

export default App
