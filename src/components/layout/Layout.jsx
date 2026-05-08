import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Menu, Bell } from 'lucide-react'
import Sidebar from './Sidebar'

const TITLES = {
  '/': 'Dashboard', '/buildings': 'Buildings & Flats', '/owners': 'Building Owners',
  '/tenants': 'Tenants', '/payments': 'Rent Collection', '/owner-payments': 'Owner Payments',
  '/expenses': 'Expenses', '/staff': 'Staff & Salary', '/reports': 'Reports',
  '/daily-collection': 'Collection Tracker',
  '/utility-bills': 'Utility Bills',
  '/security-deposits': 'Security Deposits',
  '/dashboard': 'Dashboard',
  '/security-deposits': 'Security Deposits',
  '/audit': 'Audit', '/settings': 'Settings',
}

export default function Layout() {
  const [open, setOpen] = useState(false)
  const location = useLocation()

  return (
    <div className="flex h-screen overflow-hidden bg-surface-50">
      <Sidebar open={open} onClose={() => setOpen(false)} />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-14 flex items-center justify-between px-5 bg-white border-b border-surface-200 shrink-0">
          <div className="flex items-center gap-3">
            <button onClick={() => setOpen(true)}
              className="lg:hidden p-1.5 text-surface-400 hover:text-surface-700 hover:bg-surface-100 rounded-md transition-colors">
              <Menu size={18} />
            </button>
            <div>
              <h1 className="font-semibold text-surface-900 text-[15px] leading-tight">
                {TITLES[location.pathname] || 'MMR'}
              </h1>
              <p className="text-[11px] text-surface-400 leading-tight hidden sm:block">
                {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button className="relative p-2 text-surface-400 hover:text-surface-700 hover:bg-surface-100 rounded-md transition-colors">
              <Bell size={17} />
              <span className="absolute top-2 right-2 w-1.5 h-1.5 bg-brand-500 rounded-full" />
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="p-5 sm:p-6 max-w-screen-2xl mx-auto animate-fade-in">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
