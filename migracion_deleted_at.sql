-- Ejecutar una sola vez en Supabase → SQL Editor
-- Agrega el borrado suave a la tabla products:
-- las fotos eliminadas dejan de verse en el catálogo, pero el registro
-- se conserva para los reportes y para impedir UPCs duplicados.

alter table public.products
  add column if not exists deleted_at timestamptz;

-- Acelera el listado del catálogo (solo filas no borradas)
create index if not exists products_deleted_at_idx
  on public.products (deleted_at)
  where deleted_at is null;
