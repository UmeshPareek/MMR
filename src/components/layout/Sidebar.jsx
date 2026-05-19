import { NavLink } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { useTheme } from '@/contexts/ThemeContext'
import {
  LayoutDashboard, Building2, Users, CreditCard, TrendingDown,
  UserCog, BarChart3, ShieldCheck, Settings, X, LogOut,
  Home, Banknote, Zap, Wallet, ListChecks, ClipboardList, LogIn,
  ChevronLeft, ChevronRight, Sun, Moon, Search
} from 'lucide-react'
import { initials } from '@/utils/helpers'

export default function Sidebar({ open, onClose, collapsed, onToggleCollapse, onOpenCmdK }) {
  const { profile, signOut, isSuperAdmin, isAdmin } = useAuth()
  const { dark, toggle: toggleDark } = useTheme()
  const isTeam = profile?.role === 'team'

  const link = ({ isActive }) => [
    'group relative flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-all duration-150',
    collapsed ? 'justify-center px-0' : '',
    isActive
      ? 'bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 font-semibold'
      : 'text-surface-500 dark:text-surface-400 hover:text-surface-900 dark:hover:text-surface-100 hover:bg-surface-100 dark:hover:bg-surface-700/60 font-medium'
  ].join(' ')

  const Section = ({ label, children }) => (
    <div className="mb-1">
      {!collapsed && (
        <p className="text-[10px] font-semibold text-surface-400 dark:text-surface-500 uppercase tracking-widest px-3 pt-4 pb-1.5">{label}</p>
      )}
      {collapsed && <div className="pt-3" />}
      <div className="space-y-0.5">{children}</div>
    </div>
  )

  const Item = ({ to, icon: Icon, label, exact }) => (
    <NavLink to={to} end={exact} className={link} onClick={onClose} title={collapsed ? label : undefined}>
      {({ isActive }) => (
        <>
          {isActive && !collapsed && (
            <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-brand-600 dark:bg-brand-400 rounded-full" />
          )}
          <Icon size={15} className="flex-shrink-0" />
          {!collapsed && label}
        </>
      )}
    </NavLink>
  )

  return (
    <>
      {open && <div className="fixed inset-0 bg-black/20 z-30 lg:hidden" onClick={onClose} />}
      <aside className={`
        fixed top-0 left-0 h-full bg-white dark:bg-surface-900 z-40 flex flex-col
        border-r border-surface-200 dark:border-surface-700/60
        transition-all duration-250 ease-in-out
        ${open ? 'translate-x-0' : '-translate-x-full'}
        lg:translate-x-0 lg:static lg:z-auto
        ${collapsed ? 'w-[60px]' : 'w-60'}
      `}>

        {/* Brand */}
        <div className={`flex items-center h-14 px-3 border-b border-surface-200 dark:border-surface-700/60 shrink-0 ${collapsed ? 'justify-center' : 'justify-between'}`}>
          {collapsed ? (
            <div className="w-7 h-7 bg-brand-600 rounded-md flex items-center justify-center flex-shrink-0">
              <span className="font-display font-bold text-white text-xs">M</span>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 bg-brand-600 rounded-md flex items-center justify-center flex-shrink-0">
                  <span className="font-display font-bold text-white text-xs">M</span>
                </div>
                <div>
                  <p className="font-display font-bold text-surface-900 dark:text-surface-50 text-sm leading-tight">CashMyRent</p>
                  <p className="text-[10px] text-surface-400 dark:text-surface-500 leading-tight">Rent N Stay</p>
                </div>
              </div>
              <button onClick={onClose} className="lg:hidden p-1 text-surface-400 hover:text-surface-600"><X size={16} /></button>
            </>
          )}
        </div>

        {/* Nav */}
        <nav className={`flex-1 overflow-y-auto py-2 ${collapsed ? 'px-1.5' : 'px-2'}`}>

          {/* Cmd+K search trigger */}
          {!collapsed ? (
            <button
              onClick={onOpenCmdK}
              className="w-full flex items-center gap-2 px-3 py-2 mb-2 rounded-md text-sm text-surface-400 dark:text-surface-500 border border-surface-200 dark:border-surface-700 hover:border-surface-300 dark:hover:border-surface-600 bg-surface-50 dark:bg-surface-800/50 transition-colors"
            >
              <Search size={13} />
              <span className="flex-1 text-left text-xs">Quick search…</span>
              <kbd className="text-[10px] font-mono bg-white dark:bg-surface-700 border border-surface-200 dark:border-surface-600 px-1.5 py-0.5 rounded text-surface-400">⌘K</kbd>
            </button>
          ) : (
            <button onClick={onOpenCmdK} title="Search (⌘K)" className="w-full flex justify-center py-2 mb-2 text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 transition-colors">
              <Search size={15} />
            </button>
          )}

          {/* HOME */}
          <div className="space-y-0.5 mb-1 pt-1">
            <Item to="/" icon={LayoutDashboard} label={isTeam ? 'My Collections' : 'Dashboard'} exact />
          </div>

          <Section label="Collect">
            <Item to="/payments" icon={CreditCard} label="Log Payment" />
            <Item to="/daily-collection" icon={ListChecks} label="Collection Tracker" />
            <Item to="/daily-reconciliation" icon={ClipboardList} label="Daily Reconciliation" />
            <Item to="/utility-bills" icon={Zap} label="Utility Bills" />
            <Item to="/security-deposits" icon={Wallet} label="Security Deposits" />
          </Section>

          <Section label="Manage">
            <Item to="/buildings" icon={Building2} label="Buildings & Flats" />
            <Item to="/owners" icon={Home} label="Building Owners" />
            <Item to="/tenants" icon={Users} label="Tenants" />
            <Item to="/owner-payments" icon={Banknote} label="Owner Payments" />
            <Item to="/expenses" icon={TrendingDown} label="Expenses" />
            <Item to="/staff" icon={UserCog} label="Staff & Salary" />
          </Section>

          <Section label="Reports">
            <Item to="/reports" icon={BarChart3} label="Reports" />
          </Section>

          {(isSuperAdmin || isAdmin) && (
            <Section label="Admin">
              {isSuperAdmin && <Item to="/audit" icon={ShieldCheck} label="Audit" />}
              <Item to="/checkin" icon={LogIn} label="Check In" />
              <Item to="/checkout" icon={LogOut} label="Check Out" />
              <Item to="/settings" icon={Settings} label="Settings" />
            </Section>
          )}
        </nav>

        {/* Footer */}
        <div className="border-t border-surface-200 dark:border-surface-700/60 px-2 py-3 space-y-1">
          {/* Dark mode toggle */}
          <button
            onClick={toggleDark}
            title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-all duration-150 text-surface-500 dark:text-surface-400 hover:text-surface-900 dark:hover:text-surface-100 hover:bg-surface-100 dark:hover:bg-surface-700/60 ${collapsed ? 'justify-center' : ''}`}
          >
            {dark ? <Sun size={15} className="flex-shrink-0" /> : <Moon size={15} className="flex-shrink-0" />}
            {!collapsed && (dark ? 'Light Mode' : 'Dark Mode')}
          </button>

          {/* Collapse toggle (desktop only) */}
          <button
            onClick={onToggleCollapse}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={`hidden lg:flex w-full items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-all duration-150 text-surface-400 dark:text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700/60 ${collapsed ? 'justify-center' : ''}`}
          >
            {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
            {!collapsed && 'Collapse'}
          </button>

          {/* User row */}
          {!collapsed && (
            <div className="flex items-center gap-2.5 px-3 py-2">
              <div className="w-7 h-7 rounded-full bg-brand-600 flex items-center justify-center text-white font-semibold text-xs flex-shrink-0">
                {initials(profile?.full_name || 'U')}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-surface-800 dark:text-surface-200 truncate leading-tight">{profile?.full_name || 'User'}</p>
                <p className="text-[10px] text-surface-400 dark:text-surface-500 capitalize leading-tight">{profile?.role?.replace('_', ' ')}</p>
              </div>
              <button onClick={signOut} title="Sign out"
                className="p-1.5 text-surface-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors">
                <LogOut size={14} />
              </button>
            </div>
          )}
          {collapsed && (
            <button onClick={signOut} title="Sign out"
              className="w-full flex justify-center py-2 text-surface-400 hover:text-red-500 transition-colors">
              <LogOut size={14} />
            </button>
          )}
        </div>
      </aside>
    </>
  )
}
