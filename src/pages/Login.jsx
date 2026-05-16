import { useState, useEffect, useRef } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import toast from 'react-hot-toast'

// Video/image background slot — drop your city video or image here
// To use a video: place your .mp4 file in /public/city.mp4
// To use an image: place your image in /public/city.jpg
function MediaBackground() {
  return (
    <>
      {/* ─── DROP YOUR VIDEO FILE HERE ─────────────────────
          Place a city aerial video at: /public/city.mp4
          It will loop silently behind the content.
          ─────────────────────────────────────────────── */}
      <video
        autoPlay muted loop playsInline
        style={{
          position: 'absolute', inset: 0,
          width: '100%', height: '100%',
          objectFit: 'cover',
        }}
        onError={e => e.target.style.display = 'none'}
      >
        <source src="/city.mp4" type="video/mp4" />
      </video>

      {/* Dark teal overlay so text stays readable */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(160deg, rgba(6,95,70,0.82) 0%, rgba(13,148,136,0.75) 100%)',
      }} />
    </>
  )
}

export default function Login() {
  const wasAutoLoggedOut = window.__cmrAutoLogout
  if (wasAutoLoggedOut) window.__cmrAutoLogout = false

  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPass, setShowPass] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!email || !password) return toast.error('Please enter your email and password')
    setLoading(true)
    const { error } = await signIn(email, password)
    setLoading(false)
    if (error) toast.error(error.message?.includes('Invalid') ? 'Incorrect email or password' : error.message || 'Login failed')
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: '#fff' }}>

      {/* ── Left panel — animated ── */}
      <div style={{
        display: 'none',
        width: 480,
        flexShrink: 0,
        background: 'linear-gradient(160deg, #0D9488 0%, #065F46 100%)',
        position: 'relative',
        overflow: 'hidden',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '44px 48px',
      }} className="login-left">
        <MediaBackground />

        {/* Content over canvas */}
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 34, height: 34,
              background: 'rgba(255,255,255,0.15)',
              borderRadius: 10,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              backdropFilter: 'blur(4px)',
              border: '1px solid rgba(255,255,255,0.2)',
            }}>
              <span style={{ color: '#fff', fontWeight: 700, fontSize: 16 }}>₹</span>
            </div>
            <span style={{ color: '#fff', fontWeight: 700, fontSize: 17, letterSpacing: '-0.02em' }}>CashMyRent</span>
          </div>
        </div>

        <div style={{ position: 'relative', zIndex: 1 }}>
          <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 20 }}>
            Property Management
          </p>
          <h2 style={{ color: '#fff', fontSize: 34, fontWeight: 800, lineHeight: 1.15, marginBottom: 16, letterSpacing: '-0.02em' }}>
            Every rupee,<br />accounted for.
          </h2>
          <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 15, lineHeight: 1.7, maxWidth: 320 }}>
            Collect rent, detect fraud, manage staff, and understand your P&amp;L — all in one place. Built for serious property managers.
          </p>

          {/* Subtle tagline instead of stats */}
          <div style={{ marginTop: 36 }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 100, padding: '8px 16px',
              backdropFilter: 'blur(4px)',
            }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#5ECFCB' }} />
              <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: 13, fontWeight: 500 }}>
                Trusted by property managers across India
              </p>
            </div>
          </div>
        </div>

        <div style={{ position: 'relative', zIndex: 1 }}>
          <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>
            © {new Date().getFullYear()} CashMyRent · All rights reserved
          </p>
        </div>
      </div>

      {/* ── Right panel — form ── */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ width: '100%', maxWidth: 380 }}>

          {/* Mobile logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 40 }} className="mobile-logo">
            <div style={{
              width: 34, height: 34, background: '#0D9488',
              borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ color: '#fff', fontWeight: 700, fontSize: 16 }}>₹</span>
            </div>
            <span style={{ fontWeight: 700, fontSize: 17, letterSpacing: '-0.02em', color: '#0C0C0C' }}>CashMyRent</span>
          </div>

          {wasAutoLoggedOut && (
            <div style={{
              marginBottom: 20, padding: '12px 16px',
              background: '#FFFBEB', border: '1px solid #FCD34D',
              borderRadius: 10, fontSize: 13, color: '#92400E',
            }}>
              You were signed out after 30 minutes of inactivity.
            </div>
          )}

          <div style={{ marginBottom: 32 }}>
            <h1 style={{ fontSize: 26, fontWeight: 700, color: '#0C0C0C', marginBottom: 6, letterSpacing: '-0.02em' }}>
              Welcome back
            </h1>
            <p style={{ fontSize: 14, color: '#888', lineHeight: 1.5 }}>
              Sign in to your CashMyRent workspace
            </p>
          </div>

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#444', marginBottom: 6 }}>
                Email address
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@company.com"
                autoComplete="email"
                required
                style={{
                  width: '100%', padding: '11px 14px',
                  border: '1px solid #E2E8F0', borderRadius: 10,
                  fontSize: 15, color: '#0C0C0C', outline: 'none',
                  transition: 'border-color .15s',
                  fontFamily: 'inherit',
                }}
                onFocus={e => e.target.style.borderColor = '#0D9488'}
                onBlur={e => e.target.style.borderColor = '#E2E8F0'}
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#444', marginBottom: 6 }}>
                Password
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                  style={{
                    width: '100%', padding: '11px 50px 11px 14px',
                    border: '1px solid #E2E8F0', borderRadius: 10,
                    fontSize: 15, color: '#0C0C0C', outline: 'none',
                    transition: 'border-color .15s',
                    fontFamily: 'inherit',
                  }}
                  onFocus={e => e.target.style.borderColor = '#0D9488'}
                  onBlur={e => e.target.style.borderColor = '#E2E8F0'}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(v => !v)}
                  style={{
                    position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                    fontSize: 12, fontWeight: 600, color: '#888', background: 'none',
                    border: 'none', cursor: 'pointer', padding: '4px 8px',
                    fontFamily: 'inherit',
                  }}
                >
                  {showPass ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%', padding: '13px',
                background: loading ? '#5ECFCB' : '#0D9488',
                color: '#fff', fontWeight: 600, fontSize: 15,
                border: 'none', borderRadius: 10, cursor: loading ? 'not-allowed' : 'pointer',
                transition: 'background .15s', fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
              onMouseOver={e => { if (!loading) e.currentTarget.style.background = '#0A8F82' }}
              onMouseOut={e => { if (!loading) e.currentTarget.style.background = '#0D9488' }}
            >
              {loading ? (
                <>
                  <span style={{
                    width: 16, height: 16, borderRadius: '50%',
                    border: '2px solid rgba(255,255,255,0.3)',
                    borderTopColor: '#fff', display: 'inline-block',
                    animation: 'spin .7s linear infinite',
                  }} />
                  Signing in…
                </>
              ) : 'Sign in'}
            </button>
          </form>

          <p style={{ marginTop: 28, textAlign: 'center', fontSize: 13, color: '#BBB' }}>
            Need access?{' '}
            <a href="mailto:hello@cashmyrent.com" style={{ color: '#0D9488', fontWeight: 500, textDecoration: 'none' }}>
              Contact your admin
            </a>
          </p>
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg) } }
        .login-left { display: none !important }
        @media (min-width: 900px) {
          .login-left { display: flex !important }
          .mobile-logo { display: none !important }
        }
      `}</style>
    </div>
  )
}
