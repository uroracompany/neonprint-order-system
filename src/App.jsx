// ============= COMPONENTE PRINCIPAL: APP =============
// Define todas las rutas de la aplicación y su protección por rol
// Cada ruta corresponde a una página específica con un rol requerido

import { Routes, Route, BrowserRouter } from 'react-router-dom'
import Lobby from './pages/lobby'
import Dashboard from './pages/dashboard'
import ProtectedRoute from './ProtectedRoute'
import PageDesigner from './pages/page-designer'
import PageSeller from './pages/pages-seller'
import PageQuote from './pages/page-quote'
import PageProduction from './pages/page-production'
import PageDelivery from './pages/page-delivery'
import PageTracking from './pages/page-tracking'
import ErrorBoundary from './components/ErrorBoundary'
import './App.css'

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          {/* RUTAS PÚBLICAS: Sin autenticación */}
          <Route path="/" element={<Lobby />} />
          <Route path="/track/:token" element={<PageTracking />} />
          
          {/* RUTAS PROTEGIDAS POR ROL */}
          {/* Solo usuarios con rol "admin" pueden acceder al dashboard */}
          <Route path="/dashboard" element={<ProtectedRoute allowed={["admin"]}><Dashboard /></ProtectedRoute>} />
          
          {/* Solo usuarios con rol "designer" pueden acceder a diseño */}
          <Route path="/designer" element={<ProtectedRoute allowed={["designer"]}><PageDesigner /></ProtectedRoute>} />
          
          {/* Solo usuarios con rol "seller" pueden acceder a ventas */}
          <Route path="/page-seller" element={<ProtectedRoute allowed={["seller"]}><PageSeller /></ProtectedRoute>} />
          
          {/* Solo usuarios con rol "quote" pueden acceder a cotización */}
          <Route path="/quote" element={<ProtectedRoute allowed={["quote"]}><PageQuote /></ProtectedRoute>} />
          
          {/* Solo usuarios con rol "printer" pueden acceder a producción */}
          <Route path="/production" element={<ProtectedRoute allowed={["printer"]}><PageProduction /></ProtectedRoute>} />
          
          {/* Solo usuarios con rol "delivery" pueden acceder a entrega */}
          <Route path="/delivery" element={<ProtectedRoute allowed={["delivery"]}><PageDelivery /></ProtectedRoute>} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  )
} 
export default App
