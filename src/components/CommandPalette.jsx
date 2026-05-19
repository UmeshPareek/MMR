import { useEffect, useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, LayoutDashboard, Building2, Users, CreditCard, TrendingDown, UserCog, BarChart3, Settings, Zap, Wallet, ListChecks, ClipboardList, Home, Banknote, LogIn, LogOut, ShieldCheck, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'

const PAGES = [
  { label: 'Dashboard', path: '/', icon: LayoutDashboard, group: 'Pages' },
  { label: 'Log Payment', path: '/payments', icon: CreditCard, group: 'Pages' },
  { label: 'Collection Tracker', path: '/daily-collection', icon: ListChecks, group: 'Pages' },
  { label: 'Daily Reconciliation', path: '/daily-reconciliation', icon: ClipboardList, group: 'Pages' },
  { label: 'Utility Bills', path: '/utility-bills', icon: Zap, group: 'Pages' },
  { label: 'Security Deposits', path: '/security-deposits', icon: Wallet, group: 'Pages' },
  { label: 'Buildings & Flats', path: '/buildings', icon: Building2, group: 'Pages' },
  { label: 'Building Owners', path: '/owners', icon: Home, group: 'Pages' },
  { label: 'Tenants', path: '/tenants', icon: Users, group: 'Pages' },
  { label: 'Owner Payments', path: '/owner-payments', icon: Banknote, group: 'Pages' },
  { label: 'Expenses', path: '/expenses', icon: TrendingDown, group: 'Pages' },
  { label: 'Staff & Salary', path: '/staff', icon: UserCog, group: 'Pages' },
  { label: 'Reports', path: '/reports', icon: BarChart3, group: 'Pages' },
  { label: 'Check In', path: '/checkin', icon: LogIn, group: 'Pages' },
  { label: 'Check Out', path: '/checkout', icon: LogOut, group: 'Pages' },
  { label: 'Audit', path: '/audit', icon: ShieldCheck, group: 'Pages' },
  { label: 'Settings', path: '/settings', icon: Settings, group: 'Pages' },
]

export default function CommandPalette({ open, onClose }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [activeIdx, setActiveIdx] = useState(0)
  const [searching, setSearching] = useState(false)
  const inputRef = useRef(null)
  const listRef = useRef(null)

  const search = useCallback(async (q) => {
    const trimmed = q.trim()
    if (!trimmed) {
      setResults(PAGES.slice(0, 8))
      setActiveIdx(0)
      return
    }
    setSearching(true)
    const lower = trimmed.toLowerCase()
    const pageMatches = PAGES.filter(p => p.label.toLowerCase().includes(lower))

    const [{ data: tenants }, { data: buildings }] = await Promise.all([
      supabase.from('tenants').select('id, full_name, phone').ilike('full_name', `%${trimmed}%`).eq('status', 'active').limit(5),
      supabase.from('buildings').select('id, name').ilike('name', `%${trimmed}%`).eq('is_active', true).limit(5),
    ])

    const tenantItems = (tenants || []).map(t => ({
      label: t.full_name,
      sub: t.phone,
      path: '/tenants',
      icon: Users,
      group: 'Tenants',
    }))
    const buildingItems = (buildings || []).map(b => ({
      label: b.name,
      path: `/buildings/${b.id}`,
      icon: Building2,
      group: 'Buildings',
    }))

    setResults([...pageMatches, ...tenantItems, ...buildingItems])
    setActiveIdx(0)
    setSearching(false)
  }, [])

  useEffect(() => {
    if (open) {
      setQuery('')
      setResults(PAGES.slice(0, 8))
      setActiveIdx(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  useEffect(() => {
    const t = setTimeout(() => search(query), 150)
    return () => clearTimeout(t)
  }, [query, search])

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.children[activeIdx]
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx])

  function handleKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, results.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)) }
    if (e.key === 'Enter' && results[activeIdx]) go(results[activeIdx])
    if (e.key === 'Escape') onClose()
  }

  function go(item) {
    navigate(item.path)
    onClose()
  }

  // Group results
  const grouped = results.reduce((acc, item) => {
    if (!acc[item.group]) acc[item.group] = []
    acc[item.group].push(item)
    return acc
  }, {})

  let flatIdx = 0

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] px-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={e => e.target === e.currentTarget && onClose()}
        >
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            className="relative w-full max-w-xl bg-white dark:bg-surface-800 rounded-2xl shadow-2xl border border-surface-200 dark:border-surface-700 overflow-hidden"
            initial={{ scale: 0.96, y: -8, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.96, y: -8, opacity: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
          >
            {/* Search input */}
            <div className="flex items-center gap-3 px-4 py-3.5 border-b border-surface-200 dark:border-surface-700">
              <Search size={16} className="text-surface-400 flex-shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={handleKey}
                placeholder="Search pages, tenants, buildings…"
                className="flex-1 text-sm text-surface-800 dark:text-surface-100 bg-transparent outline-none placeholder-surface-400"
              />
              {query && (
                <button onClick={() => setQuery('')} className="text-surface-400 hover:text-surface-600">
                  <X size={14} />
                </button>
              )}
              <kbd className="text-[10px] font-mono bg-surface-100 dark:bg-surface-700 text-surface-400 px-1.5 py-0.5 rounded border border-surface-200 dark:border-surface-600">ESC</kbd>
            </div>

            {/* Results */}
            <div ref={listRef} className="max-h-80 overflow-y-auto py-2">
              {results.length === 0 && !searching && (
                <p className="text-center text-surface-400 text-sm py-8">No results for "{query}"</p>
              )}
              {Object.entries(grouped).map(([group, items]) => (
                <div key={group}>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-surface-400 px-4 pt-3 pb-1">{group}</p>
                  {items.map(item => {
                    const idx = flatIdx++
                    const isActive = idx === activeIdx
                    return (
                      <button
                        key={item.path + item.label}
                        onClick={() => go(item)}
                        onMouseEnter={() => setActiveIdx(idx)}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${isActive ? 'bg-brand-50 dark:bg-brand-900/30' : 'hover:bg-surface-50 dark:hover:bg-surface-700/50'}`}
                      >
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${isActive ? 'bg-brand-100 dark:bg-brand-800' : 'bg-surface-100 dark:bg-surface-700'}`}>
                          <item.icon size={13} className={isActive ? 'text-brand-600' : 'text-surface-500'} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium truncate ${isActive ? 'text-brand-700 dark:text-brand-300' : 'text-surface-700 dark:text-surface-200'}`}>{item.label}</p>
                          {item.sub && <p className="text-xs text-surface-400 truncate">{item.sub}</p>}
                        </div>
                        {isActive && <kbd className="text-[10px] text-surface-400 font-mono">↵</kbd>}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>

            <div className="border-t border-surface-100 dark:border-surface-700 px-4 py-2 flex items-center gap-4 text-[10px] text-surface-400">
              <span><kbd className="font-mono">↑↓</kbd> navigate</span>
              <span><kbd className="font-mono">↵</kbd> open</span>
              <span><kbd className="font-mono">esc</kbd> close</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
