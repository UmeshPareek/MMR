import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import toast from 'react-hot-toast'
import { Building2, CheckCircle2, Eye, EyeOff, ArrowRight, Loader2 } from 'lucide-react'

const STEPS = ['Your details', 'Create account', 'You\'re in!']

const PLAN_FEATURES = [
  '14-day free trial — no credit card needed',
  'Unlimited rent collection during trial',
  'Staff salary & expense tracking',
  'Detailed reports & exports',
]

export default function Signup() {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [form, setForm] = useState({
    full_name: '', company_name: '', phone: '',
    email: '', password: '',
  })

  function set(field, value) { setForm(f => ({ ...f, [field]: value })) }

  async function handleStep0() {
    if (!form.full_name.trim()) return toast.error('Enter your full name')
    if (!form.company_name.trim()) return toast.error('Enter your company / property name')
    setStep(1)
  }

  async function handleStep1() {
    if (!form.email.trim()) return toast.error('Enter your email')
    if (form.password.length < 8) return toast.error('Password must be at least 8 characters')
    setLoading(true)
    try {
      const res = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.email.trim().toLowerCase(),
          password: form.password,
          full_name: form.full_name.trim(),
          company_name: form.company_name.trim(),
          phone: form.phone.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Signup failed'); setLoading(false); return }

      // Auto sign-in
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: form.email.trim().toLowerCase(),
        password: form.password,
      })
      if (signInError) {
        toast.error('Account created — please sign in.')
        navigate('/login')
        return
      }
      setStep(2)
    } catch {
      toast.error('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* Left — value prop */}
      <div className="hidden lg:flex lg:w-2/5 bg-gradient-to-br from-brand-700 via-brand-600 to-brand-500 p-12 flex-col justify-between text-white">
        <div>
          <div className="flex items-center gap-2.5 mb-14">
            <div className="w-9 h-9 bg-white/20 rounded-xl flex items-center justify-center">
              <Building2 size={20} className="text-white" />
            </div>
            <span className="text-xl font-bold tracking-tight">CashMyRent</span>
          </div>
          <h1 className="text-4xl font-bold leading-tight mb-4">
            Property management<br />made simple.
          </h1>
          <p className="text-brand-100 text-lg mb-10">
            Collect rent, track expenses, manage staff — all in one place.
          </p>
          <div className="space-y-4">
            {PLAN_FEATURES.map(f => (
              <div key={f} className="flex items-start gap-3">
                <CheckCircle2 size={18} className="text-brand-200 mt-0.5 shrink-0" />
                <span className="text-brand-50 text-sm">{f}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="text-brand-200 text-xs">© {new Date().getFullYear()} CashMyRent · Trusted by property managers across India</p>
      </div>

      {/* Right — form */}
      <div className="flex-1 flex items-center justify-center p-6 bg-surface-50">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="flex items-center gap-2 mb-8 lg:hidden">
            <div className="w-8 h-8 bg-brand-600 rounded-xl flex items-center justify-center">
              <Building2 size={16} className="text-white" />
            </div>
            <span className="text-lg font-bold text-surface-900">CashMyRent</span>
          </div>

          {/* Step indicators */}
          {step < 2 && (
            <div className="flex items-center gap-2 mb-8">
              {STEPS.slice(0, 2).map((s, i) => (
                <div key={s} className="flex items-center gap-2">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                    i < step ? 'bg-brand-600 text-white' :
                    i === step ? 'bg-brand-600 text-white ring-4 ring-brand-100' :
                    'bg-surface-200 text-surface-500'
                  }`}>
                    {i < step ? '✓' : i + 1}
                  </div>
                  <span className={`text-sm font-medium ${i === step ? 'text-surface-800' : 'text-surface-400'}`}>{s}</span>
                  {i < 1 && <div className={`h-px w-6 ${i < step ? 'bg-brand-400' : 'bg-surface-200'}`} />}
                </div>
              ))}
            </div>
          )}

          <div className="bg-white rounded-2xl border border-surface-200 shadow-sm p-8">
            {/* Step 0 — details */}
            {step === 0 && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-2xl font-bold text-surface-900">Start your free trial</h2>
                  <p className="text-surface-500 text-sm mt-1">14 days free · No credit card needed</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-surface-700 mb-1.5">Your full name</label>
                  <input
                    className="input"
                    placeholder="Raj Kumar"
                    value={form.full_name}
                    onChange={e => set('full_name', e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleStep0()}
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-surface-700 mb-1.5">Company / Property name</label>
                  <input
                    className="input"
                    placeholder="Sunshine Residency"
                    value={form.company_name}
                    onChange={e => set('company_name', e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleStep0()}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-surface-700 mb-1.5">Phone <span className="text-surface-400">(optional)</span></label>
                  <input
                    className="input"
                    placeholder="+91 98765 43210"
                    type="tel"
                    value={form.phone}
                    onChange={e => set('phone', e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleStep0()}
                  />
                </div>
                <button onClick={handleStep0} className="btn-primary w-full flex items-center justify-center gap-2">
                  Continue <ArrowRight size={16} />
                </button>
                <p className="text-center text-sm text-surface-500">
                  Already have an account?{' '}
                  <Link to="/login" className="text-brand-600 font-medium hover:underline">Sign in</Link>
                </p>
              </div>
            )}

            {/* Step 1 — email + password */}
            {step === 1 && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-2xl font-bold text-surface-900">Create your login</h2>
                  <p className="text-surface-500 text-sm mt-1">For <span className="font-medium text-surface-700">{form.company_name}</span></p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-surface-700 mb-1.5">Email address</label>
                  <input
                    className="input"
                    type="email"
                    placeholder="you@company.com"
                    value={form.email}
                    onChange={e => set('email', e.target.value)}
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-surface-700 mb-1.5">Password</label>
                  <div className="relative">
                    <input
                      className="input pr-10"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="At least 8 characters"
                      value={form.password}
                      onChange={e => set('password', e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleStep1()}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400 hover:text-surface-600"
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  {form.password.length > 0 && form.password.length < 8 && (
                    <p className="text-xs text-red-500 mt-1">{8 - form.password.length} more characters needed</p>
                  )}
                </div>
                <button onClick={handleStep1} disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2">
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <>Create account <ArrowRight size={16} /></>}
                </button>
                <button onClick={() => setStep(0)} className="w-full text-sm text-surface-500 hover:text-surface-700">
                  ← Back
                </button>
                <p className="text-xs text-surface-400 text-center leading-relaxed">
                  By signing up you agree to our Terms of Service and Privacy Policy.
                </p>
              </div>
            )}

            {/* Step 2 — success */}
            {step === 2 && (
              <div className="text-center py-4 space-y-5">
                <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto">
                  <CheckCircle2 size={32} className="text-emerald-600" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-surface-900">You're all set!</h2>
                  <p className="text-surface-500 text-sm mt-2">
                    Welcome to CashMyRent, <strong>{form.full_name.split(' ')[0]}</strong>.<br />
                    Your 14-day trial is active.
                  </p>
                </div>
                <div className="bg-brand-50 rounded-xl p-4 text-left space-y-2">
                  <p className="text-sm font-semibold text-brand-800">What to do next:</p>
                  <p className="text-sm text-brand-700">1. Add your first building</p>
                  <p className="text-sm text-brand-700">2. Add flats and owners</p>
                  <p className="text-sm text-brand-700">3. Check in your first tenant</p>
                </div>
                <button
                  onClick={() => navigate('/')}
                  className="btn-primary w-full"
                >
                  Go to dashboard
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
