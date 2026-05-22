// ============= CLIENTE DE SUPABASE =============
// Este archivo inicializa la conexión a Supabase
// Supabase es la base de datos y sistema de autenticación que usa la app
// 
// Variables de entorno necesarias:
// - VITE_SUPABASE_URL: URL de tu proyecto Supabase
// - VITE_SUPABASE_ANON_KEY: Clave anónima pública para cliente
//
// Uso: import { supabase } from './supabaseClient'

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Crea la instancia del cliente Supabase que se usa en toda la aplicación
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
