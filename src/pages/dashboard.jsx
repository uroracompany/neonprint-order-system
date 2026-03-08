// import { useEffect } from "react";
import { supabase } from "../../supabaseClient";
import { useNavigate } from "react-router-dom";


function Dashboard(){

    // Navigate functtion to redirect user after logout
    const navigate = useNavigate();

    // Function to handle user logout
    const  handleLogout = async ()=> {
        const {error} = await supabase.auth.signOut();
        if(error){
            console.error("Error cerrando sesión:", error.message);
            return;
        }
        navigate("/");
    }

    return(
        <>
            <h1>Bienvenido Admin</h1>
            <button className="cursor-pointer" onClick={handleLogout}>Logout</button>
        </>
    )
}

export default Dashboard;