import { lazy, Suspense } from 'react'
import { Routes, Route, BrowserRouter } from 'react-router-dom'
import ProtectedRoute from './ProtectedRoute'
import ErrorBoundary from './components/ErrorBoundary'
import { AuthProvider } from './contexts/AuthProvider'
import './App.css'

const Lobby = lazy(() => import('./pages/lobby'))
const Dashboard = lazy(() => import('./pages/dashboard'))
const PageDesigner = lazy(() => import('./pages/page-designer'))
const PageSeller = lazy(() => import('./pages/pages-seller'))
const PageQuote = lazy(() => import('./pages/page-quote'))
const PageProduction = lazy(() => import('./pages/page-production'))
const PageDelivery = lazy(() => import('./pages/page-delivery'))
const PageTracking = lazy(() => import('./pages/page-tracking'))

function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <BrowserRouter>
          <Suspense fallback={<div className="app-route-loading">Cargando...</div>}>
            <Routes>
              <Route path="/" element={<Lobby />} />
              <Route path="/track/:token" element={<PageTracking />} />

              <Route path="/dashboard" element={<ProtectedRoute allowed={["admin"]}><Dashboard /></ProtectedRoute>} />
              <Route path="/designer" element={<ProtectedRoute allowed={["designer"]}><PageDesigner /></ProtectedRoute>} />
              <Route path="/page-seller" element={<ProtectedRoute allowed={["seller"]}><PageSeller /></ProtectedRoute>} />
              <Route path="/quote" element={<ProtectedRoute allowed={["quote"]}><PageQuote /></ProtectedRoute>} />
              <Route path="/production" element={<ProtectedRoute allowed={["digital_producer", "dtf_producer", "ploteo_producer"]}><PageProduction /></ProtectedRoute>} />
              <Route path="/delivery" element={<ProtectedRoute allowed={["delivery"]}><PageDelivery /></ProtectedRoute>} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  )
}

export default App
