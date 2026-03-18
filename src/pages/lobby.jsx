// Supabase client and React imports
import { useState } from "react";
import {useNavigate} from "react-router-dom";
import { supabase } from "../../supabaseClient"

// Styles & Assets
import "../css-components/lobby.css"
import Logo from "../assets/images/logo-neonprint.jpg"


// ICONS (kept inline for simplicity, can be moved to separate files if needed)
const IcoMail = ({ color = "currentColor" }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
  </svg>
);
const IcoLock = ({ color = "currentColor" }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);
const IcoAlert = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);
const IcoOk = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
  </svg>
);

/* ── Logo true to the brand: tricolor rings cyan / magenta / yellow ── */
const NeonLogo = ({ size = 54 }) => (
  <div style={{
    width: size, height: size, borderRadius: "50%", flexShrink: 0,
    background: "conic-gradient(#00d4ff 0deg 118deg, #ff1f6e 118deg 238deg, #ffe600 238deg 360deg)",
    boxShadow: "0 0 0 2.5px rgba(255,255,255,.06), 0 8px 28px rgba(0,0,0,.55)",
    display: "flex", alignItems: "center", justifyContent: "center",
  }}>
    <img src={Logo} className="rounded-full" alt="Logo neonPrint" />
  </div>
);

/* ── Stat pill ── */
const StatPill = ({ label, value, color }) => (
  <div style={{
    display: "flex", flexDirection: "column", gap: 2,
    background: "rgba(255,255,255,.05)",
    border: "1px solid rgba(255,255,255,.09)",
    borderRadius: 10, padding: "10px 18px",
  }}>
    <span style={{ color, fontSize: 20, fontWeight: 700, lineHeight: 1, fontFamily: "'Poppins',sans-serif" }}>{value}</span>
    <span style={{ color: "rgba(255,255,255,.38)", fontSize: 10, fontWeight: 400, letterSpacing: ".6px", textTransform: "uppercase" }}>{label}</span>
  </div>
);

