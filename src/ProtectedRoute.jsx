// Import React Dependencies
import { Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

// Import Components and Assets
import "./css-components/ProtectedRoute.css";

/* ── NeonPrint28 Logo ── */
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

/* ── Spinner ── */
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

export default function ProtectedRoute({ children, allowed = [] }) {

  const [session, setSession] = useState(undefined);
  const [unauthorized, setUnauthorized] = useState(false);

  useEffect(() => {

    const checkAccess = async () => {

      // Obtener usuario actual
      const { data } = await supabase.auth.getUser();

      if (!data.user) {
        setSession(null);
        return;
      }

      setSession(data.user);

      // Obtener rol
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", data.user.id)
        .single();

      const role = profile?.role;

      // Verificar permisos
      if (allowed.length && !allowed.includes(role)) {
        setUnauthorized(true);
      }

    };

    checkAccess();

  }, [allowed]);

  // cerrar sesión si no tiene permiso
  useEffect(() => {

    const logout = async () => {
      if (unauthorized) {
        await supabase.auth.signOut();
      }
    };

    logout();

  }, [unauthorized]);

  // Loader mientras verifica
  if (session === undefined) {
    return (
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
  }

  // No logeado
  if (!session) return <Navigate to="/" />;

  // Rol incorrecto
  if (unauthorized) return <Navigate to="/" />;

  return children;
}