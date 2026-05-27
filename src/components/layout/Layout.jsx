import { useState, useEffect, useCallback } from 'react'
import { Outlet, useLocation, Link } from 'react-router-dom'
import { Menu, Search, Zap } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import Sidebar from './Sidebar'
import BottomNav from './BottomNav'
import CommandPalette from '@/components/CommandPalette'
import { useAuth } from '@/contexts/AuthContext'

const TITLES = {
  '/':                    'Dashboard',
  '/dashboard':           'Dashboard',
  '/buildings':           'Buildings & Flats',
  '/owners':              'Building Owners',
  '/tenants':             'Tenants',
  '/payments':            'Rent Collection',
  '/owner-payments':      'Owner Payments',
  '/expenses':            'Expenses',
  '/staff':               'Staff & Salary',
  '/reports':             'Reports',
  '/daily-collection':    'Collection Tracker',
  '/daily-reconciliation':'Daily Reconciliation',
  '/utility-bills':       'Utility Bills',
  '/security-deposits':   'Security Deposits',
  '/audit':               'Audit',
  '/platform-admin':      'Platform Admin',
  '/checkin':             'Check In',
  '/checkout':            'Check Out',
  '/settings':            'Settings',
}

function TrialBanner({ org }) {
  if (!org || org.status !== 'trial' || !org.trial_ends_at) return null
  const daysLeft = Math.ceil((new Date(org.trial_ends_at) - new Date()) / 86400000)
  if (daysLeft < 0) {
    return (
      <div className="bg-red-600 text-white text-xs font-medium px-4 py-2 flex items-center justify-between gap-3 shrink-0">
        <span>Your trial has expired. Upgrade to continue using CashMyRent.</span>
        <Link to="/settings" className="bg-white text-red-600 rounded-md px-2.5 py-1 text-xs font-semibold hover:bg-red-50 shrink-0">
          Upgrade now
        </Link>
      </div>
    )
  }
  if (daysLeft > 7) return null
  return (
    <div className={`text-white text-xs font-medium px-4 py-2 flex items-center justify-between gap-3 shrink-0 ${daysLeft <= 3 ? 'bg-red-500' : 'bg-amber-500'}`}>
      <span className="flex items-center gap-1.5">
        <Zap size={12} />
        {daysLeft === 0 ? 'Trial expires today' : `Trial expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`} — upgrade to keep all your data.
      </span>
      <Link to="/settings" className="bg-white/20 hover:bg-white/30 rounded-md px-2.5 py-1 text-xs font-semibold shrink-0">
        Upgrade
      </Link>
    </div>
  )
}

export default function Layout() {
  const { org } = useAuth()
  const [open, setOpen] = useState(false)
  // `pinned` = user explicitly collapsed the sidebar (persisted)
  // `hoverExpanded` = sidebar is temporarily expanded because the mouse is over it
  const [pinned, setPinned] = useState(() => {
    try { return localStorage.getItem('cmr_sidebar_collapsed') === 'true' } catch { return false }
  })
  const [hoverExpanded, setHoverExpanded] = useState(false)
  const collapsed = pinned && !hoverExpanded   // visual state fed to Sidebar
  const [cmdK, setCmdK] = useState(false)
  const location = useLocation()

  // Close mobile sidebar on route change
  useEffect(() => { setOpen(false) }, [location.pathname])

  function toggleCollapse() {
    setPinned(p => {
      const next = !p
      try { localStorage.setItem('cmr_sidebar_collapsed', String(next)) } catch {}
      if (!next) setHoverExpanded(false)   // unpinning → always open, clear hover state
      return next
    })
  }

  const handleKey = useCallback((e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault()
      setCmdK(v => !v)
    }
  }, [])

  useEffect(() => {
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [handleKey])

  const title = TITLES[location.pathname] || 'CashMyRent'

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-surface-50 dark:bg-surface-950">
      {/* Desktop spacer — reserves the sidebar's width so content doesn't shift on hover-expand */}
      <div className={`hidden lg:block shrink-0 transition-all duration-250 ease-in-out ${pinned ? 'w-[58px]' : 'w-[220px]'}`} />
      <Sidebar
        open={open}
        onClose={() => setOpen(false)}
        collapsed={collapsed}
        pinned={pinned}
        hoverExpanded={hoverExpanded}
        onToggleCollapse={toggleCollapse}
        onOpenCmdK={() => setCmdK(true)}
        onMouseEnter={() => { if (pinned) setHoverExpanded(true) }}
        onMouseLeave={() => setHoverExpanded(false)}
      />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <TrialBanner org={org} />
        {/* Top header */}
        <header className="h-14 flex items-center justify-between px-4 sm:px-5 bg-white dark:bg-surface-900 border-b border-surface-200 dark:border-white/5 shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setOpen(true)}
              className="lg:hidden p-2 -ml-1 text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 hover:bg-surface-100 dark:hover:bg-white/5 rounded-md transition-colors"
            >
              <Menu size={18} />
            </button>
            <h1 className="font-display font-bold text-surface-900 dark:text-surface-50 text-[15px] tracking-tight">
              {title}
            </h1>
          </div>

          <button
            onClick={() => setCmdK(true)}
            className="flex items-center gap-2 px-3 py-1.5 text-xs text-surface-400 dark:text-surface-500
                       border border-surface-200 dark:border-white/10 rounded-lg
                       hover:border-surface-300 dark:hover:border-white/20
                       bg-surface-50 dark:bg-white/5 transition-colors"
          >
            <Search size={13} />
            <span className="hidden sm:inline">Search</span>
            <kbd className="hidden sm:inline font-mono text-[10px] bg-white dark:bg-white/5 border border-surface-200 dark:border-white/10 px-1 py-0.5 rounded">⌘K</kbd>
          </button>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto overscroll-contain">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              className="p-4 sm:p-5 lg:p-6 max-w-screen-2xl mx-auto pb-24 lg:pb-6"
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <BottomNav />

      <CommandPalette open={cmdK} onClose={() => setCmdK(false)} />
    </div>
  )
}
