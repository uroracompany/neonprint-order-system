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

/// User Diseñador 1
// diseñador1@gmail.com
// diseñador1!29

/// User Diseñador 2
// diseñador2@gmail.com
// diseñador2!29


// User  3 
// disenador3@gmail.com
// diseñador3!29


/**Consulta para crear usuario
 * insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at
)
values (
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  'diseñador2@gmail.com',
  crypt('diseñador2!29', gen_salt('bf')),
  now(),
  now(),
  now()
);

Consulta para añadir nombre a los usuarios
update auth.users
set raw_user_meta_data = jsonb_set(
    coalesce(raw_user_meta_data, '{}'),
    '{display_name}',
    to_jsonb(case 
        when id = '9ca523e5-8585-4cf8-9486-4bb05644fc97' then 'Maria Peña'
        when id = 'ebf66c76-0e12-4bb0-b1a2-2de40b1e5e0d' then 'Jose Guzman'
    end)
)
where id in (
    '9ca523e5-8585-4cf8-9486-4bb05644fc97',
    'ebf66c76-0e12-4bb0-b1a2-2de40b1e5e0d'
);
 */