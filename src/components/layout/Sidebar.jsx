import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import {
  LayoutDashboard, Building2, Users, CreditCard, TrendingDown,
  UserCog, BarChart3, ShieldAlert, Settings, X, ChevronRight,
  Home, Banknote
} from 'lucide-react'
import { initials } from '@/utils/helpers'

const NAV_ITEMS = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', exact: true },
  { to: '/buildings', icon: Building2, label: 'Buildings & Flats' },
  { to: '/owners', icon: Home, label: 'Building Owners' },
  { to: '/tenants', icon: Users, label: 'Tenants' },
  { to: '/payments', icon: CreditCard, label: 'Rent Collection' },
  { to: '/owner-payments', icon: Banknote, label: 'Owner Payments' },
  { to: '/expenses', icon: TrendingDown, label: 'Expenses' },
  { to: '/staff', icon: UserCog, label: 'Staff & Salary' },
  { to: '/reports', icon: BarChart3, label: 'Reports' },
]

const ADMIN_ITEMS = [
  { to: '/audit', icon: ShieldAlert, label: 'Audit', superAdminOnly: true },
  { to: '/settings', icon: Settings, label: 'Settings', adminOnly: true },
]

export default function Sidebar({ open, onClose }) {
  const { profile, signOut, isSuperAdmin, isAdmin } = useAuth()
  const location = useLocation()

  const linkClass = ({ isActive }) =>
    `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
      isActive
        ? 'bg-brand-500/15 text-brand-400 border border-brand-500/20'
        : 'text-surface-500 hover:text-surface-200 hover:bg-surface-800'
    }`

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 bg-black/60 z-30 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed top-0 left-0 h-full w-64 bg-surface-900/95 backdrop-blur-xl
        border-r border-surface-800 z-40
        flex flex-col
        transition-transform duration-300 ease-in-out
        ${open ? 'translate-x-0' : '-translate-x-full'}
        lg:translate-x-0 lg:static lg:z-auto
      `}>
        {/* Logo */}
        <div className="flex items-center justify-between px-5 py-5 border-b border-surface-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-brand-500 rounded-lg flex items-center justify-center shadow-glow-amber">
              <span className="font-display font-bold text-surface-950 text-sm">M</span>
            </div>
            <div>
              <p className="font-display font-bold text-surface-50 text-sm leading-none">MMR</p>
              <p className="text-surface-600 text-xs mt-0.5">Manage My Rent</p>
            </div>
          </div>
          <button onClick={onClose} className="lg:hidden text-surface-500 hover:text-surface-300 p-1">
            <X size={18} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
          <p className="text-surface-600 text-xs font-semibold uppercase tracking-widest px-3 pb-2">Main</p>
          {NAV_ITEMS.map(({ to, icon: Icon, label, exact }) => (
            <NavLink
              key={to}
              to={to}
              end={exact}
              className={linkClass}
              onClick={onClose}
            >
              <Icon size={17} />
              <span>{label}</span>
            </NavLink>
          ))}

          {(isSuperAdmin || isAdmin) && (
            <>
              <p className="text-surface-600 text-xs font-semibold uppercase tracking-widest px-3 pt-4 pb-2">Admin</p>
              {ADMIN_ITEMS.map(({ to, icon: Icon, label, superAdminOnly, adminOnly }) => {
                if (superAdminOnly && !isSuperAdmin) return null
                if (adminOnly && !isAdmin) return null
                return (
                  <NavLink
                    key={to}
                    to={to}
                    className={linkClass}
                    onClick={onClose}
                  >
                    <Icon size={17} />
                    <span>{label}</span>
                  </NavLink>
                )
              })}
            </>
          )}
        </nav>

        {/* User Profile */}
        <div className="border-t border-surface-800 p-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-brand-500/20 border border-brand-500/30 flex items-center justify-center text-brand-400 font-semibold text-sm">
              {initials(profile?.full_name || 'U')}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-surface-200 text-sm font-medium truncate">{profile?.full_name}</p>
              <p className="text-surface-500 text-xs capitalize">{profile?.role?.replace('_', ' ')}</p>
            </div>
            <button
              onClick={signOut}
              className="text-surface-600 hover:text-expense transition-colors p-1 rounded"
              title="Sign out"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}
