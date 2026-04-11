import { useState } from 'react'
import {Routes, Route,useNavigate, BrowserRouter} from 'react-router-dom'
import Lobby from './pages/lobby'
import Dashboard from './pages/dashboard'
import ProtectedRoute from './ProtectedRoute'
import PageDesigner from './pages/page-designer'
import PageSeller from './pages/pages-seller'
import PageQuote from './pages/page-quote'
import PageProduction from './pages/page-production'
import PageDelivery from './pages/page-delivery'
import './App.css'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Lobby />} />
        <Route path="/dashboard" element={<ProtectedRoute allowed={["admin"]}><Dashboard /></ProtectedRoute>} />
        <Route path="/designer" element={<ProtectedRoute allowed={["designer"]}><PageDesigner /></ProtectedRoute>} />
        <Route path="/page-seller" element={<ProtectedRoute allowed={["seller"]}><PageSeller /></ProtectedRoute>} />
        <Route path="/quote" element={<ProtectedRoute allowed={["quote"]}><PageQuote /></ProtectedRoute>} />
        <Route path="/production" element={<ProtectedRoute allowed={["printer"]}><PageProduction /></ProtectedRoute>} />
        <Route path="/delivery" element={<ProtectedRoute allowed={["printer", "admin"]}><PageDelivery /></ProtectedRoute>} />
      </Routes>
    </BrowserRouter>
  )
} 
export default App
