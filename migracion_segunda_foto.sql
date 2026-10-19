-- Migración para soportar 2 fotos por producto en Supabase
-- Estándar: Foto 1 (_1.jpg) obligatoria y Foto 2 (_2.jpg) opcional

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS image_url_2 TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS file_path_2 TEXT;

-- Comentario descriptivo para la documentación del esquema
COMMENT ON COLUMN public.products.image_url_2 IS 'URL pública de la segunda foto del producto (_2.jpg, opcional)';
COMMENT ON COLUMN public.products.file_path_2 IS 'Ruta de almacenamiento en Supabase Storage para la segunda foto';
