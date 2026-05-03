import { useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { Spinner } from '@/components/ui'
import toast from 'react-hot-toast'

export default function Login() {
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
    <div className="min-h-screen flex items-center justify-center p-4"
      style={{
        background: 'radial-gradient(ellipse at 30% 30%, rgba(245,158,11,0.06) 0%, transparent 60%), radial-gradient(ellipse at 70% 70%, rgba(16,185,129,0.04) 0%, transparent 60%), #080d1a'
      }}
    >
      {/* Background dots */}
      <div className="absolute inset-0 bg-dot-pattern bg-dot-md opacity-40 pointer-events-none" />

      <div className="relative w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-brand-500 rounded-2xl shadow-glow-amber mb-4">
            <span className="font-display font-bold text-surface-950 text-3xl">M</span>
          </div>
          <h1 className="font-display font-bold text-surface-50 text-3xl">Manage My Rent</h1>
          <p className="text-surface-500 text-sm mt-1">Rent N Stay · Property Cash Flow</p>
        </div>

        {/* Form */}
        <div className="card p-8">
          <h2 className="font-display font-semibold text-surface-200 text-lg mb-6">Sign in to continue</h2>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="form-group">
              <label className="label">Email address</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@rentnstay.com"
                className="input"
                autoComplete="email"
                required
              />
            </div>

            <div className="form-group">
              <label className="label">Password</label>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="input pr-12"
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPass(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-500 hover:text-surface-300 text-xs"
                >
                  {showPass ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading ? <Spinner size={18} /> : 'Sign In'}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-surface-800">
            <p className="text-surface-600 text-xs text-center">
              Access restricted to authorised Rent N Stay personnel only.
            </p>
          </div>
        </div>

        <p className="text-center text-surface-700 text-xs mt-6">
          MMR v1.0 · © {new Date().getFullYear()} Rent N Stay
        </p>
      </div>
    </div>
  )
}
