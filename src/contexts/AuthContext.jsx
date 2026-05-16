import { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

const AuthContext = createContext({})

const INACTIVITY_TIMEOUT = 30 * 60 * 1000 // 30 minutes

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const inactivityTimer = useRef(null)

  async function fetchProfile(userId) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()
      if (!error && data) setProfile(data)
      else setProfile(null)
    } catch (e) {
      setProfile(null)
    } finally {
      setLoading(false)
    }
  }

  const signOut = useCallback(async () => {
    clearTimeout(inactivityTimer.current)
    setProfile(null)
    setUser(null)
    await supabase.auth.signOut()
  }, [])

  // Reset inactivity timer on user activity
  const resetTimer = useCallback(() => {
    clearTimeout(inactivityTimer.current)
    inactivityTimer.current = setTimeout(() => {
      signOut()
      // Show a toast-like alert
      window.__cmrAutoLogout = true
    }, INACTIVITY_TIMEOUT)
  }, [signOut])

  useEffect(() => {
    const timeout = setTimeout(() => setLoading(false), 8000)

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        fetchProfile(session.user.id)
        resetTimer()
      } else {
        setLoading(false)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        fetchProfile(session.user.id)
        resetTimer()
      } else {
        setProfile(null)
        setLoading(false)
        clearTimeout(inactivityTimer.current)
      }
    })

    // Listen for activity events to reset timer
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click']
    events.forEach(e => window.addEventListener(e, resetTimer, { passive: true }))

    return () => {
      clearTimeout(timeout)
      clearTimeout(inactivityTimer.current)
      subscription.unsubscribe()
      events.forEach(e => window.removeEventListener(e, resetTimer))
    }
  }, [resetTimer])

  const signIn = async (email, password) => {
    setLoading(true)
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setLoading(false)
    else resetTimer()
    return { data, error }
  }

  const isPlatformAdmin = profile?.is_platform_admin === true
  const isSuperAdmin = profile?.role === 'super_admin' || isPlatformAdmin
  const isAdmin = profile?.role === 'admin' || isSuperAdmin
  const isTeam = !!profile

  return (
    <AuthContext.Provider value={{
      user, profile, loading,
      signIn, signOut,
      isSuperAdmin, isAdmin, isTeam, isPlatformAdmin,
      fetchProfile,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
