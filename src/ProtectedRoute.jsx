// ============= COMPONENTE PROTECTEDROUTE =============
// Este componente protege las rutas de la aplicación verificando:
// 1. Si el usuario está autenticado en Supabase
// 2. Si el usuario tiene el rol requerido
// 
// USO: <ProtectedRoute allowed={["quote"]}><PageQuote /></ProtectedRoute>
// 
// Si el usuario no está autenticado o no tiene permisos, lo redirige al login

// Import React Dependencies
import { Navigate } from "react-router-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";

// Import Components and Assets
import "./css-components/ProtectedRoute.css";

/* ── LOGO NEONPRINT ── */
// Logo decorativo que se muestra durante la carga
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

/* ── SPINNER ANIMADO ── */
// Spinner que se muestra mientras se verifica la autenticación
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

// ============= COMPONENTE MAIN =============
// Props:
//   children: El componente a proteger
//   allowed: Array de roles permitidos (ej: ["quote", "designer"])
export default function ProtectedRoute({ children, allowed = [] }) {

  const [session, setSession] = useState(undefined); // undefined = cargando, null = sin sesión, user = autenticado
  const [unauthorized, setUnauthorized] = useState(false); // true = autenticado pero sin permisos
  const [profileInactive, setProfileInactive] = useState(false);
  const allowedKey = useMemo(() => allowed.join("|"), [allowed]);

  const evaluateProfileAccess = useCallback((profile) => {
    const allowedRoles = allowedKey ? allowedKey.split("|") : [];
    setProfileInactive(profile?.employment_status === false);
    setUnauthorized(Boolean(allowedRoles.length && !allowedRoles.includes(profile?.role)));
  }, [allowedKey]);

  const checkAccess = useCallback(async () => {
    const { data, error } = await supabase.auth.getUser();

    if (error || !data.user) {
      setSession(null);
      return null;
    }

    setSession(data.user);

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, employment_status")
      .eq("id", data.user.id)
      .single();

    evaluateProfileAccess(profile);
    return data.user;
  }, [evaluateProfileAccess]);

  useEffect(() => {
    let isMounted = true;
    let profileChannel = null;

    const start = async () => {
      const currentUser = await checkAccess();
      if (!isMounted || !currentUser?.id) return;

      profileChannel = supabase
        .channel(`protected-profile-${currentUser.id}`)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${currentUser.id}` },
          (payload) => evaluateProfileAccess(payload.new)
        )
        .subscribe();
    };

    const handleFocus = () => {
      checkAccess();
    };

    start();
    window.addEventListener("focus", handleFocus);

    return () => {
      isMounted = false;
      window.removeEventListener("focus", handleFocus);
      if (profileChannel) supabase.removeChannel(profileChannel);
    };
  }, [checkAccess, evaluateProfileAccess]);

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

  if (profileInactive) return <Navigate to="/" state={{ loginMessage: "Tu cuenta está desactivada. Contacta al administrador." }} replace />;

  // Rol incorrecto
  if (unauthorized) return <Navigate to="/" state={{ loginMessage: "Tu usuario no tiene permisos para entrar a esa sección." }} replace />;

  return children;
}
