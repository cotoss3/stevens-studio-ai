-- Script para establecer usuario 'Admin' y contraseña EXACTA 'Admin'
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  target_user_id UUID := gen_random_uuid();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'admin@stevens.com') THEN
    INSERT INTO auth.users (
      id,
      instance_id,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      role,
      aud
    ) VALUES (
      target_user_id,
      '00000000-0000-0000-0000-000000000000',
      'admin@stevens.com',
      crypt('Admin', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}',
      '{"name":"Admin"}',
      now(),
      now(),
      'authenticated',
      'authenticated'
    );
  ELSE
    SELECT id INTO target_user_id FROM auth.users WHERE email = 'admin@stevens.com';
    UPDATE auth.users 
    SET encrypted_password = crypt('Admin', gen_salt('bf')),
        email_confirmed_at = now()
    WHERE id = target_user_id;
  END IF;

  INSERT INTO public.profiles (id, email, name, role)
  VALUES (target_user_id, 'admin@stevens.com', 'Admin', 'admin')
  ON CONFLICT (id) DO UPDATE SET role = 'admin', name = 'Admin';
END $$;
