-- =====================================================================
-- SCRIPT DE INICIALIZACIÓN COMPLETA PARA STEVENS STUDIO AI
-- Ejecuta este script en el SQL Editor de tu nuevo proyecto de Supabase
-- =====================================================================

-- 1. TABLA DE PERFILES DE USUARIOS (profiles)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT CHECK (role IN ('admin', 'user')) DEFAULT 'user',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Habilitar RLS en profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Políticas de acceso para profiles
CREATE POLICY "Permitir lectura de perfiles a usuarios autenticados" 
  ON public.profiles FOR SELECT 
  TO authenticated, anon 
  USING (true);

CREATE POLICY "Permitir inserción y actualización de perfiles" 
  ON public.profiles FOR ALL 
  TO authenticated, anon 
  USING (true) 
  WITH CHECK (true);


-- 2. TABLA DE PRODUCTOS Y FICHA TÉCNICA (products)
CREATE TABLE IF NOT EXISTS public.products (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  upc TEXT UNIQUE NOT NULL,
  image_url TEXT,
  file_path TEXT,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_name TEXT,
  title TEXT,
  description TEXT,
  transcription TEXT,
  deleted_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Crear índice para búsquedas rápidas por UPC
CREATE INDEX IF NOT EXISTS idx_products_upc ON public.products(upc);
CREATE INDEX IF NOT EXISTS idx_products_user_id ON public.products(user_id);

-- Habilitar RLS en products
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- Políticas de acceso para products
CREATE POLICY "Permitir lectura de productos a todos" 
  ON public.products FOR SELECT 
  TO authenticated, anon 
  USING (true);

CREATE POLICY "Permitir inserción de productos" 
  ON public.products FOR INSERT 
  TO authenticated, anon 
  WITH CHECK (true);

CREATE POLICY "Permitir actualización de productos" 
  ON public.products FOR UPDATE 
  TO authenticated, anon 
  USING (true);

CREATE POLICY "Permitir eliminación de productos" 
  ON public.products FOR DELETE 
  TO authenticated, anon 
  USING (true);


-- 3. TABLA DE INVENTARIO HISTÓRICO DE UPCs PUBLICADOS (published_upcs)
CREATE TABLE IF NOT EXISTS public.published_upcs (
  upc TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Habilitar RLS en published_upcs
ALTER TABLE public.published_upcs ENABLE ROW LEVEL SECURITY;

-- Políticas de acceso para published_upcs
CREATE POLICY "Permitir todo acceso a published_upcs" 
  ON public.published_upcs FOR ALL 
  TO authenticated, anon 
  USING (true) 
  WITH CHECK (true);


-- 4. CREACIÓN DEL STORAGE BUCKET PÚBLICO (product-photos)
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-photos', 'product-photos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Políticas de acceso para objetos en Storage
CREATE POLICY "Acceso público de lectura a fotos de productos" 
  ON storage.objects FOR SELECT 
  TO public 
  USING (bucket_id = 'product-photos');

CREATE POLICY "Permitir subir fotos de productos" 
  ON storage.objects FOR INSERT 
  TO authenticated, anon 
  WITH CHECK (bucket_id = 'product-photos');

CREATE POLICY "Permitir actualizar fotos de productos" 
  ON storage.objects FOR UPDATE 
  TO authenticated, anon 
  USING (bucket_id = 'product-photos');

CREATE POLICY "Permitir eliminar fotos de productos" 
  ON storage.objects FOR DELETE 
  TO authenticated, anon 
  USING (bucket_id = 'product-photos');


-- 5. TRIGGER AUTOMÁTICO AL CREAR USUARIOS EN AUTH (opcional pero recomendado)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name, role)
  VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    'user'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
