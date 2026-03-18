import "./Sidebar.css";
import Logo from "../assets/images/logo-neonprint.jpg";

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

const UserIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

const LogoutIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

export default function Sidebar({ 
  isOpen = true, 
  activeTab, 
  onTabChange, 
  role = "", 
  userName = "", 
  menuItems = [], 
  onLogout,
  onCreateNew,
  showCreateButton = false
}) {
  return (
    <aside className={`sb-sidebar ${isOpen ? "open" : "closed"}`}>
      <div className="sb-sidebar-logo">
        <NeonLogo size={52} />
        {isOpen && (
          <div className="sb-sidebar-logo-text">
            <div className="sb-sidebar-logo-title">Neon<span>Print</span></div>
            <div className="sb-sidebar-logo-sub">{role}</div>
          </div>
        )}
      </div>
      
      {isOpen && userName && (
        <div className="sb-sidebar-user">
          <div className="sb-user-avatar">
            <UserIcon />
          </div>
          <div className="sb-user-info">
            <span className="sb-user-name">{userName}</span>
          </div>
        </div>
      )}
      
      <nav className="sb-sidebar-nav">
        {menuItems.map(item => (
          <button 
            key={item.id}
            className={`sb-nav-btn ${activeTab === item.id ? "active" : ""}`}
            onClick={() => onTabChange(item.id)}
          >
            {item.icon}
            {isOpen && <span>{item.label}</span>}
            {isOpen && item.badge !== undefined && (
              <span className={`sb-nav-badge ${activeTab === item.id ? "active-badge" : ""}`}>
                {item.badge}
              </span>
            )}
          </button>
        ))}
        
        {showCreateButton && isOpen && (
          <button className="sb-new-order-btn" onClick={onCreateNew}>
            {isOpen && <span> Nueva Orden</span>}
          </button>
        )}
      </nav>
      
      <div className="sb-sidebar-footer">
        <button className="sb-logout-btn" onClick={onLogout}>
          <LogoutIcon />
          {isOpen && <span>Cerrar Sesión</span>}
        </button>
      </div>
    </aside>
  );
}
