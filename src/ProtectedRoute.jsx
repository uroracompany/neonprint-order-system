// ============= COMPONENTE PROTECTEDROUTE =============
// Protege rutas verificando la sesión y el perfil ya cargados por AuthProvider.

import { Navigate } from "react-router-dom";
import { useMemo } from "react";
import { useAuth } from "./hooks/useAuth";

import "./css-components/ProtectedRoute.css";

const NeonLogo = ({ size = 56 }) => (
  <div style={{
    width: size, height: size, borderRadius: "50%", flexShrink: 0,
    background: "conic-gradient(#00d4ff 0deg 118deg, #ff1f6e 118deg 238deg, #ffe600 238deg 360deg)",
    boxShadow: "0 0 0 2.5px rgba(255,255,255,.06), 0 8px 32px rgba(0,0,0,.6)",
    display: "flex", alignItems: "center", justifyContent: "center",
  }}>
    <div style={{
      width: size * 0.73, height: size * 0.73, borderRadius: "50%",
      background: "#080e1d",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
    }}>
      <span style={{ color:"#fff", fontSize: size * 0.195, fontWeight:800 }}>neon</span>
      <span style={{ color:"#00d4ff", fontSize: size * 0.115, letterSpacing:"2px" }}>Print</span>
    </div>
  </div>
);

const TriSpinner = ({ size = 44 }) => (
  <div style={{ position:"relative", width:size, height:size }}>
    <div style={{
      position:"absolute", inset:0, borderRadius:"50%",
      border:`3px solid rgba(255,255,255,.07)`
    }}/>
    <div style={{
      position:"absolute", inset:0, borderRadius:"50%",
      border:"3px solid transparent",
      borderTopColor:"#00d4ff",
      borderRightColor:"#ff1f6e",
      animation:"np-spin .9s linear infinite"
    }}/>
  </div>
);

const LoadingSession = () => (
  <div className="np-loading-root">
    <div className="np-card">
      <div className="np-brand">
        <NeonLogo size={64}/>
        <div>
          <div className="np-brand-name">
            neon<span className="cyan">Print</span>
            <span style={{color:"rgba(255,255,255,.3)"}}>28</span>
          </div>
          <div className="np-brand-sub">Sistema de Gestión · RD</div>
        </div>
      </div>

      <TriSpinner size={48}/>

      <div className="np-label">
        Verificando sesión...
      </div>
    </div>
  </div>
);

export default function ProtectedRoute({ children, allowed = [] }) {
  const { user, profile, loading } = useAuth();
  const allowedRoles = useMemo(() => allowed.filter(Boolean), [allowed]);

  if (loading || (user && profile === undefined)) {
    return <LoadingSession />;
  }

  if (!user) return <Navigate to="/" replace />;

  if (profile?.employment_status === false) {
    return <Navigate to="/" state={{ loginMessage: "Tu cuenta está desactivada. Contacta al administrador." }} replace />;
  }

  if (!profile || (allowedRoles.length && !allowedRoles.includes(profile.role))) {
    return <Navigate to="/" state={{ loginMessage: "Tu usuario no tiene permisos para entrar a esa sección." }} replace />;
  }

  return children;
}
