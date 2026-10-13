import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { createClient, SupabaseClient } from "@supabase/supabase-js";


async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // Helper to lazily initialize Supabase admin client
  let supabaseAdmin: SupabaseClient | null = null;
  function getSupabaseAdmin(): SupabaseClient {
    if (!supabaseAdmin) {
      const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
      if (!url || !serviceKey) {
        console.warn("ADVERTENCIA: SUPABASE_URL o llaves de Supabase no configuradas en las variables de entorno.");
      }
      supabaseAdmin = createClient(url || 'https://placeholder.supabase.co', serviceKey || 'placeholder', {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      });
    }
    return supabaseAdmin;
  }



  // Helper to lazily initialize Gemini client
  let ai: GoogleGenAI | null = null;
  function getGeminiClient(): GoogleGenAI {
    if (!ai) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("GEMINI_API_KEY environment variable is required");
      }
      ai = new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });
    }
    return ai;
  }

  // Helper that executes with exponential backoff for 429 Rate Limits / Quotas and 503 High Demand / UNAVAILABLE
  async function executeWithRetry<T>(
    fn: () => Promise<T>,
    maxAttempts = 4,
    baseDelayMs = 1500
  ): Promise<T> {
    let attempt = 1;
    while (true) {
      try {
        return await fn();
      } catch (error: any) {
        const errorMsg = error.message || '';
        const status = error.status || error.statusCode || error.code;
        const isTransient = 
          status === 429 ||
          status === 503 ||
          status === 502 ||
          status === 504 ||
          errorMsg.includes('429') ||
          errorMsg.includes('503') ||
          errorMsg.includes('RESOURCE_EXHAUSTED') ||
          errorMsg.includes('UNAVAILABLE') ||
          errorMsg.toLowerCase().includes('too many requests') ||
          errorMsg.toLowerCase().includes('quota') ||
          errorMsg.toLowerCase().includes('high demand') ||
          errorMsg.toLowerCase().includes('temporarily');

        if (isTransient && attempt < maxAttempts) {
          const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 500;
          console.warn(`[Transient ${status || 'Error'}] Retrying attempt ${attempt}/${maxAttempts} in ${Math.round(delay)}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          attempt++;
        } else {
          throw error;
        }
      }
    }
  }


  // Supabase Admin and validation endpoints
  app.get("/api/products/validate/:upc", async (req, res) => {
    try {
      const { upc } = req.params;
      const supabase = getSupabaseAdmin();
      
      // 1. Verificar en tabla de fotos nuevas (products)
      const { data: dataProducts, error: errProducts } = await supabase
        .from('products')
        .select('id')
        .eq('upc', upc)
        .limit(1);

      if (errProducts) throw errProducts;
      
      // 2. Verificar en tabla de inventario histórico (published_upcs)
      const { data: dataPublished, error: errPublished } = await supabase
        .from('published_upcs')
        .select('upc')
        .eq('upc', upc)
        .maybeSingle();
        
      if (errPublished) throw errPublished;

      // Si existe en CUALQUIERA de las dos, bloqueamos.
      const exists = (Array.isArray(dataProducts) ? dataProducts.length > 0 : !!dataProducts) || !!dataPublished;

      return res.json({ exists });
    } catch (error: any) {
      console.error("Error in validate endpoint:", error);
      return res.json({ exists: false, error: error.message });
    }
  });

  app.post("/api/admin/create-user", async (req, res) => {
    try {
      const { email, password, name, role } = req.body;
      if (!email || !password || !name || !role) {
        return res.status(400).json({ error: "Faltan campos obligatorios" });
      }

      const supabase = getSupabaseAdmin();

      // Create in Supabase Auth
      const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name }
      });

      if (authError) throw authError;
      if (!authUser.user) throw new Error("No se pudo crear el usuario en la autenticación.");

      // Upsert role and name in profiles table (handles both cases: with or without DB trigger)
      const { error: profileError } = await supabase
        .from('profiles')
        .upsert({
          id: authUser.user.id,
          email,
          name,
          role
        });

      if (profileError) {
        // Rollback auth user creation if profile creation fails
        await supabase.auth.admin.deleteUser(authUser.user.id);
        throw profileError;
      }

      return res.json({ success: true, userId: authUser.user.id });
    } catch (error: any) {
      console.error("Error creating user:", error);
      return res.status(500).json({ error: error.message || "Error al crear usuario" });
    }
  });

  app.get("/api/admin/users", async (req, res) => {
    try {
      const supabase = getSupabaseAdmin();
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .limit(100);

      if (error) throw error;
      
      // Map to fields matching what frontend expects (matching Appwrite format for user list)
      const mappedUsers = (data || []).map(u => ({
        $id: u.id,
        userId: u.id,
        name: u.name,
        email: u.email,
        role: u.role
      }));
      return res.json(mappedUsers);
    } catch (error: any) {
      console.error("Error listing users:", error);
      return res.status(500).json({ error: error.message || "Error al obtener usuarios" });
    }
  });

  app.post("/api/admin/delete-user", async (req, res) => {
    try {
      const { userId } = req.body;
      if (!userId) {
        return res.status(400).json({ error: "Falta userId" });
      }

      const supabase = getSupabaseAdmin();

      // Delete user profile in db (cascade might handle it, but let's do it manually)
      await supabase.from('profiles').delete().eq('id', userId);

      // Delete from Auth
      const { error } = await supabase.auth.admin.deleteUser(userId);

      if (error) throw error;
      return res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting user:", error);
      return res.status(500).json({ error: error.message || "Error al eliminar usuario" });
    }
  });

  /**
   * Borrado suave: marca las fotos como eliminadas en vez de borrarlas.
   * Asi el historial de reportes se conserva y el UPC sigue bloqueado.
   * Si la columna deleted_at todavia no existe, cae a un DELETE real.
   */
  async function softDeleteProducts(supabase: any, docIds: string[]) {
    const { error } = await supabase
      .from('products')
      .update({ deleted_at: new Date().toISOString() })
      .in('id', docIds);

    if (!error) return { softDeleted: true };

    const missingColumn = error.code === '42703' || /deleted_at/i.test(error.message || '');
    if (!missingColumn) throw error;

    console.warn(
      "[products] La columna deleted_at no existe: se borran las filas de forma definitiva " +
      "y se pierde el historial de reportes. Ejecuta la migracion indicada en MEMORIA.md."
    );
    const { error: delErr } = await supabase.from('products').delete().in('id', docIds);
    if (delErr) throw delErr;
    return { softDeleted: false };
  }

  app.get("/api/admin/reports", async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      const supabase = getSupabaseAdmin();

      // List all profiles
      const { data: users, error: usersErr } = await supabase
        .from('profiles')
        .select('*')
        .limit(100);

      if (usersErr) throw usersErr;

      const reports = [];
      for (const u of (users || [])) {
        // Query products total matching this user_id
        let query = supabase
          .from('products')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', u.id);
          
        if (startDate) query = query.gte('created_at', startDate as string);
        if (endDate) {
          const end = new Date(endDate as string);
          end.setHours(23, 59, 59, 999);
          query = query.lte('created_at', end.toISOString());
        }

        const { count, error: countErr } = await query;

        if (countErr) throw countErr;

        reports.push({
          userId: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          count: count || 0
        });
      }

      // Add a report for photos taken without a valid user_id
      const { count: anonCount, error: anonErr } = await supabase
        .from('products')
        .select('*', { count: 'exact', head: true })
        .is('user_id', null);

      if (!anonErr && anonCount && anonCount > 0) {
        reports.push({
          userId: '',
          name: 'Sin Usuario / Anónimo',
          email: '-',
          role: 'user',
          count: anonCount
        });
      }

      return res.json(reports);
    } catch (error: any) {
      console.error("Error generating report:", error);
      return res.status(500).json({ error: error.message || "Error al generar reportes" });
    }
  });

  app.get("/api/admin/products", async (req, res) => {
    try {
      const supabase = getSupabaseAdmin();
      let { data, error } = await supabase
        .from('products')
        .select('*')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(100);

      // Si la columna deleted_at aun no existe, listar sin ese filtro
      if (error && (error.code === '42703' || /deleted_at/i.test(error.message || ''))) {
        console.warn("[products] deleted_at no existe todavia; listando sin filtro.");
        ({ data, error } = await supabase
          .from('products')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(100));
      }

      if (error) throw error;
      
      // Map to structure frontend expects
      const mappedProducts = (data || []).map(p => ({
        $id: p.id,
        upc: p.upc,
        imageUrl: p.image_url,
        fileId: p.file_path, // Storage file path
        userName: p.user_name,
        createdAt: p.created_at,
        title: p.title || '',
        description: p.description || '',
        transcription: p.transcription || ''
      }));
      return res.json(mappedProducts);
    } catch (error: any) {
      console.error("Error listing products:", error);
      return res.status(500).json({ error: error.message || "Error al obtener productos" });
    }
  });

  app.post("/api/admin/delete-product", async (req, res) => {
    try {
      const { docId, fileId } = req.body;
      if (!docId) {
        return res.status(400).json({ error: "Falta docId" });
      }

      const supabase = getSupabaseAdmin();

      // Leer el UPC ANTES de borrar: aunque la foto se elimine, el codigo debe
      // quedar registrado en el inventario para impedir que se duplique.
      const { data: prod, error: readErr } = await supabase
        .from('products')
        .select('upc')
        .eq('id', docId)
        .maybeSingle();
      if (readErr) throw readErr;

      // Borrado suave: conserva el registro para reportes y para evitar duplicados
      await softDeleteProducts(supabase, [docId]);

      // Conservar el UPC como publicado
      const upcToKeep = prod?.upc ? String(prod.upc).trim() : null;
      if (upcToKeep) {
        const { error: keepErr } = await supabase
          .from('published_upcs')
          .upsert([{ upc: upcToKeep }], { onConflict: 'upc', ignoreDuplicates: true });
        if (keepErr) console.error("[delete-product] no se pudo conservar el UPC:", keepErr);
        else console.log("[delete-product] UPC conservado en inventario:", upcToKeep);
      }

      // Delete from storage
      if (fileId) {
        try {
          await supabase.storage.from('product-photos').remove([fileId]);
        } catch (storageErr: any) {
          console.warn("Storage deletion error (might have been deleted already):", storageErr.message);
        }
      }

      return res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting product:", error);
      return res.status(500).json({ error: error.message || "Error al eliminar producto" });
    }
  });

  app.post("/api/admin/delete-products-mass", async (req, res) => {
    try {
      const { items } = req.body; // Array of { docId, fileId }
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "Faltan items para eliminar" });
      }

      const supabase = getSupabaseAdmin();
      const docIds = items.map((i: any) => i.docId).filter(Boolean);
      const fileIds = items.map((i: any) => i.fileId).filter(Boolean);

      // Leer los UPCs ANTES de borrar para conservarlos en el inventario
      let upcsToKeep: string[] = [];
      if (docIds.length > 0) {
        const { data: prods, error: readErr } = await supabase
          .from('products')
          .select('upc')
          .in('id', docIds);
        if (readErr) throw readErr;
        upcsToKeep = Array.from(
          new Set((prods || []).map((p: any) => String(p.upc).trim()).filter(Boolean))
        );
      }

      // Borrado suave masivo
      if (docIds.length > 0) {
        await softDeleteProducts(supabase, docIds);
      }

      // Conservar los UPCs como publicados
      if (upcsToKeep.length > 0) {
        const { error: keepErr } = await supabase
          .from('published_upcs')
          .upsert(upcsToKeep.map(upc => ({ upc })), { onConflict: 'upc', ignoreDuplicates: true });
        if (keepErr) console.error("[delete-products-mass] no se pudieron conservar los UPCs:", keepErr);
        else console.log(`[delete-products-mass] ${upcsToKeep.length} UPCs conservados en inventario`);
      }

      // Mass delete from Storage
      if (fileIds.length > 0) {
        try {
          await supabase.storage.from('product-photos').remove(fileIds);
        } catch (storageErr: any) {
          console.warn("Storage mass deletion error:", storageErr.message);
        }
      }

      return res.json({ success: true });
    } catch (error: any) {
      console.error("Error mass deleting products:", error);
      return res.status(500).json({ error: error.message || "Error al eliminar masivamente" });
    }
  });

  // API endpoints FIRST
  app.post("/api/gemini/extract-upc", async (req, res) => {
    try {
      const { base64Image } = req.body;
      if (!base64Image) {
        return res.status(400).json({ error: "Falta la imagen" });
      }

      if (!process.env.GEMINI_API_KEY) {
        console.error("GEMINI_API_KEY no está configurada en las variables de entorno del servidor.");
        return res.status(500).json({ error: "La API Key de Gemini no está configurada en el servidor. Por favor, asegúrese de agregarla en Settings > Secrets." });
      }

      const candidateModels = [
        process.env.GEMINI_UPC_MODEL || 'gemini-3.5-flash',
        'gemini-2.5-flash',
        'gemini-3.8-flash'
      ];
      const uniqueModels = Array.from(new Set(candidateModels));
      const cleanBase64 = base64Image.split(',')[1] || base64Image;

      let result: string | null = null;
      let lastError: any = null;

      for (const currentModel of uniqueModels) {
        try {
          result = await executeWithRetry(async () => {
            const client = getGeminiClient();
            const response = await client.models.generateContent({
              model: currentModel,
              contents: {
                parts: [
                  {
                    inlineData: {
                      mimeType: 'image/jpeg',
                      data: cleanBase64,
                    },
                  },
                  {
                    text: "Extract the barcode UPC number (numeric string) from this image. Only return the digits of the code. If multiple codes are found, return the most prominent one. If no code is found, reply with 'NOT_FOUND'.",
                  },
                ],
              },
            });

            const textOutput = response.text?.trim() || 'NOT_FOUND';
            if (textOutput === 'NOT_FOUND') {
              throw new Error("No se detectó el código UPC. Intenta de nuevo o digítalo.");
            }
            return textOutput.replace(/[^0-9A-Z]/gi, '');
          }, 3, 1200);

          if (result) break;
        } catch (modelErr: any) {
          console.warn(`[extract-upc] Modelo ${currentModel} falló:`, modelErr.message || modelErr);
          lastError = modelErr;
          if (modelErr.message && modelErr.message.includes("No se detectó el código UPC")) {
            throw modelErr; // Si la imagen simplemente no tiene código, no reintentar otros modelos
          }
        }
      }

      if (!result) {
        throw lastError || new Error("No se pudo extraer el UPC.");
      }

      return res.json({ upc: result });
    } catch (error: any) {
      console.error("Error in extract-upc endpoint:", error);
      return res.status(500).json({ error: error.message || "Error al procesar la imagen" });
    }
  });

  app.post("/api/gemini/transform-studio-shot", async (req, res) => {
    try {
      const { base64Image } = req.body;
      if (!base64Image) {
        return res.status(400).json({ error: "Falta la imagen" });
      }

      if (!process.env.GEMINI_API_KEY) {
        console.error("GEMINI_API_KEY no está configurada en las variables de entorno del servidor.");
        return res.status(500).json({ error: "La API Key de Gemini no está configurada en el servidor. Por favor, asegúrese de agregarla en Settings > Secrets." });
      }

      const candidateModels = [
        process.env.GEMINI_STUDIO_MODEL || 'gemini-3.1-flash-lite-image',
        'gemini-2.5-flash-image'
      ];
      const uniqueModels = Array.from(new Set(candidateModels));
      const cleanBase64 = base64Image.split(',')[1] || base64Image;

      let resultUrl: string | null = null;
      let lastError: any = null;

      for (const currentModel of uniqueModels) {
        try {
          resultUrl = await executeWithRetry(async () => {
            const client = getGeminiClient();
            const response = await client.models.generateContent({
              model: currentModel,
              contents: {
                parts: [
                  {
                    inlineData: {
                      mimeType: 'image/jpeg',
                      data: cleanBase64,
                    },
                  },
                  {
                    text: "Convert this photo into a Full HD, ultra-crisp professional e-commerce studio shot:\n1. Remove the background completely and replace with 100% pure, seamless solid white (hex #FFFFFF).\n2. Center the product cleanly, occupying approximately 80% to 85% of the frame (height or dominant dimension), leaving clean balanced margins.\n3. Apply professional, bright, high-definition studio lighting across the entire product, eliminating all harsh shadows, glare, human hands/fingers, and background clutter.\n4. CRITICAL: PRESERVE EXACT 100% FIDELITY. Do NOT alter, hallucinate, blur, smudge, or distort any printed text, typography, numbers, brand logos, fabric patterns, embroidery, stitching, or material textures on the product. Every letter, logo, pattern, and detail must remain razor-sharp and 100% identical to the original item in Full HD.\n5. Output ONLY the resulting high-resolution product image without any added external text, borders, or graphics.",
                  },
                ],
              },
            });

            const candidate = response.candidates?.[0];
            if (!candidate?.content?.parts) {
              throw new Error("No se pudo generar la imagen de estudio.");
            }

            for (const part of candidate.content.parts) {
              if (part.inlineData) {
                return `data:image/png;base64,${part.inlineData.data}`;
              }
            }
            throw new Error("La IA no devolvió una imagen procesada.");
          }, 3, 1500);

          if (resultUrl) break;
        } catch (modelErr: any) {
          console.warn(`[transform-studio-shot] Modelo ${currentModel} falló:`, modelErr.message || modelErr);
          lastError = modelErr;
        }
      }

      if (!resultUrl) {
        let cleanMsg = lastError?.message || "No se pudo generar la foto de estudio con IA.";
        try {
          const parsed = JSON.parse(cleanMsg);
          if (parsed?.error?.message) cleanMsg = parsed.error.message;
        } catch {}
        return res.status(500).json({ error: cleanMsg });
      }

      return res.json({ studioImage: resultUrl });
    } catch (error: any) {
      console.error("Error in transform-studio-shot endpoint:", error);
      let cleanMsg = error.message || "Error al procesar la imagen";
      try {
        const parsed = JSON.parse(cleanMsg);
        if (parsed?.error?.message) cleanMsg = parsed.error.message;
      } catch {}
      return res.status(500).json({ error: cleanMsg });
    }
  });

  app.post("/api/gemini/process-audio", async (req, res) => {
    try {
      const { base64Audio, mimeType = 'audio/webm', base64Image, upcCode } = req.body;
      if (!base64Audio) {
        return res.status(400).json({ error: "Falta el archivo de audio" });
      }

      if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({ error: "GEMINI_API_KEY no está configurada en las variables de entorno del servidor." });
      }

      const candidateModels = [
        process.env.GEMINI_AUDIO_MODEL || 'gemini-3.5-flash-lite',
        'gemini-3.5-flash',
        'gemini-flash-latest',
        'gemini-3.8-flash'
      ];
      const uniqueModels = Array.from(new Set(candidateModels));
      const cleanAudioBase64 = base64Audio.split(',')[1] || base64Audio;

      const parts: any[] = [
        {
          inlineData: {
            mimeType: mimeType,
            data: cleanAudioBase64,
          },
        },
      ];

      if (base64Image) {
        const cleanImgBase64 = base64Image.split(',')[1] || base64Image;
        parts.push({
          inlineData: {
            mimeType: 'image/jpeg',
            data: cleanImgBase64,
          },
        });
      }

      const upcContext = upcCode ? `Código UPC: ${upcCode}.\n` : '';

      parts.push({
        text: `Actúa como catalogador e-commerce ultra-rápido (<3s).
${upcContext}
FUENTES:
1. Audio del operador (MÁXIMA PRIORIDAD para detalles, color, material, talla y uso).
2. Foto del producto (para validar marca oficial y empaque si está presente).

INSTRUCCIONES:
1. Transcribe en "transcription" fielmente lo dicho por el operador.
2. Genera en "title" un título comercial conciso y atractivo (máximo 12 palabras).
3. Genera en "description" una descripción profesional para tienda web con los atributos mencionados.

Responde ÚNICAMENTE un JSON válido con este formato:
{
  "transcription": "...",
  "title": "...",
  "description": "..."
}`
      });

      let result: any = null;
      let lastError: any = null;

      for (const currentModel of uniqueModels) {
        try {
          result = await executeWithRetry(async () => {
            const client = getGeminiClient();
            const response = await client.models.generateContent({
              model: currentModel,
              contents: {
                parts,
              },
              config: {
                responseMimeType: "application/json",
                maxOutputTokens: 500,
                temperature: 0.2
              }
            });

            const textOutput = response.text?.trim() || '';
            try {
              const parsed = JSON.parse(textOutput);
              return {
                transcription: parsed.transcription || textOutput,
                title: parsed.title || 'Producto Catalogado',
                description: parsed.description || parsed.transcription || ''
              };
            } catch (parseErr) {
              return {
                transcription: textOutput,
                title: 'Producto Catalogado',
                description: textOutput
              };
            }
          }, 2, 800);

          if (result) break;
        } catch (modelErr: any) {
          console.warn(`[process-audio] Modelo ${currentModel} falló:`, modelErr.message || modelErr);
          lastError = modelErr;
        }
      }

      if (!result) {
        let cleanMsg = lastError?.message || "No se pudo procesar el audio con IA.";
        try {
          const parsed = JSON.parse(cleanMsg);
          if (parsed?.error?.message) cleanMsg = parsed.error.message;
        } catch {}
        if (/503|high demand|alta demanda|UNAVAILABLE/i.test(cleanMsg)) {
          cleanMsg = "Alta demanda momentánea en los servidores de IA de Google. Puedes reintentar o llenar la ficha manualmente.";
        }
        return res.status(503).json({ error: cleanMsg });
      }

      return res.json(result);
    } catch (error: any) {
      console.error("Error in process-audio endpoint:", error);
      let cleanMsg = error.message || "Error al procesar el audio con IA";
      try {
        const parsed = JSON.parse(cleanMsg);
        if (parsed?.error?.message) cleanMsg = parsed.error.message;
      } catch {}
      if (/503|high demand|alta demanda|UNAVAILABLE/i.test(cleanMsg)) {
        cleanMsg = "Alta demanda momentánea en los servidores de IA de Google. Puedes reintentar o llenar la ficha manualmente.";
      }
      return res.status(500).json({ error: cleanMsg });
    }
  });

    // Mass Upload Published UPCs
  // Total de productos ya cubiertos: inventario cargado (published_upcs)
  // + fotos tomadas en la app (products) que todavia no estan en el inventario.
  app.get("/api/admin/upcs-count", async (_req, res) => {
    try {
      const supabase = getSupabaseAdmin();

      // 1. Inventario historico
      const { count: inventoryCount, error } = await supabase
        .from('published_upcs')
        .select('upc', { count: 'exact', head: true });

      if (error) {
        console.error("[upcs-count] Supabase error:", error);
        throw new Error(`${error.message}${error.hint ? ' — ' + error.hint : ''}`);
      }

      // 2. UPCs unicos fotografiados en la app
      const { data: productRows, error: errProducts } = await supabase
        .from('products')
        .select('upc');
      if (errProducts) throw errProducts;

      const photoUpcs = Array.from(
        new Set((productRows || []).map(r => String(r.upc).trim()).filter(Boolean))
      );

      // 3. Cuantos de esos NO estan ya en el inventario (para no contarlos dos veces)
      let alreadyInInventory = 0;
      const chunkSize = 500;
      for (let i = 0; i < photoUpcs.length; i += chunkSize) {
        const chunk = photoUpcs.slice(i, i + chunkSize);
        const { count: dup, error: errDup } = await supabase
          .from('published_upcs')
          .select('upc', { count: 'exact', head: true })
          .in('upc', chunk);
        if (errDup) throw errDup;
        alreadyInInventory += dup ?? 0;
      }

      const inventory = inventoryCount ?? 0;
      const photosOnly = photoUpcs.length - alreadyInInventory;
      const total = inventory + photosOnly;

      console.log(
        `[upcs-count] inventario=${inventory} fotos_unicas=${photoUpcs.length} ` +
        `ya_en_inventario=${alreadyInInventory} total=${total}`
      );

      res.json({ count: total, inventory, photos: photoUpcs.length, photosOnly });
    } catch (error: any) {
      console.error("Error in upcs-count:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/admin/upload-upcs", async (req, res) => {
    try {
      const { upcs } = req.body;
      if (!Array.isArray(upcs) || upcs.length === 0) {
        return res.status(400).json({ error: "No se proporcionaron UPCs" });
      }
      
      // Eliminar duplicados EXACTOS dentro del mismo archivo para evitar el error de Postgres:
      // "ON CONFLICT DO UPDATE command cannot affect row a second time"
      const uniqueUpcs = Array.from(new Set(upcs.map(u => String(u).trim()).filter(u => u.length > 0)));

      const supabase = getSupabaseAdmin();
      const chunkSize = 10000;
      let totalInserted = 0;
      
      for (let i = 0; i < uniqueUpcs.length; i += chunkSize) {
        const chunk = uniqueUpcs.slice(i, i + chunkSize).map(upc => ({ upc }));
        if (chunk.length > 0) {
          const { error } = await supabase.from('published_upcs').upsert(chunk, { onConflict: 'upc', ignoreDuplicates: true });
          if (error) {
            console.error("Error upserting chunk", i, error);
            throw error;
          }
          totalInserted += chunk.length;
        }
      }
      
      const { count } = await supabase
        .from('published_upcs')
        .select('upc', { count: 'exact', head: true });

      res.json({ message: `${totalInserted} UPCs procesados correctamente`, count: count ?? null });
    } catch (error: any) {
      console.error("Error in upload-upcs:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware setup
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
