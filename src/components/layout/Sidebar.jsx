import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import {
  LayoutDashboard, Building2, Users, CreditCard, TrendingDown,
  UserCog, BarChart3, ShieldCheck, Settings, X, LogOut,
  Home, Banknote, Zap, Wallet, ListChecks, ClipboardList, Shield, LogIn
} from 'lucide-react'
import { initials } from '@/utils/helpers'

export default function Sidebar({ open, onClose }) {
  const { profile, signOut, isSuperAdmin, isAdmin } = useAuth()
  const isTeam = profile?.role === 'team'

  const link = ({ isActive }) => [
    'group flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-all duration-150 relative',
    isActive
      ? 'bg-brand-50 text-brand-700 font-semibold'
      : 'text-surface-500 hover:text-surface-900 hover:bg-surface-100 font-medium'
  ].join(' ')

  const Section = ({ label, children }) => (
    <div className="mb-1">
      <p className="text-[10px] font-semibold text-surface-400 uppercase tracking-widest px-3 pt-4 pb-1.5">{label}</p>
      <div className="space-y-0.5">{children}</div>
    </div>
  )

  const Item = ({ to, icon: Icon, label, exact }) => (
    <NavLink to={to} end={exact} className={link} onClick={onClose}>
      {({ isActive }) => (
        <>
          {isActive && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-brand-600 rounded-full" />}
          <Icon size={15} className="flex-shrink-0" />
          {label}
        </>
      )}
    </NavLink>
  )

  return (
    <>
      {open && <div className="fixed inset-0 bg-black/20 z-30 lg:hidden" onClick={onClose} />}
      <aside className={`
        fixed top-0 left-0 h-full w-60 bg-white z-40 flex flex-col border-r border-surface-200
        transition-transform duration-250 ease-in-out
        ${open ? 'translate-x-0' : '-translate-x-full'}
        lg:translate-x-0 lg:static lg:z-auto
      `}>

        {/* Brand */}
        <div className="flex items-center justify-between h-14 px-4 border-b border-surface-200">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 bg-brand-600 rounded-md flex items-center justify-center flex-shrink-0">
              <span className="font-display font-bold text-white text-xs">M</span>
            </div>
            <div>
              <p className="font-display font-bold text-surface-900 text-sm leading-tight">CashMyRent</p>
              <p className="text-[10px] text-surface-400 leading-tight">Rent N Stay</p>
            </div>
          </div>
          <button onClick={onClose} className="lg:hidden p-1 text-surface-400 hover:text-surface-600"><X size={16} /></button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-2 py-2">

          {/* HOME — role-aware */}
          <div className="space-y-0.5 mb-1 pt-2">
            <Item to="/" icon={LayoutDashboard} label={isTeam ? 'My Collections' : 'Dashboard'} exact />
          </div>

          {/* COLLECT — what team uses daily */}
          <Section label="Collect">
            <Item to="/payments" icon={CreditCard} label="Log Payment" />
            <Item to="/daily-collection" icon={ListChecks} label="Collection Tracker" />
            <Item to="/daily-reconciliation" icon={ClipboardList} label="Daily Reconciliation" />
            <Item to="/utility-bills" icon={Zap} label="Utility Bills" />
            <Item to="/security-deposits" icon={Wallet} label="Security Deposits" />
          </Section>

          {/* MANAGE — admin / team can see */}
          <Section label="Manage">
            <Item to="/buildings" icon={Building2} label="Buildings & Flats" />
            <Item to="/owners" icon={Home} label="Building Owners" />
            <Item to="/tenants" icon={Users} label="Tenants" />
            <Item to="/owner-payments" icon={Banknote} label="Owner Payments" />
            <Item to="/expenses" icon={TrendingDown} label="Expenses" />
            <Item to="/staff" icon={UserCog} label="Staff & Salary" />
          </Section>

          {/* REPORTS */}
          <Section label="Reports">
            <Item to="/reports" icon={BarChart3} label="Reports" />
          </Section>

          {/* ADMIN only */}
          {(isSuperAdmin || isAdmin) && (
            <Section label="Admin">
              {isSuperAdmin && <Item to="/audit" icon={ShieldCheck} label="Audit" />}
            <Item to="/checkin" icon={LogIn} label="Check In" />
            <Item to="/checkout" icon={LogOut} label="Check Out" />
              <Item to="/settings" icon={Settings} label="Settings" />
            </Section>
          )}
        </nav>

        {/* User */}
        <div className="border-t border-surface-200 px-3 py-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-brand-600 flex items-center justify-center text-white font-semibold text-xs flex-shrink-0">
              {initials(profile?.full_name || 'U')}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-surface-800 truncate leading-tight">{profile?.full_name || 'User'}</p>
              <p className="text-xs text-surface-400 capitalize leading-tight">{profile?.role?.replace('_', ' ')}</p>
            </div>
            <button onClick={signOut} title="Sign out"
              className="p-1.5 text-surface-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors">
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}
