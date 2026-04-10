import { useState } from 'react'
import { Plus, FolderOpen, UploadSimple, SignOut, MagnifyingGlass, X, Gear, Palette, User, Keyboard, ChartBar, House, Globe, Image, BookmarkSimple, ShareNetwork } from '@phosphor-icons/react'
import { useAuth } from '../context/AuthContext'
import { UPLOADS_URL } from '../config'

const ALL_TABS = [
  { id: 'all', label: 'All', icon: House },
  { id: 'public', label: 'Public', icon: Globe },
  { id: 'mine', label: 'Uploads', icon: Image },
  { id: 'library', label: 'Library', icon: BookmarkSimple },
  { id: 'network', label: 'Network', icon: ShareNetwork },
]

const PUBLIC_TABS = [
  { id: 'public', label: 'Public', icon: Globe },
]

export default function Header({ imageCount, onUpload, onImport, galleryTab, onTabChange, searchQuery, onSearchChange, onOpenAdmin, onOpenTheme, onOpenProfile, onOpenShortcuts, onOpenStats, onLogin }) {
  const { user, logout } = useAuth()
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showMobileSearch, setShowMobileSearch] = useState(false)

  const tabs = user ? ALL_TABS : PUBLIC_TABS

  return (
    <>
      <header className="sticky top-0 z-40 bg-bg/80 backdrop-blur-xl backdrop-saturate-150 relative">
        <div className="max-w-[1400px] mx-auto px-5 sm:px-8 h-11 flex items-center border-b border-white/[0.06]">

          {/* Left — logo */}
          <div className="sm:w-32 shrink-0">
            <div className="flex items-center gap-2">
              <img src="/favicon.svg" alt="Artifex" className="w-6 h-6" />
              <h1 className="hidden sm:block text-[15px] font-semibold tracking-tight text-text whitespace-nowrap">Artifex</h1>
            </div>
          </div>

          {/* Center — Desktop tabs */}
          <nav className="hidden sm:flex items-center gap-0.5 mx-auto">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={`px-3 py-1 rounded-md text-[13px] font-medium transition-all duration-200
                  ${galleryTab === tab.id ? 'text-text bg-white/[0.08]' : 'text-text-muted hover:text-text-secondary'}`}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          {/* Mobile — spacer */}
          <div className="flex-1 sm:hidden" />

          {/* Right — Actions */}
          <div className="flex items-center gap-1.5">
            {/* Desktop search */}
            <div className="relative hidden sm:block w-48 group">
              <MagnifyingGlass className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted group-focus-within:text-text-secondary transition-colors" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search"
                className="w-full h-7 bg-white/[0.06] rounded-md pl-8 pr-7 text-[13px] text-text placeholder:text-text-muted focus:outline-none focus:bg-white/[0.1] focus:ring-1 focus:ring-accent/30 transition-colors duration-200"
              />
              {searchQuery && (
                <button onClick={() => onSearchChange('')} className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-text-muted/30 flex items-center justify-center hover:bg-text-muted/50 transition-colors">
                  <X className="w-2.5 h-2.5 text-bg" />
                </button>
              )}
            </div>

            {/* Mobile search icon */}
            <button
              onClick={() => setShowMobileSearch(true)}
              className="sm:hidden p-1.5 rounded-md text-text-secondary hover:text-text hover:bg-white/[0.06] transition-all duration-200"
            >
              <MagnifyingGlass className="w-4 h-4" />
            </button>

            {/* Sign In for guests */}
            {!user && (
              <button onClick={onLogin} className="px-3 h-7 rounded-md bg-accent hover:bg-accent-hover text-white text-[13px] font-semibold transition-all duration-200">
                Sign In
              </button>
            )}

            {/* Add button (logged in, desktop + mobile) */}
            {user && (
              <div className="relative flex items-center">
                <button
                  onClick={() => setShowAddMenu(prev => !prev)}
                  className="w-7 h-7 rounded-md bg-accent hover:bg-accent-hover text-white flex items-center justify-center transition-all duration-200"
                  title="Add images"
                >
                  <Plus className="w-4 h-4" weight="bold" />
                </button>
                {showAddMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowAddMenu(false)} />
                    <div className="absolute right-0 top-full mt-1.5 z-50 w-48 bg-bg-elevated/95 backdrop-blur-xl rounded-xl shadow-2xl shadow-black/40 border border-white/[0.08] overflow-hidden">
                      <button onClick={() => { setShowAddMenu(false); onUpload() }} className="w-full flex items-center gap-3 px-3.5 py-2.5 text-[13px] text-text hover:bg-white/[0.06] transition-colors">
                        <UploadSimple className="w-4 h-4 text-text-secondary" /> Upload Images
                      </button>
                      <div className="h-px bg-white/[0.06] mx-3" />
                      <button onClick={() => { setShowAddMenu(false); onImport() }} className="w-full flex items-center gap-3 px-3.5 py-2.5 text-[13px] text-text hover:bg-white/[0.06] transition-colors">
                        <FolderOpen className="w-4 h-4 text-text-secondary" /> Import Folder
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* User avatar */}
            {user && (
              <div className="relative ml-0.5 flex items-center">
                <button
                  onClick={() => setShowUserMenu(prev => !prev)}
                  className="w-7 h-7 rounded-full overflow-hidden hover:ring-2 hover:ring-white/20 transition-all duration-200 flex items-center justify-center"
                  title={user.display_name || user.username}
                >
                  {user.avatar ? (
                    <img src={`${UPLOADS_URL}/${user.avatar}`} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-b from-white/20 to-white/5 flex items-center justify-center text-[11px] font-semibold text-text-secondary">
                      {(user.display_name || user.username).charAt(0).toUpperCase()}
                    </div>
                  )}
                </button>
                {showUserMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
                    <div className="absolute right-0 top-full mt-1.5 z-50 w-52 bg-bg-elevated/95 backdrop-blur-xl rounded-xl shadow-2xl shadow-black/40 border border-white/[0.08] overflow-hidden">
                      <div className="px-3.5 py-2.5 border-b border-white/[0.06]">
                        <p className="text-[13px] font-medium text-text truncate">{user.display_name || user.username}</p>
                      </div>
                      <button onClick={() => { setShowUserMenu(false); onOpenProfile?.() }} className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] text-text hover:bg-white/[0.06] transition-colors">
                        <User className="w-4 h-4 text-text-secondary" /> My Profile
                      </button>
                      <button onClick={() => { setShowUserMenu(false); onOpenTheme?.() }} className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] text-text hover:bg-white/[0.06] transition-colors">
                        <Palette className="w-4 h-4 text-text-secondary" /> Appearance
                      </button>
                      <button onClick={() => { setShowUserMenu(false); onOpenStats?.() }} className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] text-text hover:bg-white/[0.06] transition-colors">
                        <ChartBar className="w-4 h-4 text-text-secondary" /> Stats
                      </button>
                      {user.role === 'admin' && (
                        <button onClick={() => { setShowUserMenu(false); onOpenAdmin?.() }} className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] text-text hover:bg-white/[0.06] transition-colors">
                          <Gear className="w-4 h-4 text-text-secondary" /> Admin Settings
                        </button>
                      )}
                      <button onClick={() => { setShowUserMenu(false); onOpenShortcuts?.() }} className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] text-text hover:bg-white/[0.06] transition-colors">
                        <Keyboard className="w-4 h-4 text-text-secondary" /> Shortcuts
                        <span className="ml-auto text-[11px] text-text-muted">?</span>
                      </button>
                      <div className="h-px bg-white/[0.06] mx-2" />
                      <button onClick={() => { setShowUserMenu(false); logout() }} className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] text-red hover:bg-red/10 transition-colors">
                        <SignOut className="w-3.5 h-3.5" /> Sign Out
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Mobile search overlay */}
        {showMobileSearch && (
          <div className="sm:hidden absolute inset-x-0 top-0 z-50 bg-bg/95 backdrop-blur-xl border-b border-white/[0.06] px-4 h-11 flex items-center gap-3">
            <MagnifyingGlass className="w-4 h-4 text-text-muted shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search images, tags, prompts..."
              className="flex-1 h-9 bg-transparent text-[15px] text-text placeholder:text-text-muted focus:outline-none"
              autoFocus
            />
            <button
              onClick={() => { setShowMobileSearch(false); if (!searchQuery) onSearchChange('') }}
              className="p-1.5 rounded-md text-text-secondary hover:text-text transition-colors shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </header>

      {/* Mobile bottom tab bar — Instagram/Apple Photos style */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-40 bg-bg/90 backdrop-blur-xl border-t border-white/[0.06] safe-area-pb">
        <div className="flex items-center justify-around h-12 px-2">
          {tabs.map(tab => {
            const Icon = tab.icon;
            const active = galleryTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg transition-all duration-200
                  ${active ? 'text-accent' : 'text-text-muted'}`}
              >
                <Icon className="w-5 h-5" weight={active ? 'fill' : 'regular'} />
                <span className="text-[10px] font-medium">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  )
}
