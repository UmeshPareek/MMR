import { useState, useEffect, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import toast from 'react-hot-toast'

function AnimatedBackground() {
  const canvasRef = useRef(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let animId, w, h
    const nodes = []
    const COUNT = 55
    function resize() { w = canvas.width = canvas.offsetWidth; h = canvas.height = canvas.offsetHeight }
    function initNodes() {
      nodes.length = 0
      for (let i = 0; i < COUNT; i++) nodes.push({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.35, vy: (Math.random() - 0.5) * 0.35,
        r: Math.random() * 2.5 + 1, opacity: Math.random() * 0.5 + 0.2,
      })
    }
    resize(); initNodes()
    // Use named handler so we can remove it properly
    const handleResize = () => { resize(); initNodes() }
    window.addEventListener('resize', handleResize)
    function draw() {
      ctx.clearRect(0, 0, w, h)
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < 140) {
          ctx.beginPath()
          ctx.strokeStyle = `rgba(255,255,255,${(1 - dist / 140) * 0.2})`
          ctx.lineWidth = 0.8
          ctx.moveTo(nodes[i].x, nodes[i].y); ctx.lineTo(nodes[j].x, nodes[j].y); ctx.stroke()
        }
      }
      nodes.forEach(n => {
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(255,255,255,${n.opacity})`; ctx.fill()
        n.x += n.vx; n.y += n.vy
        if (n.x < -20) n.x = w + 20; if (n.x > w + 20) n.x = -20
        if (n.y < -20) n.y = h + 20; if (n.y > h + 20) n.y = -20
      })
      animId = requestAnimationFrame(draw)
    }
    draw()
    return () => { cancelAnimationFrame(animId); window.removeEventListener('resize', handleResize) }
  }, [])
  return <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
}

export default function Login() {
  const wasAutoLoggedOut = sessionStorage.getItem('cmr_auto_logout') === '1'
  if (wasAutoLoggedOut) sessionStorage.removeItem('cmr_auto_logout')

  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPass, setShowPass] = useState(false)
  const [showContact, setShowContact] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!email || !password) return toast.error('Please enter your email and password')
    setLoading(true)
    const { error } = await signIn(email, password)
    setLoading(false)
    if (error) {
      toast.error(error.message?.includes('Invalid') ? 'Incorrect email or password' : error.message || 'Login failed')
    } else {
      navigate('/', { replace: true })
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex' }}>

      {/* ── LEFT — teal + animated mesh ── */}
      <div style={{
        width: 480, flexShrink: 0,
        background: 'linear-gradient(160deg, #065F46 0%, #0D9488 100%)',
        position: 'relative', overflow: 'hidden',
        display: 'none', flexDirection: 'column',
        justifyContent: 'space-between', padding: '44px 48px',
      }} className="login-left">
        <AnimatedBackground />

        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 34, height: 34, background: 'rgba(255,255,255,0.15)',
              borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: '1px solid rgba(255,255,255,0.2)',
            }}>
              <span style={{ color: '#fff', fontWeight: 700, fontSize: 16 }}>₹</span>
            </div>
            <span style={{ color: '#fff', fontWeight: 700, fontSize: 17, letterSpacing: '-0.02em' }}>CashMyRent</span>
          </div>
        </div>

        <div style={{ position: 'relative', zIndex: 1 }}>
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 20 }}>
            Property Management
          </p>
          <h2 style={{ color: '#fff', fontSize: 34, fontWeight: 800, lineHeight: 1.15, marginBottom: 16, letterSpacing: '-0.02em' }}>
            Every rupee,<br />accounted for.
          </h2>
          <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 15, lineHeight: 1.7, maxWidth: 320 }}>
            Collect rent, detect fraud, manage staff, and understand your P&L — all in one place.
          </p>
          <div style={{ marginTop: 36, display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 100, padding: '8px 16px' }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#5ECFCB' }} />
            <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: 13, fontWeight: 500 }}>Trusted by property managers across India</p>
          </div>
        </div>

        <p style={{ position: 'relative', zIndex: 1, color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>
          © {new Date().getFullYear()} CashMyRent · All rights reserved
        </p>
      </div>

      {/* ── RIGHT — city video background + form ── */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>

        <video
          autoPlay muted loop playsInline
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0 }}
          onError={e => e.target.style.display = 'none'}
        >
          <source src="/city.mp4" type="video/mp4" />
        </video>

        <div style={{
          position: 'absolute', inset: 0, zIndex: 1,
          background: 'rgba(255,255,255,0.55)',
          backdropFilter: 'blur(2px)',
        }} />

        {/* Form card */}
        <div style={{
          position: 'relative', zIndex: 2,
          width: '100%', maxWidth: 400,
          margin: '0 24px',
          background: 'rgba(255,255,255,0.85)',
          backdropFilter: 'blur(20px)',
          borderRadius: 20,
          border: '1px solid rgba(255,255,255,0.9)',
          boxShadow: '0 8px 40px rgba(0,0,0,0.12)',
          padding: '44px 40px',
        }}>

          {/* Mobile logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 32 }} className="mobile-logo">
            <div style={{ width: 32, height: 32, background: '#0D9488', borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>₹</span>
            </div>
            <span style={{ fontWeight: 700, fontSize: 16, letterSpacing: '-0.02em', color: '#0C0C0C' }}>CashMyRent</span>
          </div>

          {wasAutoLoggedOut && (
            <div style={{ marginBottom: 20, padding: '12px 16px', background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: 10, fontSize: 13, color: '#92400E' }}>
              Signed out after 30 minutes of inactivity.
            </div>
          )}

          <div style={{ marginBottom: 28 }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0C0C0C', marginBottom: 5, letterSpacing: '-0.02em' }}>Welcome back</h1>
            <p style={{ fontSize: 14, color: '#888' }}>Sign in to your CashMyRent workspace</p>
          </div>

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#444', marginBottom: 6 }}>Email address</label>
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@company.com" autoComplete="email" required
                style={{
                  width: '100%', padding: '11px 14px',
                  border: '1px solid #E2E8F0', borderRadius: 10,
                  fontSize: 15, color: '#0C0C0C', outline: 'none',
                  background: 'rgba(255,255,255,0.8)', fontFamily: 'inherit',
                }}
                onFocus={e => e.target.style.borderColor = '#0D9488'}
                onBlur={e => e.target.style.borderColor = '#E2E8F0'}
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#444', marginBottom: 6 }}>Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPass ? 'text' : 'password'} value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••" autoComplete="current-password" required
                  style={{
                    width: '100%', padding: '11px 50px 11px 14px',
                    border: '1px solid #E2E8F0', borderRadius: 10,
                    fontSize: 15, color: '#0C0C0C', outline: 'none',
                    background: 'rgba(255,255,255,0.8)', fontFamily: 'inherit',
                  }}
                  onFocus={e => e.target.style.borderColor = '#0D9488'}
                  onBlur={e => e.target.style.borderColor = '#E2E8F0'}
                />
                <button type="button" onClick={() => setShowPass(v => !v)} style={{
                  position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                  fontSize: 12, fontWeight: 600, color: '#888', background: 'none',
                  border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                }}>
                  {showPass ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <button type="submit" disabled={loading} style={{
              width: '100%', padding: 13,
              background: loading ? '#5ECFCB' : '#0D9488',
              color: '#fff', fontWeight: 600, fontSize: 15,
              border: 'none', borderRadius: 10,
              cursor: loading ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              transition: 'background .15s',
            }}
              onMouseOver={e => { if (!loading) e.currentTarget.style.background = '#0A8F82' }}
              onMouseOut={e => { if (!loading) e.currentTarget.style.background = '#0D9488' }}
            >
              {loading ? (
                <>
                  <span style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', display: 'inline-block', animation: 'spin .7s linear infinite' }} />
                  Signing in…
                </>
              ) : 'Sign in'}
            </button>
          </form>

          <div style={{ marginTop: 16, textAlign: 'center' }}>
            <p style={{ fontSize: 13, color: '#888' }}>
              New to CashMyRent?{' '}
              <Link to="/signup" style={{ color: '#0D9488', fontWeight: 600, textDecoration: 'none' }}>
                Start free trial
              </Link>
            </p>
          </div>

          <div style={{ marginTop: 16, textAlign: 'center' }}>
            <button
              type="button"
              onClick={() => setShowContact(v => !v)}
              style={{
                fontSize: 13, color: '#999', background: 'none', border: 'none',
                cursor: 'pointer', fontFamily: 'inherit',
                display: 'inline-flex', alignItems: 'center', gap: 5,
                transition: 'color .15s',
              }}
              onMouseOver={e => e.currentTarget.style.color = '#0D9488'}
              onMouseOut={e => e.currentTarget.style.color = '#999'}
            >
              Need access?
              <span style={{
                display: 'inline-block',
                transform: showContact ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform .2s',
                fontSize: 10,
              }}>▾</span>
            </button>

            <div style={{
              overflow: 'hidden',
              maxHeight: showContact ? 120 : 0,
              opacity: showContact ? 1 : 0,
              transition: 'max-height .25s ease, opacity .2s ease',
              marginTop: showContact ? 10 : 0,
            }}>
              <div style={{
                padding: '14px 18px',
                background: 'rgba(13,148,136,0.06)',
                border: '1px solid rgba(13,148,136,0.18)',
                borderRadius: 12,
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                textAlign: 'left',
              }}>
                <div style={{
                  width: 34, height: 34, flexShrink: 0,
                  background: 'rgba(13,148,136,0.12)',
                  borderRadius: 9,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 16,
                }}>🔐</div>
                <div>
                  <p style={{ fontSize: 12, fontWeight: 600, color: '#0D9488', marginBottom: 3 }}>Contact your administrator</p>
                  <p style={{ fontSize: 12, color: '#555', lineHeight: 1.6 }}>
                    Ask your property manager to reset your access.
                  </p>
                </div>
              </div>
            </div>
          </div>
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
