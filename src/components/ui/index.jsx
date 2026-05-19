import { X, Loader2, AlertTriangle, CheckCircle2, Info } from 'lucide-react'

// ─── Modal ─────────────────────────────────────────────────────────────────
export function Modal({ open, onClose, title, children, size = 'md' }) {
  if (!open) return null
  const sizes = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl', full: 'max-w-6xl' }
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={`modal-content ${sizes[size]} max-h-[90vh] flex flex-col`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-800 shrink-0">
          <h2 className="font-display font-semibold text-surface-50 text-lg">{title}</h2>
          <button onClick={onClose} className="text-surface-500 hover:text-surface-200 p-1 rounded transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto flex-1">
          {children}
        </div>
      </div>
    </div>
  )
}

// ─── Spinner ───────────────────────────────────────────────────────────────
export function Spinner({ size = 20, className = '' }) {
  return <Loader2 size={size} className={`animate-spin text-brand-500 ${className}`} />
}

// ─── Empty State ───────────────────────────────────────────────────────────
export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      {Icon && <Icon size={40} className="text-surface-700 mb-4" />}
      <h3 className="text-surface-400 font-semibold text-base mb-1">{title}</h3>
      {description && <p className="text-surface-600 text-sm max-w-xs">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

// ─── Stats Card ────────────────────────────────────────────────────────────
export function StatCard({ label, value, sub, trend, icon: Icon, color = 'amber', loading = false }) {
  const colorMap = {
    amber: 'text-brand-400 bg-brand-500/10 border-brand-500/20',
    green: 'text-income bg-income/10 border-income/20',
    red: 'text-expense bg-expense/10 border-expense/20',
    blue: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
    purple: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
  }

  return (
    <div className="stat-card animate-slide-up">
      <div className="flex items-start justify-between">
        <p className="text-surface-500 text-xs font-medium uppercase tracking-wider">{label}</p>
        {Icon && (
          <div className={`p-2 rounded-lg border ${colorMap[color]}`}>
            <Icon size={16} />
          </div>
        )}
      </div>
      {loading ? (
        <div className="skeleton h-8 w-28 mt-1" />
      ) : (
        <p className="text-2xl font-display font-bold text-surface-50 mt-1">{value}</p>
      )}
      {sub && <p className="text-surface-600 text-xs">{sub}</p>}
      {trend !== undefined && (
        <p className={`text-xs font-medium ${trend >= 0 ? 'text-income' : 'text-expense'}`}>
          {trend >= 0 ? '↑' : '↓'} {Math.abs(trend)}% vs last month
        </p>
      )}
    </div>
  )
}

// ─── Badge ─────────────────────────────────────────────────────────────────
export function Badge({ children, variant = 'default', className = '' }) {
  const variants = {
    default: 'bg-surface-700 text-surface-300',
    success: 'bg-income/10 text-income border border-income/20',
    danger: 'bg-expense/10 text-expense border border-expense/20',
    warning: 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20',
    info: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
    brand: 'bg-brand-500/10 text-brand-400 border border-brand-500/20',
    purple: 'bg-purple-500/10 text-purple-400 border border-purple-500/20',
    pink: 'bg-pink-500/10 text-pink-400 border border-pink-500/20',
  }
  return (
    <span className={`badge ${variants[variant]} ${className}`}>{children}</span>
  )
}

// ─── Confirm Dialog ────────────────────────────────────────────────────────
export function ConfirmDialog({ open, onClose, onConfirm, title, message, danger = false, loading = false }) {
  if (!open) return null
  return (
    <div className="modal-overlay">
      <div className="modal-content max-w-sm p-6">
        <div className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4 ${danger ? 'bg-expense/10' : 'bg-brand-500/10'}`}>
          <AlertTriangle size={24} className={danger ? 'text-expense' : 'text-brand-400'} />
        </div>
        <h3 className="text-center font-display font-semibold text-surface-50 text-lg mb-2">{title}</h3>
        <p className="text-center text-surface-400 text-sm mb-6">{message}</p>
        <div className="flex gap-3">
          <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`flex-1 btn ${danger ? 'btn-danger' : 'btn-primary'}`}
          >
            {loading ? <Spinner size={16} /> : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Alert ─────────────────────────────────────────────────────────────────
export function Alert({ type = 'info', children }) {
  const styles = {
    info: { bg: 'bg-blue-500/10 border-blue-500/30', text: 'text-blue-300', Icon: Info },
    success: { bg: 'bg-income/10 border-income/30', text: 'text-income', Icon: CheckCircle2 },
    warning: { bg: 'bg-yellow-500/10 border-yellow-500/30', text: 'text-yellow-300', Icon: AlertTriangle },
    error: { bg: 'bg-expense/10 border-expense/30', text: 'text-expense', Icon: AlertTriangle },
  }
  const { bg, text, Icon } = styles[type]
  return (
    <div className={`flex items-start gap-3 p-4 rounded-xl border ${bg}`}>
      <Icon size={16} className={`${text} shrink-0 mt-0.5`} />
      <p className={`text-sm ${text}`}>{children}</p>
    </div>
  )
}

// ─── Month Picker ──────────────────────────────────────────────────────────
export function MonthPicker({ value, onChange, label = 'Month' }) {
  return (
    <div className="form-group">
      <label className="label">{label}</label>
      <input
        type="month"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="input"
      />
    </div>
  )
}

// ─── Search Input ──────────────────────────────────────────────────────────
export function SearchInput({ value, onChange, placeholder = 'Search…' }) {
  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="input pl-9 max-w-xs"
      />
      <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-500 w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
    </div>
  )
}

// ─── Payment Mode Badge ────────────────────────────────────────────────────
export function PaymentModeBadge({ mode }) {
  const MODES = {
    cash: { label: 'Cash', variant: 'warning' },
    upi: { label: 'UPI', variant: 'info' },
    bank_transfer: { label: 'Bank Transfer', variant: 'success' },
    rentok: { label: 'RentOK', variant: 'purple' },
    crib: { label: 'Crib', variant: 'pink' },
    cheque: { label: 'Cheque', variant: 'brand' },
    online: { label: 'Online', variant: 'info' },
    card: { label: 'Card', variant: 'brand' },
    other: { label: 'Other', variant: 'default' },
  }
  const m = MODES[mode] || { label: mode, variant: 'default' }
  return <Badge variant={m.variant}>{m.label}</Badge>
}

// ─── Skeleton Loaders ─────────────────────────────────────────────────────
export function SkeletonStat() {
  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div className="skeleton h-3 w-20 rounded" />
        <div className="skeleton h-8 w-8 rounded-lg" />
      </div>
      <div className="skeleton h-8 w-28 rounded" />
      <div className="skeleton h-3 w-16 rounded" />
    </div>
  )
}

export function SkeletonTable({ rows = 5 }) {
  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-surface-100 dark:border-surface-700">
        <div className="skeleton h-4 w-32 rounded" />
      </div>
      <div className="divide-y divide-surface-100 dark:divide-surface-700">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3">
            <div className="skeleton h-8 w-8 rounded-full" />
            <div className="flex-1 space-y-2">
              <div className="skeleton h-3 w-40 rounded" />
              <div className="skeleton h-3 w-24 rounded" />
            </div>
            <div className="skeleton h-4 w-20 rounded" />
            <div className="skeleton h-6 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function SkeletonCards({ count = 6 }) {
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="skeleton w-11 h-11 rounded-xl" />
            <div className="space-y-2 flex-1">
              <div className="skeleton h-4 w-32 rounded" />
              <div className="skeleton h-3 w-20 rounded" />
            </div>
          </div>
          <div className="space-y-2">
            <div className="skeleton h-3 w-full rounded" />
            <div className="skeleton h-3 w-3/4 rounded" />
          </div>
          <div className="flex gap-2 pt-1">
            <div className="skeleton h-8 flex-1 rounded-md" />
            <div className="skeleton h-8 w-8 rounded-md" />
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Pagination ────────────────────────────────────────────────────────────
export function Pagination({ page, total, perPage, onChange }) {
  const pages = Math.ceil(total / perPage)
  if (pages <= 1) return null
  return (
    <div className="flex items-center justify-between mt-4">
      <p className="text-surface-500 text-sm">
        Showing {Math.min((page - 1) * perPage + 1, total)}–{Math.min(page * perPage, total)} of {total}
      </p>
      <div className="flex items-center gap-1">
        <button
          disabled={page === 1}
          onClick={() => onChange(page - 1)}
          className="btn-secondary btn-sm disabled:opacity-30"
        >←</button>
        <span className="text-surface-400 text-sm px-3">{page} / {pages}</span>
        <button
          disabled={page === pages}
          onClick={() => onChange(page + 1)}
          className="btn-secondary btn-sm disabled:opacity-30"
        >→</button>
      </div>
    </div>
  )
}
