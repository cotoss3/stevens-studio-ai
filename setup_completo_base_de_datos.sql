-- =====================================================================
-- SCRIPT IDEMPOTENTE DE INICIALIZACIÓN COMPLETA PARA STEVENS STUDIO AI
-- Se puede ejecutar múltiples veces sin errores de duplicados.
-- =====================================================================

-- 1. TABLA DE PERFILES DE USUARIOS (profiles)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT CHECK (role IN ('admin', 'user')) DEFAULT 'user',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permitir lectura de perfiles a todos" ON public.profiles;
CREATE POLICY "Permitir lectura de perfiles a todos" 
  ON public.profiles FOR SELECT 
  TO authenticated, anon 
  USING (true);

DROP POLICY IF EXISTS "Permitir insercion y actualizacion de perfiles" ON public.profiles;
CREATE POLICY "Permitir insercion y actualizacion de perfiles" 
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

CREATE INDEX IF NOT EXISTS idx_products_upc ON public.products(upc);
CREATE INDEX IF NOT EXISTS idx_products_user_id ON public.products(user_id);

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permitir lectura de productos a todos" ON public.products;
CREATE POLICY "Permitir lectura de productos a todos" 
  ON public.products FOR SELECT 
  TO authenticated, anon 
  USING (true);

DROP POLICY IF EXISTS "Permitir insercion de productos" ON public.products;
CREATE POLICY "Permitir insercion de productos" 
  ON public.products FOR INSERT 
  TO authenticated, anon 
  WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir actualizacion de productos" ON public.products;
CREATE POLICY "Permitir actualizacion de productos" 
  ON public.products FOR UPDATE 
  TO authenticated, anon 
  USING (true);

DROP POLICY IF EXISTS "Permitir eliminacion de productos" ON public.products;
CREATE POLICY "Permitir eliminacion de productos" 
  ON public.products FOR DELETE 
  TO authenticated, anon 
  USING (true);


-- 3. TABLA DE INVENTARIO HISTÓRICO DE UPCs PUBLICADOS (published_upcs)
CREATE TABLE IF NOT EXISTS public.published_upcs (
  upc TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.published_upcs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permitir todo acceso a published_upcs" ON public.published_upcs;
CREATE POLICY "Permitir todo acceso a published_upcs" 
  ON public.published_upcs FOR ALL 
  TO authenticated, anon 
  USING (true) 
  WITH CHECK (true);


-- 4. CREACIÓN DEL STORAGE BUCKET PÚBLICO (product-photos)
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-photos', 'product-photos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "Acceso publico de lectura a fotos de productos" ON storage.objects;
CREATE POLICY "Acceso publico de lectura a fotos de productos" 
  ON storage.objects FOR SELECT 
  TO public 
  USING (bucket_id = 'product-photos');

DROP POLICY IF EXISTS "Permitir subir fotos de productos" ON storage.objects;
CREATE POLICY "Permitir subir fotos de productos" 
  ON storage.objects FOR INSERT 
  TO authenticated, anon 
  WITH CHECK (bucket_id = 'product-photos');

DROP POLICY IF EXISTS "Permitir actualizar fotos de productos" ON storage.objects;
CREATE POLICY "Permitir actualizar fotos de productos" 
  ON storage.objects FOR UPDATE 
  TO authenticated, anon 
  USING (bucket_id = 'product-photos');

DROP POLICY IF EXISTS "Permitir eliminar fotos de productos" ON storage.objects;
CREATE POLICY "Permitir eliminar fotos de productos" 
  ON storage.objects FOR DELETE 
  TO authenticated, anon 
  USING (bucket_id = 'product-photos');


-- 5. TRIGGER AUTOMÁTICO PARA CREACIÓN DE USUARIOS EN AUTH
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
