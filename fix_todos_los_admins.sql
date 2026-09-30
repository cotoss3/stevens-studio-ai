-- Script para actualizar la contraseña de TODOS los administradores a 'Admin'
CREATE EXTENSION IF NOT EXISTS pgcrypto;

UPDATE auth.users 
SET encrypted_password = crypt('Admin', gen_salt('bf')),
    email_confirmed_at = now()
WHERE email IN ('admin@stevens.com', 'admin@stevens.com.pa');

INSERT INTO public.profiles (id, email, name, role)
SELECT id, email, 'Admin', 'admin' 
FROM auth.users 
WHERE email IN ('admin@stevens.com', 'admin@stevens.com.pa')
ON CONFLICT (id) DO UPDATE SET role = 'admin', name = 'Admin';
