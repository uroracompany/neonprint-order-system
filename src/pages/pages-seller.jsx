// import { useEffect } from "react";
import { supabase } from "../../supabaseClient";
import { useNavigate } from "react-router-dom";


function PageSeller() {
  // Navigate functtion to redirect user after logout
  const navigate = useNavigate();

  // Function to handle user logout
  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error("Error cerrando sesión:", error.message);
      return;
    }
    navigate("/");
  }

  return (
    <div>
      <h1>Bienvenido Vendedor</h1>
      <p> Quiere Registrar una orden</p>
      <button className="cursor-pointer" onClick={handleLogout} >Cerrar Sesion</button>
    </div>
  );
}

export default PageSeller;