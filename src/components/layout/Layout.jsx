import { useState, useEffect, useCallback } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Menu, Search } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import Sidebar from './Sidebar'
import BottomNav from './BottomNav'
import CommandPalette from '@/components/CommandPalette'

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

export default function Layout() {
  const [open, setOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('cmr_sidebar_collapsed') === 'true' } catch { return false }
  })
  const [cmdK, setCmdK] = useState(false)
  const location = useLocation()

  // Close mobile sidebar on route change
  useEffect(() => { setOpen(false) }, [location.pathname])

  function toggleCollapse() {
    setCollapsed(c => {
      const next = !c
      try { localStorage.setItem('cmr_sidebar_collapsed', String(next)) } catch {}
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
      <Sidebar
        open={open}
        onClose={() => setOpen(false)}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapse}
        onOpenCmdK={() => setCmdK(true)}
      />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
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
