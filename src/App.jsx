import { useState } from 'react'
import {Routes, Route,useNavigate, BrowserRouter} from 'react-router-dom'
import Lobby from './pages/lobby'
import Dashboard from './pages/dashboard'
import ProtectedRoute from './ProtectedRoute'
import PageDesigner from './pages/page-designer'
import PageClient from './pages/pages-client'
import './App.css'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Lobby />} />
        <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/designer" element={<ProtectedRoute><PageDesigner /></ProtectedRoute>} />
        <Route path="/client" element={<ProtectedRoute><PageClient /></ProtectedRoute>} />
      </Routes>
    </BrowserRouter>
  )
} 
export default App
