import { supabase } from "../../supabaseClient";
import { useNavigate } from "react-router-dom";


function Dashboard(){

    const navigate = useNavigate();

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