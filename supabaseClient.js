// Supabase client setup
import { createClient} from "@supabase/supabase-js";

// Get the Supabase URL and anonymous key from environment variables
const supabaseUrl= import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey= import.meta.env.VITE_SUPABASE_ANON_KEY;

// Create and export the Supabase client
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

//User Admin
// neonprint29@system.com
// neonprint29!29

// User Atencion Cliente
// atencioncliente@gmail.com
// atencioncliente!29