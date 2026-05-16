import { useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import toast from 'react-hot-toast'

export default function Login() {
  const wasAutoLoggedOut = window.__cmrAutoLogout
  if (wasAutoLoggedOut) { window.__cmrAutoLogout = false }

  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPass, setShowPass] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!email || !password) return toast.error('Fill in all fields')
    setLoading(true)
    const { error } = await signIn(email, password)
    setLoading(false)
    if (error) toast.error(error.message || 'Login failed')
  }

  return (
    <div className="min-h-screen flex bg-white">

      {/* Left panel */}
      <div className="hidden lg:flex w-[420px] flex-shrink-0 bg-brand-700 flex-col justify-between p-10">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-white/20 rounded-md flex items-center justify-center">
            <span className="font-display font-bold text-white text-xs">M</span>
          </div>
          <span className="font-display font-bold text-white text-sm">CashMyRent</span>
        </div>

        <div>
          <p className="text-brand-200 text-xs font-medium uppercase tracking-widest mb-4">Rent N Stay</p>
          <h2 className="text-white font-display font-bold text-3xl leading-snug mb-3">
            Your property<br />cash flow,<br />under control.
          </h2>
          <p className="text-brand-200 text-sm leading-relaxed">
            Track rent collections, owner payments, expenses, staff salaries — all in one place.
          </p>
        </div>

        <p className="text-brand-300 text-xs">CashMyRent v1.0 · © {new Date().getFullYear()} Rent N Stay</p>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm">

          {/* Mobile brand */}
          <div className="flex items-center gap-2.5 mb-8 lg:hidden">
            <div className="w-7 h-7 bg-brand-600 rounded-md flex items-center justify-center">
              <span className="font-display font-bold text-white text-xs">M</span>
            </div>
            <span className="font-display font-bold text-surface-900 text-sm">CashMyRent</span>
          </div>

          <div className="mb-8">
            <h1 className="font-display font-bold text-surface-900 text-2xl mb-1">Sign in</h1>
            <p className="text-surface-500 text-sm">Access restricted to Rent N Stay team.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Email address</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@rentnstay.in" className="input" autoComplete="email" required />
            </div>

            <div>
              <label className="label">Password</label>
              <div className="relative">
                <input type={showPass ? 'text' : 'password'} value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••" className="input pr-14"
                  autoComplete="current-password" required />
                <button type="button" onClick={() => setShowPass(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-surface-400 hover:text-surface-600 font-medium">
                  {showPass ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <button type="submit" disabled={loading}
              className="w-full btn-primary py-2.5 mt-2 justify-center">
              {loading
                ? <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Signing in…
                  </span>
                : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
