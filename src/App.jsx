import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import Layout from '@/components/layout/Layout'
import Login from '@/pages/Login'
import Dashboard from '@/pages/Dashboard'
import TeamHome from '@/pages/TeamHome'
import Buildings from '@/pages/Buildings'
import BuildingFile from '@/pages/BuildingFile'
import Owners from '@/pages/Owners'
import Tenants from '@/pages/Tenants'
import Payments from '@/pages/Payments'
import OwnerPayments from '@/pages/OwnerPayments'
import Expenses from '@/pages/Expenses'
import Staff from '@/pages/Staff'
import Reports from '@/pages/Reports'
import Audit from '@/pages/Audit'
import Settings from '@/pages/Settings'
import UtilityBills from '@/pages/UtilityBills'
import SecurityDeposits from '@/pages/SecurityDeposits'
import DailyCollection from '@/pages/DailyCollection'
import SuperAdmin from '@/pages/SuperAdmin'
import CheckInOut from '@/pages/CheckInOut'
import DailyReconciliation from '@/pages/DailyReconciliation'

function ProtectedRoute({ children, adminOnly = false, superOnly = false }) {
  const { user, profile, loading } = useAuth()
  if (loading) return <Loader />
  if (!user || !profile) return <Navigate to="/login" replace />
  if (superOnly && profile.role !== 'super_admin') return <Navigate to="/" replace />
  if (adminOnly && !['super_admin', 'admin'].includes(profile.role)) return <Navigate to="/" replace />
  return children
}

function Loader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-50">
      <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

// Role-based home: team sees TeamHome, admin/super admin sees Dashboard
function HomeRoute() {
  const { profile } = useAuth()
  if (profile?.role === 'team') return <TeamHome />
  return <Dashboard />
}

function AppRoutes() {
  const { user, loading } = useAuth()
  // While checking auth, show loader
  if (loading) return <Loader />

  return (
    <Routes>
      {/* Login — redirect to home if already authenticated */}
      <Route path="/login" element={
        user ? <Navigate to="/" replace /> : <Login />
      } />

      {/* Protected app routes */}
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
        <Route path="/platform-admin" element={<SuperAdmin />} />
        <Route path="/checkinout" element={<CheckInOut />} />
        <Route path="/daily-reconciliation" element={<DailyReconciliation />} />
        <Route path="/audit" element={<ProtectedRoute superOnly><Audit /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute adminOnly><Settings /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Toaster position="top-right" toastOptions={{
          style: { background: '#fff', color: '#1e293b', border: '1px solid #e2e8f0', fontSize: '13px' },
          success: { iconTheme: { primary: '#16a34a', secondary: '#fff' } },
          error: { iconTheme: { primary: '#dc2626', secondary: '#fff' } },
        }} />
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
