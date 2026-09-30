import { createClient } from '@supabase/supabase-js';

// Lee las variables de entorno inyectadas por Vite (prefijo VITE_ obligatorio)
const VITE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const VITE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!VITE_URL || !VITE_ANON_KEY) {
  console.error(
    'ERROR: VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY no están definidas en el archivo .env. ' +
    'El cliente de Supabase no funcionará correctamente.'
  );
}

export const supabase = createClient(
  VITE_URL || 'https://placeholder.supabase.co',
  VITE_ANON_KEY || 'placeholder'
);

// Función conservada por compatibilidad con el panel de Configuración en la UI
// (ya no es necesaria para el caso normal, las credenciales vienen del .env)
export function updateSupabaseConfig(_url: string, _anonKey: string) {
  // No-op: la configuración ahora viene de las variables de entorno VITE_
  // Las variables guardadas en localStorage ya no se usan como fuente de verdad
}
