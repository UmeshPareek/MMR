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
  const { profile, org, signOut, isSuperAdmin, isAdmin } = useAuth()
  const { dark, toggle: toggleDark } = useTheme()
  const isTeam = profile?.role === 'team'

  const orgName    = org?.name    || 'CashMyRent'
  const orgInitial = orgName.charAt(0).toUpperCase()

  const link = ({ isActive }) => [
    'group relative flex items-center gap-2.5 rounded-md text-[13px] font-medium transition-all duration-150 px-3 py-2',
    collapsed ? 'justify-center px-0' : '',
    isActive
      ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300'
      : 'text-surface-500 hover:text-surface-800 hover:bg-surface-100 dark:text-surface-400 dark:hover:text-surface-100 dark:hover:bg-white/5',
  ].join(' ')

  const Section = ({ label, children }) => (
    <div className="mb-1">
      {!collapsed && (
        <p className="text-[10px] font-semibold text-surface-400 dark:text-surface-600 uppercase tracking-widest px-3 pt-4 pb-1">
          {label}
        </p>
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
            <span className="absolute left-0 top-2 bottom-2 w-0.5 bg-brand-600 dark:bg-brand-400 rounded-full" />
          )}
          <Icon
            size={15}
            className={`flex-shrink-0 ${isActive ? 'text-brand-600 dark:text-brand-400' : 'text-surface-400 dark:text-surface-500 group-hover:text-surface-600 dark:group-hover:text-surface-300'}`}
          />
          {!collapsed && label}
        </>
      )}
    </NavLink>
  )

  return (
    <>
      {open && (
        <div className="fixed inset-0 bg-black/40 z-30 lg:hidden backdrop-blur-sm" onClick={onClose} />
      )}
      <aside className={`
        fixed top-0 left-0 h-full z-40 flex flex-col
        bg-white dark:bg-surface-900
        border-r border-surface-200 dark:border-white/5
        transition-all duration-250 ease-in-out
        ${open ? 'translate-x-0' : '-translate-x-full'}
        lg:translate-x-0 lg:static lg:z-auto
        ${collapsed ? 'w-[58px]' : 'w-[220px]'}
      `}>

        {/* Brand — org-aware */}
        <div className={`flex items-center h-14 px-3 border-b border-surface-200 dark:border-white/5 shrink-0 ${collapsed ? 'justify-center' : 'justify-between'}`}>
          {collapsed ? (
            <div className="w-7 h-7 bg-brand-600 rounded-md flex items-center justify-center flex-shrink-0">
              <span className="font-display font-bold text-white text-xs">{orgInitial}</span>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2.5 min-w-0">
                {org?.logo_url ? (
                  <img src={org.logo_url} alt={orgName} className="w-7 h-7 rounded-md object-cover flex-shrink-0" />
                ) : (
                  <div className="w-7 h-7 bg-brand-600 rounded-md flex items-center justify-center flex-shrink-0">
                    <span className="font-display font-bold text-white text-xs">{orgInitial}</span>
                  </div>
                )}
                <div className="min-w-0">
                  <p className="font-display font-bold text-surface-900 dark:text-surface-50 text-sm leading-tight tracking-tight truncate">
                    {orgName}
                  </p>
                  <p className="text-[10px] text-surface-400 dark:text-surface-500 leading-tight">
                    Powered by CashMyRent
                  </p>
                </div>
              </div>
              <button onClick={onClose} className="lg:hidden p-1.5 text-surface-400 hover:text-surface-600 rounded-md transition-colors flex-shrink-0">
                <X size={15} />
              </button>
            </>
          )}
        </div>

        {/* Nav */}
        <nav className={`flex-1 overflow-y-auto py-2 ${collapsed ? 'px-1.5' : 'px-2'}`}>

          {/* Search trigger */}
          {!collapsed ? (
            <button
              onClick={onOpenCmdK}
              className="w-full flex items-center gap-2 px-3 py-2 mb-2 rounded-md text-[13px]
                         text-surface-400 dark:text-surface-500 border border-surface-200 dark:border-white/8
                         bg-surface-50 dark:bg-white/3 hover:bg-surface-100 dark:hover:bg-white/5
                         hover:text-surface-600 dark:hover:text-surface-300 transition-colors"
            >
              <Search size={13} />
              <span className="flex-1 text-left">Quick search…</span>
              <kbd className="text-[10px] font-mono bg-white dark:bg-white/5 border border-surface-200 dark:border-white/10 px-1.5 py-0.5 rounded text-surface-400">⌘K</kbd>
            </button>
          ) : (
            <button onClick={onOpenCmdK} title="Search (⌘K)"
              className="w-full flex justify-center py-2 mb-2 text-surface-400 hover:text-brand-600 dark:hover:text-brand-400 transition-colors">
              <Search size={15} />
            </button>
          )}

          <div className="space-y-0.5 mb-1 pt-1">
            <Item to="/" icon={LayoutDashboard} label={isTeam ? 'My Collections' : 'Dashboard'} exact />
          </div>

          <Section label="Collect">
            <Item to="/payments"             icon={CreditCard}    label="Log Payment" />
            <Item to="/daily-collection"     icon={ListChecks}    label="Collection Tracker" />
            <Item to="/daily-reconciliation" icon={ClipboardList} label="Daily Reconciliation" />
            <Item to="/utility-bills"        icon={Zap}           label="Utility Bills" />
            <Item to="/security-deposits"    icon={Wallet}        label="Security Deposits" />
          </Section>

          <Section label="Manage">
            <Item to="/buildings"      icon={Building2}    label="Buildings & Flats" />
            <Item to="/owners"         icon={Home}         label="Building Owners" />
            <Item to="/tenants"        icon={Users}        label="Tenants" />
            <Item to="/owner-payments" icon={Banknote}     label="Owner Payments" />
            <Item to="/expenses"       icon={TrendingDown} label="Expenses" />
            <Item to="/staff"          icon={UserCog}      label="Staff & Salary" />
          </Section>

          <Section label="Reports">
            <Item to="/reports" icon={BarChart3} label="Reports" />
          </Section>

          {(isSuperAdmin || isAdmin) && (
            <Section label="Admin">
              {isSuperAdmin && <Item to="/audit"   icon={ShieldCheck} label="Audit" />}
              <Item to="/checkin"  icon={LogIn}    label="Check In" />
              <Item to="/checkout" icon={LogOut}   label="Check Out" />
              <Item to="/settings" icon={Settings} label="Settings" />
            </Section>
          )}
        </nav>

        {/* Footer */}
        <div className="border-t border-surface-200 dark:border-white/5 px-2 py-2 space-y-0.5">
          {/* Dark mode toggle */}
          <button
            onClick={toggleDark}
            title={dark ? 'Light mode' : 'Dark mode'}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] font-medium
              text-surface-500 hover:text-surface-800 hover:bg-surface-100
              dark:text-surface-400 dark:hover:text-surface-100 dark:hover:bg-white/5
              transition-all duration-150 ${collapsed ? 'justify-center' : ''}`}
          >
            {dark
              ? <Sun  size={14} className="flex-shrink-0 text-amber-500" />
              : <Moon size={14} className="flex-shrink-0 text-surface-400" />}
            {!collapsed && (dark ? 'Light mode' : 'Dark mode')}
          </button>

          {/* Collapse (desktop only) */}
          <button
            onClick={onToggleCollapse}
            title={collapsed ? 'Expand' : 'Collapse'}
            className={`hidden lg:flex w-full items-center gap-2.5 px-3 py-2 rounded-md text-[13px] font-medium
              text-surface-400 hover:text-surface-700 hover:bg-surface-100
              dark:text-surface-500 dark:hover:text-surface-300 dark:hover:bg-white/5
              transition-all duration-150 ${collapsed ? 'justify-center' : ''}`}
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
            {!collapsed && 'Collapse'}
          </button>

          {/* User row */}
          {!collapsed ? (
            <div className="flex items-center gap-2.5 px-3 py-2">
              <div className="w-7 h-7 rounded-full bg-brand-600 flex items-center justify-center text-white font-semibold text-xs flex-shrink-0">
                {initials(profile?.full_name || 'U')}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-surface-800 dark:text-surface-200 truncate leading-tight">
                  {profile?.full_name || 'User'}
                </p>
                <p className="text-[10px] text-surface-400 dark:text-surface-500 capitalize leading-tight">
                  {profile?.role?.replace('_', ' ')}
                </p>
              </div>
              <button onClick={signOut} title="Sign out"
                className="p-1.5 text-surface-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors flex-shrink-0">
                <LogOut size={13} />
              </button>
            </div>
          ) : (
            <button onClick={signOut} title="Sign out"
              className="w-full flex justify-center py-2 text-surface-400 hover:text-red-500 transition-colors">
              <LogOut size={13} />
            </button>
          )}
        </div>
      </aside>
    </>
  )
}
