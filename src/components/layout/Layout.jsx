import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Menu, Bell, Search } from 'lucide-react'
import Sidebar from './Sidebar'

const PAGE_TITLES = {
  '/': 'Dashboard',
  '/buildings': 'Buildings & Flats',
  '/owners': 'Building Owners',
  '/tenants': 'Tenants',
  '/payments': 'Rent Collection',
  '/owner-payments': 'Owner Payments',
  '/expenses': 'Expenses',
  '/staff': 'Staff & Salary',
  '/reports': 'Reports',
  '/audit': 'Audit Center',
  '/settings': 'Settings',
}

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const location = useLocation()
  const pageTitle = PAGE_TITLES[location.pathname] || 'MMR'

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <header className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-surface-800 bg-surface-950/80 backdrop-blur-sm shrink-0">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden text-surface-500 hover:text-surface-200 p-1.5 rounded-lg hover:bg-surface-800 transition-colors"
            >
              <Menu size={20} />
            </button>
            <div>
              <h1 className="font-display font-bold text-surface-50 text-lg leading-none">{pageTitle}</h1>
              <p className="text-surface-600 text-xs mt-0.5 hidden sm:block">
                {new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-2 bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 w-56">
              <Search size={14} className="text-surface-500" />
              <span className="text-surface-600 text-sm">Search…</span>
            </div>
            <button className="relative p-2 rounded-lg hover:bg-surface-800 text-surface-500 hover:text-surface-200 transition-colors">
              <Bell size={18} />
              <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-brand-500 rounded-full"></span>
            </button>
          </div>
        </header>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto">
          <div className="p-4 sm:p-6 max-w-screen-2xl mx-auto animate-fade-in">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
