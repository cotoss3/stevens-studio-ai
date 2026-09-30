-- Script para confirmar automáticamente los usuarios administradores de desarrollo
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Confirmar correos en auth.users
UPDATE auth.users 
SET email_confirmed_at = now() 
WHERE email IN ('admin@stevens.com', 'admin@stevens.com.pa');

-- Asegurar rol de administrador en la tabla profiles
INSERT INTO public.profiles (id, email, name, role)
SELECT id, email, 'Admin', 'admin' 
FROM auth.users 
WHERE email IN ('admin@stevens.com', 'admin@stevens.com.pa')
ON CONFLICT (id) DO UPDATE SET role = 'admin', name = 'Admin';
