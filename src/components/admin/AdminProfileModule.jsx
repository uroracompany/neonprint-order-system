import { Icons } from "../../utils/icons";
import "./AdminProfileModule.css";

const formatDate = (value) => {
  if (!value) return "No disponible";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No disponible";
  return new Intl.DateTimeFormat("es-PY", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
};

const getDisplayName = (profile, authUser) => (
  profile?.name
  || authUser?.user_metadata?.display_name
  || authUser?.user_metadata?.full_name
  || authUser?.user_metadata?.name
  || authUser?.email?.split("@")[0]
  || "Administrador"
);

const getInitials = (name) => String(name || "?")
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map((part) => part[0]?.toUpperCase())
  .join("") || "?";

export default function AdminProfileModule({ authUser, profile }) {
  const displayName = getDisplayName(profile, authUser);
  const email = profile?.email || authUser?.email || "Sin correo registrado";
  const avatarUrl = authUser?.user_metadata?.avatar_url || authUser?.user_metadata?.picture || "";
  const isActive = profile?.employment_status !== false && !profile?.deleted_at;

  return (
    <section className="apm-shell" aria-labelledby="admin-profile-title">
      <div className="apm-hero">
        <div className="apm-avatar" aria-hidden="true">
          {avatarUrl ? <img src={avatarUrl} alt="" /> : getInitials(displayName)}
        </div>
        <div>
          <span className="apm-kicker">Cuenta administrativa</span>
          <h2 id="admin-profile-title">{displayName}</h2>
          <p>Información de la cuenta con la que ingresaste a Administración.</p>
        </div>
        <span className={`apm-status ${isActive ? "active" : "inactive"}`}>
          <span /> {isActive ? "Usuario activo" : "Usuario inactivo"}
        </span>
      </div>

      <div className="apm-grid">
        <article className="apm-card">
          <span className="apm-card-icon"><Icons.User /></span>
          <div><small>Nombre</small><strong>{displayName}</strong></div>
        </article>
        <article className="apm-card">
          <span className="apm-card-icon"><Icons.Mail /></span>
          <div><small>Correo</small><strong>{email}</strong></div>
        </article>
        <article className="apm-card">
          <span className="apm-card-icon"><Icons.Users /></span>
          <div><small>Rol</small><strong>Administrador</strong></div>
        </article>
        <article className="apm-card">
          <span className="apm-card-icon"><Icons.Calendar /></span>
          <div><small>Registrado desde</small><strong>{formatDate(profile?.created_at || authUser?.created_at)}</strong></div>
        </article>
      </div>

      <p className="apm-note"><Icons.AlertCircle /> Este perfil es solo de consulta. Los cambios de credenciales se gestionan mediante el flujo seguro de autenticación.</p>
    </section>
  );
}
