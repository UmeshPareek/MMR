import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { ThemeProvider } from '@/contexts/ThemeContext'
import ErrorBoundary from '@/components/ErrorBoundary'

// Layout is always needed — not lazy
import Layout from '@/components/layout/Layout'

// Lazy-load every page — each becomes its own JS chunk
const Login              = lazy(() => import('@/pages/Login'))
const Signup             = lazy(() => import('@/pages/Signup'))
const Dashboard          = lazy(() => import('@/pages/Dashboard'))
const TeamHome           = lazy(() => import('@/pages/TeamHome'))
const Buildings          = lazy(() => import('@/pages/Buildings'))
const BuildingFile       = lazy(() => import('@/pages/BuildingFile'))
const Owners             = lazy(() => import('@/pages/Owners'))
const Tenants            = lazy(() => import('@/pages/Tenants'))
const Payments           = lazy(() => import('@/pages/Payments'))
const OwnerPayments      = lazy(() => import('@/pages/OwnerPayments'))
const Expenses           = lazy(() => import('@/pages/Expenses'))
const Staff              = lazy(() => import('@/pages/Staff'))
const Reports            = lazy(() => import('@/pages/Reports'))
const Audit              = lazy(() => import('@/pages/Audit'))
const Settings           = lazy(() => import('@/pages/Settings'))
const UtilityBills       = lazy(() => import('@/pages/UtilityBills'))
const SecurityDeposits   = lazy(() => import('@/pages/SecurityDeposits'))
const DailyCollection    = lazy(() => import('@/pages/DailyCollection'))
const CheckIn            = lazy(() => import('@/pages/CheckIn'))
const CheckOut           = lazy(() => import('@/pages/CheckOut'))
const DailyReconciliation = lazy(() => import('@/pages/DailyReconciliation'))

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-50">
      <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function ProtectedRoute({ children, adminOnly = false, superOnly = false }) {
  const { user, profile, loading } = useAuth()
  if (loading) return <PageLoader />
  if (!user || !profile) return <Navigate to="/login" replace />
  if (superOnly && profile.role !== 'super_admin' && !profile.is_platform_admin) return <Navigate to="/" replace />
  if (adminOnly && !['super_admin', 'admin'].includes(profile.role)) return <Navigate to="/" replace />
  return children
}

function HomeRoute() {
  const { profile } = useAuth()
  if (profile?.role === 'team') return <TeamHome />
  return <Dashboard />
}

function AppRoutes() {
  const { user, loading } = useAuth()
  if (loading) return <PageLoader />

  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/login" element={
          user ? <Navigate to="/" replace /> : <Login />
        } />
        <Route path="/signup" element={
          user ? <Navigate to="/" replace /> : <Signup />
        } />

        <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route path="/" element={<HomeRoute />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/buildings" element={<Buildings />} />
          <Route path="/buildings/:id" element={<BuildingFile />} />
          <Route path="/owners" element={<Owners />} />
          <Route path="/tenants" element={<Tenants />} />
          <Route path="/payments" element={<Payments />} />
          <Route path="/owner-payments" element={<OwnerPayments />} />
          <Route path="/expenses" element={<Expenses />} />
          <Route path="/staff" element={<Staff />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/utility-bills" element={<UtilityBills />} />
          <Route path="/security-deposits" element={<SecurityDeposits />} />
          <Route path="/daily-collection" element={<DailyCollection />} />
          <Route path="/checkin" element={<ProtectedRoute><CheckIn /></ProtectedRoute>} />
          <Route path="/checkout" element={<ProtectedRoute><CheckOut /></ProtectedRoute>} />
          <Route path="/daily-reconciliation" element={<ProtectedRoute adminOnly><DailyReconciliation /></ProtectedRoute>} />
          <Route path="/audit" element={<ProtectedRoute superOnly><Audit /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute adminOnly><Settings /></ProtectedRoute>} />
          <Route path="/platform-admin" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <ErrorBoundary>
            <Toaster position="top-right" toastOptions={{
              style: { background: '#fff', color: '#1e293b', border: '1px solid #e2e8f0', fontSize: '13px' },
              success: { iconTheme: { primary: '#16a34a', secondary: '#fff' } },
              error: { iconTheme: { primary: '#dc2626', secondary: '#fff' } },
            }} />
            <AppRoutes />
          </ErrorBoundary>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}
