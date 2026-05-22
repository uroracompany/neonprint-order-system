import { Component } from "react";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Error capturado:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          minHeight: "100vh", background: "#080e1d", color: "#fff", padding: 40, textAlign: "center",
          fontFamily: "'Inter', system-ui, sans-serif"
        }}>
          <div style={{
            width: 64, height: 64, borderRadius: "50%",
            background: "conic-gradient(#00d4ff 0deg 118deg, #ff1f6e 118deg 238deg, #ffe600 238deg 360deg)",
            display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 24
          }}>
            <div style={{
              width: 46, height: 46, borderRadius: "50%", background: "#080e1d",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#fff", fontSize: 20, fontWeight: 800
            }}>!</div>
          </div>
          <h2 style={{ margin: "0 0 8px", fontSize: 20 }}>Algo salió mal</h2>
          <p style={{ margin: "0 0 24px", color: "rgba(255,255,255,.5)", fontSize: 14, maxWidth: 400, lineHeight: 1.5 }}>
            Ocurrió un error inesperado. Por favor, recarga la página o contacta al administrador.
          </p>
          <button onClick={() => window.location.reload()} style={{
            padding: "12px 24px", borderRadius: 10, border: "none",
            background: "linear-gradient(135deg, #00d4ff, #0a1e42)", color: "#fff",
            fontSize: 14, fontWeight: 600, cursor: "pointer"
          }}>
            Recargar página
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
