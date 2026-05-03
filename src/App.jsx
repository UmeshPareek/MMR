import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import Layout from '@/components/layout/Layout'
import Login from '@/pages/Login'
import Dashboard from '@/pages/Dashboard'
import Buildings from '@/pages/Buildings'
import Tenants from '@/pages/Tenants'
import Payments from '@/pages/Payments'
import Expenses from '@/pages/Expenses'
import Staff from '@/pages/Staff'
import Reports from '@/pages/Reports'
import Audit from '@/pages/Audit'
import Settings from '@/pages/Settings'
import Owners from '@/pages/Owners'
import OwnerPayments from '@/pages/OwnerPayments'

function ProtectedRoute({ children, requireAdmin = false, requireSuperAdmin = false }) {
  const { user, profile, loading } = useAuth()

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-surface-500 text-sm">Loading MMR…</p>
      </div>
    </div>
  )

  if (!user) return <Navigate to="/login" replace />
  if (requireSuperAdmin && profile?.role !== 'super_admin') return <Navigate to="/" replace />
  if (requireAdmin && !['super_admin', 'admin'].includes(profile?.role)) return <Navigate to="/" replace />

  return children
}

function AppRoutes() {
  const { user } = useAuth()

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<Dashboard />} />
        <Route path="buildings" element={<Buildings />} />
        <Route path="owners" element={<Owners />} />
        <Route path="tenants" element={<Tenants />} />
        <Route path="payments" element={<Payments />} />
        <Route path="owner-payments" element={<OwnerPayments />} />
        <Route path="expenses" element={<Expenses />} />
        <Route path="staff" element={<Staff />} />
        <Route path="reports" element={<Reports />} />
        <Route path="audit" element={<ProtectedRoute requireSuperAdmin><Audit /></ProtectedRoute>} />
        <Route path="settings" element={<ProtectedRoute requireAdmin><Settings /></ProtectedRoute>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: {
              background: '#1e293b',
              color: '#f1f5f9',
              border: '1px solid #334155',
              borderRadius: '10px',
              fontFamily: 'DM Sans, sans-serif',
              fontSize: '14px',
            },
            success: { iconTheme: { primary: '#10b981', secondary: '#1e293b' } },
            error: { iconTheme: { primary: '#ef4444', secondary: '#1e293b' } },
          }}
        />
      </AuthProvider>
    </BrowserRouter>
  )
}
