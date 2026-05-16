import { useState, useEffect, useRef } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import toast from 'react-hot-toast'

// Animated mesh background using canvas
function AnimatedBackground() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let animId
    let w, h

    const TEAL = { r: 13, g: 148, b: 136 }
    const nodes = []
    const COUNT = 55

    function resize() {
      w = canvas.width = canvas.offsetWidth
      h = canvas.height = canvas.offsetHeight
    }

    function initNodes() {
      nodes.length = 0
      for (let i = 0; i < COUNT; i++) {
        nodes.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.35,
          vy: (Math.random() - 0.5) * 0.35,
          r: Math.random() * 2.5 + 1,
          opacity: Math.random() * 0.5 + 0.2,
        })
      }
    }

    resize()
    initNodes()
    window.addEventListener('resize', () => { resize(); initNodes() })

    function draw() {
      ctx.clearRect(0, 0, w, h)

      // Draw connections
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x
          const dy = nodes[i].y - nodes[j].y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < 140) {
            const alpha = (1 - dist / 140) * 0.18
            ctx.beginPath()
            ctx.strokeStyle = `rgba(${TEAL.r},${TEAL.g},${TEAL.b},${alpha})`
            ctx.lineWidth = 0.8
            ctx.moveTo(nodes[i].x, nodes[i].y)
            ctx.lineTo(nodes[j].x, nodes[j].y)
            ctx.stroke()
          }
        }
      }

      // Draw nodes
      nodes.forEach(n => {
        ctx.beginPath()
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${TEAL.r},${TEAL.g},${TEAL.b},${n.opacity})`
        ctx.fill()

        // Move
        n.x += n.vx
        n.y += n.vy
        if (n.x < -20) n.x = w + 20
        if (n.x > w + 20) n.x = -20
        if (n.y < -20) n.y = h + 20
        if (n.y > h + 20) n.y = -20
      })

      animId = requestAnimationFrame(draw)
    }

    draw()
    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute', inset: 0,
        width: '100%', height: '100%',
        display: 'block',
      }}
    />
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
        <AnimatedBackground />

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

          {/* Mini stats */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 36 }}>
            {[
              { val: '₹44L+', label: 'Monthly tracked' },
              { val: '204+', label: 'Active tenants' },
              { val: '98%', label: 'Collection rate' },
              { val: '5 types', label: 'Fraud detection' },
            ].map(({ val, label }) => (
              <div key={label} style={{
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 12, padding: '14px 16px',
                backdropFilter: 'blur(4px)',
              }}>
                <p style={{ color: '#fff', fontWeight: 700, fontSize: 18, fontVariantNumeric: 'tabular-nums' }}>{val}</p>
                <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 2 }}>{label}</p>
              </div>
            ))}
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
