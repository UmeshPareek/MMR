import { useState, useEffect, useCallback } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import Sidebar from './Sidebar'
import CommandPalette from '@/components/CommandPalette'

const TITLES = {
  '/': 'Dashboard',
  '/dashboard': 'Dashboard',
  '/buildings': 'Buildings & Flats',
  '/owners': 'Building Owners',
  '/tenants': 'Tenants',
  '/payments': 'Rent Collection',
  '/owner-payments': 'Owner Payments',
  '/expenses': 'Expenses',
  '/staff': 'Staff & Salary',
  '/reports': 'Reports',
  '/daily-collection': 'Collection Tracker',
  '/daily-reconciliation': 'Daily Reconciliation',
  '/utility-bills': 'Utility Bills',
  '/security-deposits': 'Security Deposits',
  '/audit': 'Audit',
  '/platform-admin': 'Platform Admin',
  '/checkin': 'Check In',
  '/checkout': 'Check Out',
  '/settings': 'Settings',
}

export default function Layout() {
  const [open, setOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('cmr_sidebar_collapsed') === 'true' } catch { return false }
  })
  const [cmdK, setCmdK] = useState(false)
  const location = useLocation()

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

  return (
    <div className="flex h-screen overflow-hidden bg-surface-50 dark:bg-surface-950">
      <Sidebar
        open={open}
        onClose={() => setOpen(false)}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapse}
        onOpenCmdK={() => setCmdK(true)}
      />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-14 flex items-center justify-between px-5 bg-white dark:bg-surface-900 border-b border-surface-200 dark:border-surface-700/60 shrink-0">
          <div className="flex items-center gap-3">
            <button onClick={() => setOpen(true)}
              className="lg:hidden p-1.5 text-surface-400 hover:text-surface-700 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-md transition-colors">
              <Menu size={18} />
            </button>
            <div>
              <h1 className="font-semibold text-surface-900 dark:text-surface-50 text-[15px] leading-tight">
                {TITLES[location.pathname] || 'MMR'}
              </h1>
              <p className="text-[11px] text-surface-400 leading-tight hidden sm:block">
                {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setCmdK(true)}
              className="hidden sm:flex items-center gap-2 px-3 py-1.5 text-xs text-surface-400 dark:text-surface-500 border border-surface-200 dark:border-surface-700 rounded-md hover:border-surface-300 dark:hover:border-surface-600 bg-surface-50 dark:bg-surface-800 transition-colors"
            >
              Search
              <kbd className="font-mono bg-white dark:bg-surface-700 border border-surface-200 dark:border-surface-600 px-1 py-0.5 rounded text-[10px]">⌘K</kbd>
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="p-5 sm:p-6 max-w-screen-2xl mx-auto"
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <CommandPalette open={cmdK} onClose={() => setCmdK(false)} />
    </div>
  )
}