/* ─── Main ──────────────────────────────────────────────── */
export default function Lobby() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [fieldErr, setFieldErr] = useState(false);
  const [focused, setFocused] = useState(null);

  const clearMsg = () => { setMessage(null); setFieldErr(false); };
  const navigate = useNavigate();


  const handleLogin = async (e) => {
    e.preventDefault();

    // Basic validation Email and Password not empty
    if (!email.trim() || !password) {
      setMessage({ type: "error", text: "Por favor, completa todos los campos." });
      setFieldErr(true);
      return;
    }
    setLoading(true);
    setMessage(null);
    setFieldErr(false);

    try {

      // Login with Supabase
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        throw error; //send to catch block
      }

      // Finding user role (assuming you have a 'profiles' table linked to auth users)
      const {data: profiles} = await supabase
      .from("profiles")
      .select("role")
      .eq("id",data.user.id)
      .single();


      // If login successful, you can redirect or show success message
      console.log("Login Exitoso:", data);

      setMessage({
        type: "success",
        text: "Acceso concedido. Redirigiendo...",
      });
     
      // Redirect to dashboard after successful login
      setTimeout(() =>{
        if(profiles.role === "admin"){
          navigate("/dashboard");
        };
        if(profiles.role === "seller"){
          navigate("/page-seller");
        }
        if(profiles.role === "designer"){
          navigate("/designer");
        }
      });

      
      // setTimeout(() => {
      //   navigate("/dashboard");
      // }, 2000);

    } catch (err) {

      const msg = {
        400: "Credenciales incorrectas.",
        401: "Credenciales incorrectas.",
        403: "Sin permisos de acceso.",
        404: "Cuenta no encontrada.",
        429: "Demasiados intentos.",
      }

      setMessage({
        type:"error",
        text: msg[err?.status] || err.message || "Error de conexión. Intenta de nuevo.",
      });

      setFieldErr(true);

    }finally {
      setLoading(false);
    }
  };


  return (
    <>
      <div className="login-root">

        {/* LEFT */}
        <div className="login-left">
          <div className="glow-tr" /><div className="glow-bl" />
          <div className="accent-line" /><div className="bg-text">NP</div>

          {/* Brand */}
          <div className="left-brand">
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <NeonLogo size={52} />
              <div>
                <div style={{ color: "#fff", fontSize: "clamp(15px,1.8vw,18px)", fontWeight: 700, lineHeight: 1.2 }}>
                  Neon<span style={{ color: "#00d4ff" }}>Print</span>
                </div>
                <div style={{ color: "rgba(255,255,255,.25)", fontSize: 10, fontWeight: 400, letterSpacing: "1.2px", textTransform: "uppercase", marginTop: 2 }}>
                  <span className="text-[#ff1f6e]"> Impresión Digital</span> · RD
                </div>
              </div>
            </div>
          </div>

          {/* Hero */}
          <div className="left-hero">
            <div className="eyebrow">Sistema de Gestión de Órdenes</div>
            <h1>
              Gestiona cada<br />
              <span className="c-cyan">orden</span> con<br />
              precisión <span className="c-pink">total</span>
            </h1>
            <div className="stats-row">
              <StatPill label="Órdenes hoy" value="—" color="#00d4ff" />
              <StatPill label="En producción" value="—" color="#ff1f6e" />
              <StatPill label="Completadas" value="—" color="#ffe600" />
            </div>
          </div>

          {/* Footer */}
          <div className="left-footer">
            <p style={{ color: "rgba(255,255,255,.15)", fontSize: 11, letterSpacing: ".3px", lineHeight: 1.7 }}>
              © 2025 NeonPrint28 &nbsp;·&nbsp; Portal exclusivo para empleados<br />
              (809) 707-9634
            </p>
          </div>
        </div>

        {/* RIGHT */}
        <div className="login-right">
          <div className="form-inner">

            <div className="portal-badge"><span className="dot" />Sistema Interno</div>

            <div className="form-header">
              <h2>Iniciar sesión</h2>
              <p>Ingresa tus credenciales para acceder a tu cuenta</p>
            </div>

            {message && (
              <div className={`msg-box ${message.type}`}>
                {message.type === "error" ? <IcoAlert /> : <IcoOk />}
                <span>{message.text}</span>
              </div>
            )}

            <form onSubmit={handleLogin} noValidate>
              <div className="field-wrap">
                <label className="field-label" htmlFor="np-email">Correo electrónico</label>
                <div className="field-rel">
                  <span className="field-ico" style={{ color: focused === "email" ? "#00aac4" : "#9ca3af" }}><IcoMail /></span>
                  <input id="np-email" type="email" placeholder="usuario@empresa.com"
                    autoComplete="email" value={email}
                    className={`field-input${fieldErr ? " err" : ""}`}
                    onFocus={() => setFocused("email")} onBlur={() => setFocused(null)}
                    onChange={e => { setEmail(e.target.value); clearMsg(); }} />
                </div>
              </div>

              <div className="field-wrap">
                <label className="field-label" htmlFor="np-pass">Contraseña</label>
                <div className="field-rel">
                  <span className="field-ico" style={{ color: focused === "pass" ? "#00aac4" : "#9ca3af" }}><IcoLock /></span>
                  <input id="np-pass" type="password" placeholder="••••••••••"
                    autoComplete="current-password" value={password}
                    className={`field-input${fieldErr ? " err" : ""}`}
                    onFocus={() => setFocused("pass")} onBlur={() => setFocused(null)}
                    onChange={e => { setPassword(e.target.value); clearMsg(); }} />
                </div>
              </div>

              <button className="btn-login" type="submit" disabled={loading}>
                {loading ? (
                  <><span style={{ width: 15, height: 15, display: "inline-block", border: "2px solid rgba(255,255,255,.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin .65s linear infinite" }} />Verificando...</>
                ) : (
                  <>Acceder al sistema
                    <span className="btn-arrow">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
                      </svg>
                    </span>
                  </>
                )}
              </button>
            </form>

            <div className="divider">acceso seguro</div>
          </div>
        </div>

      </div>
    </>
  );
}