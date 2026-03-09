import { useState } from 'react'
import {Routes, Route,useNavigate, BrowserRouter} from 'react-router-dom'
import Lobby from './pages/lobby'
import Dashboard from './pages/dashboard'
import ProtectedRoute from './ProtectedRoute'
import PageDesigner from './pages/page-designer'
import PageSeller from './pages/pages-seller'
import './App.css'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Lobby />} />
        <Route path="/dashboard" element={<ProtectedRoute allowed={["admin"]}><Dashboard /></ProtectedRoute>} />
        <Route path="/designer" element={<ProtectedRoute allowed={["designer"]}><PageDesigner /></ProtectedRoute>} />
        <Route path="/page-seller" element={<ProtectedRoute allowed={["seller"]}><PageSeller /></ProtectedRoute>} />
      </Routes>
    </BrowserRouter>
  )
} 
export default App
