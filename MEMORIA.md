# Memoria del Proyecto: Stevens Studio AI

Este documento contiene la información histórica, de arquitectura y configuración de la aplicación Stevens Studio AI (UPC Snap & Save).

---

## Información de la Base de Datos

> [!IMPORTANT]
> **Alojamiento y Cuenta Principal**:
> La base de datos (BDD) principal de producción y desarrollo, junto con el almacenamiento de archivos de catálogo, se encuentra alojada en la cuenta de **Jorge Supabase**.

---

## Propósito General
La aplicación permite a los operadores de Stevens catalogar productos físicos de forma ágil siguiendo un flujo asistido por Inteligencia Artificial:
1. **Identificación (UPC)**: Escaneo del código de barras del producto a través de la cámara trasera y extracción de los dígitos por el modelo Gemini 3.5 Flash.
2. **Validación de Duplicados**: El código UPC extraído se valida contra la base de datos de Supabase. Si el producto ya fue catalogado, se bloquea la toma de fotografías para evitar duplicados.
3. **Fotografía de Estudio**: Captura de la foto del producto, la cual pasa por el modelo Gemini 2.5 Flash Image para remover fondos y sombras de forma automatizada.
4. **Optimización Visual**: Un algoritmo en el cliente recorta los bordes transparentes y escala el producto de forma centrada a exactamente 1000x1000px, ocupando el 95% del canvas sobre fondo blanco puro (#FFFFFF).
5. **Publicación**: La imagen final optimizada se almacena en Supabase Storage (bucket `product-photos`) con el nombre `{UPC}.jpg` y se registra en la tabla `products`.

---

## Arquitectura y Tecnologías
* **Frontend**: React (v19), TypeScript, Tailwind CSS (v4) y Lucide Icons.
* **Backend**: Express en Node.js, actuando como proxy seguro para consultar las APIs de Gemini y Supabase, protegiendo las llaves privadas del servidor.
* **Base de Datos y Autenticación**: Supabase (PostgreSQL para almacenamiento, Supabase Auth para usuarios y Supabase Storage para fotos).

---

## Estructura de Base de Datos (Supabase)

### Tabla: `profiles`
Contiene los perfiles de los usuarios y sus roles autorizados:
* `id`: `uuid` (Primary Key, referencia a `auth.users.id` con borrado en cascada)
* `email`: `text` (no nulo)
* `name`: `text` (no nulo)
* `role`: `text` (restricciones de valor: `'admin'` o `'user'`)

### Tabla: `products`
Contiene los registros de los productos que han sido fotografiados con éxito:
* `id`: `bigint` (Identity, Primary Key)
* `upc`: `text` (Único, Indexado)
* `image_url`: `text` (URL de descarga pública o visualización)
* `file_path`: `text` (Ruta interna en el storage bucket para poder eliminarlo)
* `user_id`: `uuid` (Referencia a `auth.users.id` o nulo si es anónimo)
* `user_name`: `text` (Nombre de quien tomó la foto)
* `created_at`: `timestamptz` (Por defecto `now()`)

### Storage Bucket
* `product-photos` (Público): Almacena las imágenes optimizadas en formato JPG de alta resolución.

### Tabla: `published_upcs`
Inventario histórico de códigos que ya están publicados en el sitio web. Se
carga masivamente por CSV/TXT desde el panel de administración y sirve para
impedir que los operadores fotografíen productos ya publicados.
* `upc`: `text` (Único, clave de conflicto en los `upsert`)

---

## Reglas de negocio importantes

### Bloqueo de duplicados
El endpoint `GET /api/products/validate/:upc` bloquea la captura si el UPC
aparece en **cualquiera** de las dos tablas: `products` (fotografiado en la app)
o `published_upcs` (inventario cargado por CSV).

### Borrado suave de fotos
Al eliminar una foto del catálogo **no** se borra la fila de `products`: se marca
la columna `deleted_at`. La imagen sí se elimina del storage.

Motivos:
- El historial de reportes por colaborador se conserva (los reportes cuentan
  todas las filas, incluidas las marcadas como borradas).
- El UPC sigue registrado, así que no se puede volver a fotografiar.

Como respaldo, al borrar también se inserta el UPC en `published_upcs`.

Requiere la columna `deleted_at` en `products` — ver `migracion_deleted_at.sql`.
Si la columna no existiera, el servidor cae a un borrado definitivo y lo avisa
por consola.

### Total de productos publicados
`GET /api/admin/upcs-count` devuelve el total mostrado en el módulo de
Inventario: `published_upcs` + los UPCs únicos de `products` que no estén ya en
`published_upcs` (sin contar dos veces). Responde `{ count, inventory, photos,
photosOnly }`.

---

## Bitácora de cambios — 27/08/2026 (sesión con Claude)

Continuación del trabajo iniciado con Antigravity/Gemini.

### Codificación de textos
* Se corrigió el *mojibake* acumulado en `App.tsx` y `server.ts` (texto UTF-8
  releído como Latin-1/cp1252 en varias capas: `LÃƒÂƒÃ‚ÂMITE`, `contraseÃ¯Â¿Â½a`).
  Se reconstruyeron a mano los caracteres ya perdidos (`�`).
* Se corrigió un reemplazo masivo mal hecho que había cambiado `an` → `aún`
  **dentro de las palabras**: 23 casos, entre ellos `onChaúnge` en todos los
  checkboxes. Ese era el motivo de que "Seleccionar Todo" no funcionara.
* `index.html`: se agregó `viewport-fit=cover` al meta viewport.

### Catálogo de fotos
* **Descarga en ZIP**: nuevo `services/zipUtils.ts`, generador de ZIP propio sin
  dependencias (método *store*, con CRC32 y nombres UTF-8). Dos botones:
  "ZIP Todas" (todas las fotos del filtro actual) y "ZIP Selección". Reemplaza
  la descarga foto por foto, que el navegador bloqueaba a partir de ~10 archivos.
* **Vista previa en modal**: el botón "Ver" ya no abre otra pestaña. Abre un
  popup con navegación ← →, cierre con Esc o clic afuera, y botones de descarga
  individual y abrir original.
* **Tamaños de grilla**: S/M/L se corrieron un escalón hacia abajo
  (L: 3 columnas, M: 6, S: 8 en escritorio).

### Interfaz móvil
* El sidebar pasa a `hidden md:flex`. En móvil aparece una **barra inferior de
  pestañas** fija, estilo app nativa, con las 5 secciones y respeto por el
  `safe-area-inset-bottom`.
* Los accesos a Modo Escáner y Cerrar Sesión se movieron a la barra superior en
  móvil. Paddings y tipografías responsive en todas las secciones.
* Se eliminó el banner rojo de DEBUG de la pantalla del operador.

### Inventario de UPCs
* Nuevo endpoint `GET /api/admin/upcs-count` y tarjeta con el **total de
  productos publicados**, siempre visible (también en la barra superior fija
  mientras se navega la sección). Se actualiza al entrar, al guardar una foto
  nueva y al borrar fotos.
* El módulo se hizo responsive (carga de CSV y botón de subida en móvil).

### Backend
* `package.json`: el script `dev` pasó a `tsx watch` — antes el servidor no
  recargaba los cambios de `server.ts` y las rutas nuevas parecían no existir.
* `validate/:upc`: se cambió `maybeSingle()` por `limit(1)`. Con el borrado
  suave un mismo UPC puede tener más de una fila y `maybeSingle()` habría
  lanzado error.
* Los endpoints de borrado (individual y masivo) ahora hacen borrado suave y
  conservan el UPC en `published_upcs`.

### Pendientes / notas
* La migración `migracion_deleted_at.sql` ya fue aplicada en Supabase
  (27/08/2026).
* El proyecto de Supabase en uso es `pismwnzcawsofrpcnaem` (cuenta de Jorge).
* Respaldos de los archivos previos a la corrección de codificación en
  `_backup_utf8/`.
