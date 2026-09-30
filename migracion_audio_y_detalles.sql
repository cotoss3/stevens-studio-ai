-- Migración: Agregar columnas para título, descripción y transcripción de audio en la tabla products
ALTER TABLE public.products 
ADD COLUMN IF NOT EXISTS title TEXT,
ADD COLUMN IF NOT EXISTS description TEXT,
ADD COLUMN IF NOT EXISTS transcription TEXT;
