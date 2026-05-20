import { NavLink } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { LayoutDashboard, CreditCard, ListChecks, BarChart3, Zap } from 'lucide-react'

export default function BottomNav() {
  const { profile } = useAuth()
  const isTeam = profile?.role === 'team'

  const items = isTeam ? [
    { to: '/',                   icon: LayoutDashboard, label: 'Home',    exact: true },
    { to: '/payments',           icon: CreditCard,      label: 'Pay' },
    { to: '/daily-collection',   icon: ListChecks,      label: 'Collect' },
    { to: '/utility-bills',      icon: Zap,             label: 'Bills' },
  ] : [
    { to: '/',                   icon: LayoutDashboard, label: 'Dashboard', exact: true },
    { to: '/payments',           icon: CreditCard,      label: 'Payments' },
    { to: '/daily-collection',   icon: ListChecks,      label: 'Tracker' },
    { to: '/reports',            icon: BarChart3,       label: 'Reports' },
  ]

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white dark:bg-surface-900 border-t border-surface-200 dark:border-white/5 pb-safe">
      <div className="flex items-stretch h-[58px]">
        {items.map(({ to, icon: Icon, label, exact }) => (
          <NavLink
            key={to}
            to={to}
            end={exact}
            className={({ isActive }) => `
              flex-1 flex flex-col items-center justify-center gap-0.5
              text-[10px] font-medium transition-colors duration-150
              ${isActive
                ? 'text-brand-600 dark:text-brand-400'
                : 'text-surface-400 dark:text-surface-500 hover:text-surface-600 dark:hover:text-surface-300'
              }
            `}
          >
            {({ isActive }) => (
              <>
                <div className={`p-1 rounded-lg transition-colors ${isActive ? 'bg-brand-50 dark:bg-brand-900/30' : ''}`}>
                  <Icon size={19} strokeWidth={isActive ? 2.2 : 1.8} />
                </div>
                <span>{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
