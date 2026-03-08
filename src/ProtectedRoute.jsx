// Import React Dependencies
import { Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

// Import Components and Assets
import "./css-components/ProtectedRoute.css";

/* ── NeonPrint28 Logo (misma marca del login) ── */
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
      <span style={{ color:"#fff", fontSize: size * 0.195, fontWeight:800, lineHeight:1, letterSpacing:"-.5px", fontFamily:"'Poppins',sans-serif" }}>neon</span>
      <span style={{ color:"#00d4ff", fontSize: size * 0.115, fontWeight:500, lineHeight:1.1, letterSpacing:"2px", fontFamily:"'Poppins',sans-serif" }}>Print</span>
    </div>
  </div>
);

/* ── Spinner tricolor ── */
const TriSpinner = ({ size = 44 }) => (
  <div style={{ position:"relative", width: size, height: size }}>
    {/* pista fondo */}
    <div style={{
      position:"absolute", inset:0, borderRadius:"50%",
      border: `3px solid rgba(255,255,255,.07)`,
    }}/>
    {/* arco animado con gradiente tricolor */}
    <div style={{
      position:"absolute", inset:0, borderRadius:"50%",
      border: "3px solid transparent",
      borderTopColor:"#00d4ff",
      borderRightColor:"#ff1f6e",
      animation:"np-spin .9s linear infinite",
    }}/>
    {/* punto brillante */}
    <div style={{
      position:"absolute", top:0, left:"50%",
      transform:"translateX(-50%)",
      width:7, height:7, borderRadius:"50%",
      background:"#00d4ff",
      boxShadow:"0 0 10px #00d4ff, 0 0 20px rgba(0,212,255,.5)",
      animation:"np-spin .9s linear infinite",
      transformOrigin:"50% calc(50% + " + (size/2 - 3.5) + "px)",
    }}/>
  </div>
);

export default function ProtectedRoute({ children }) {
  const [session, setSession] = useState(undefined);

  // Check login  with supabase auth
  useEffect(() => {
    const checkSession = async () => {
      const { data } = await supabase.auth.getSession();
      setSession(data.session);
    };
    checkSession();
  }, []);

  // Loading status
  if (session === undefined) {
    return (
      <>
        <div className="np-loading-root">
          <div className="np-stripe" />
          <div className="np-glow-tr" />
          <div className="np-glow-bl" />
          <div className="np-bg-text">NP</div>

          <div className="np-card">
            {/* Logo */}
            <div className="np-brand">
              <NeonLogo size={64} />
              <div>
                <div className="np-brand-name">
                  neon<span className="cyan">Print</span>
                  <span style={{color:"rgba(255,255,255,.3)",fontWeight:300}}>28</span>
                </div>
                <div className="np-brand-sub">Sistema de Gestión · RD</div>
              </div>
            </div>

            {/* Spinner */}
            <TriSpinner size={48} />

            {/* Label + dots */}
            <div className="np-label">
              <div className="np-label-text">
                Verificando sesión
                <span className="np-dot" />
                <span className="np-dot" />
                <span className="np-dot" />
              </div>
              {/* barra */}
              <div className="np-bar-wrap">
                <div className="np-bar-fill" />
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  // If no session, redirect to login
  if (!session) return <Navigate to="/" />;
  return children;
}