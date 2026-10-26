import express from "express";
import { GoogleGenAI } from "@google/genai";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const app = express();
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

// API Routes
app.get("/api/products/validate/:upc", async (req, res) => {
  try {
    const { upc } = req.params;
    const supabase = getSupabaseAdmin();
    
    const { data: dataProducts, error: errProducts } = await supabase
      .from('products')
      .select('id')
      .eq('upc', upc)
      .limit(1);

    if (errProducts) throw errProducts;
    
    const { data: dataPublished, error: errPublished } = await supabase
      .from('published_upcs')
      .select('upc')
      .eq('upc', upc)
      .maybeSingle();
      
    if (errPublished) throw errPublished;

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

    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name }
    });

    if (authError) throw authError;
    if (!authUser.user) throw new Error("No se pudo crear el usuario en la autenticación.");

    const { error: profileError } = await supabase
      .from('profiles')
      .upsert({
        id: authUser.user.id,
        email,
        name,
        role
      });

    if (profileError) {
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
    await supabase.from('profiles').delete().eq('id', userId);
    const { error } = await supabase.auth.admin.deleteUser(userId);

    if (error) throw error;
    return res.json({ success: true });
  } catch (error: any) {
    console.error("Error deleting user:", error);
    return res.status(500).json({ error: error.message || "Error al eliminar usuario" });
  }
});

app.post("/api/admin/update-user", async (req, res) => {
  try {
    const { userId, name, email, role, password } = req.body;
    if (!userId) {
      return res.status(400).json({ error: "Falta userId" });
    }

    const supabase = getSupabaseAdmin();

    // 1. Update Auth user if email, password or metadata changes
    const authUpdatePayload: any = {};
    if (email && email.trim()) authUpdatePayload.email = email.trim();
    if (password && password.trim().length >= 8) authUpdatePayload.password = password.trim();
    if (name && name.trim()) authUpdatePayload.user_metadata = { name: name.trim() };

    if (Object.keys(authUpdatePayload).length > 0) {
      const { error: authErr } = await supabase.auth.admin.updateUserById(userId, authUpdatePayload);
      if (authErr) throw authErr;
    }

    // 2. Update Profile row in Supabase database
    const profileUpdatePayload: any = {};
    if (name && name.trim()) profileUpdatePayload.name = name.trim();
    if (email && email.trim()) profileUpdatePayload.email = email.trim();
    if (role && (role === 'admin' || role === 'user')) profileUpdatePayload.role = role;

    if (Object.keys(profileUpdatePayload).length > 0) {
      const { error: profileErr } = await supabase
        .from('profiles')
        .update(profileUpdatePayload)
        .eq('id', userId);
      if (profileErr) throw profileErr;
    }

    return res.json({ success: true });
  } catch (error: any) {
    console.error("Error updating user:", error);
    return res.status(500).json({ error: error.message || "Error al actualizar perfil del colaborador" });
  }
});

async function softDeleteProducts(supabase: any, docIds: string[]) {
  const { error } = await supabase
    .from('products')
    .update({ deleted_at: new Date().toISOString() })
    .in('id', docIds);

  if (!error) return { softDeleted: true };

  const missingColumn = error.code === '42703' || /deleted_at/i.test(error.message || '');
  if (!missingColumn) throw error;

  const { error: delErr } = await supabase.from('products').delete().in('id', docIds);
  if (delErr) throw delErr;
  return { softDeleted: false };
}

app.get("/api/admin/reports", async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const supabase = getSupabaseAdmin();

    const { data: users, error: usersErr } = await supabase
      .from('profiles')
      .select('*')
      .limit(100);

    if (usersErr) throw usersErr;

    const reports = [];
    for (const u of (users || [])) {
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
    const limitNum = parseInt(req.query.limit as string) || 1000;
    let { data, error } = await supabase
      .from('products')
      .select('*')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(limitNum);

    if (error && (error.code === '42703' || /deleted_at/i.test(error.message || ''))) {
      ({ data, error } = await supabase
        .from('products')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limitNum));
    }

    if (error) throw error;
    
    const mappedProducts = (data || []).map(p => ({
      $id: p.id,
      upc: p.upc,
      imageUrl: p.image_url,
      fileId: p.file_path,
      imageUrl2: p.image_url_2 || null,
      fileId2: p.file_path_2 || null,
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
    const { data: prod, error: readErr } = await supabase
      .from('products')
      .select('upc')
      .eq('id', docId)
      .maybeSingle();
    if (readErr) throw readErr;

    await softDeleteProducts(supabase, [docId]);

    const upcToKeep = prod?.upc ? String(prod.upc).trim() : null;
    if (upcToKeep) {
      await supabase
        .from('published_upcs')
        .upsert([{ upc: upcToKeep }], { onConflict: 'upc', ignoreDuplicates: true });
    }

    if (fileId) {
      try {
        await supabase.storage.from('product-photos').remove([fileId]);
      } catch (storageErr: any) {
        console.warn("Storage deletion error:", storageErr.message);
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
    const { items } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Faltan items para eliminar" });
    }

    const supabase = getSupabaseAdmin();
    const docIds = items.map((i: any) => i.docId).filter(Boolean);
    const fileIds = items.map((i: any) => i.fileId).filter(Boolean);

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

    if (docIds.length > 0) {
      await softDeleteProducts(supabase, docIds);
    }

    if (upcsToKeep.length > 0) {
      await supabase
        .from('published_upcs')
        .upsert(upcsToKeep.map(upc => ({ upc })), { onConflict: 'upc', ignoreDuplicates: true });
    }

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

app.post("/api/gemini/extract-upc", async (req, res) => {
  try {
    const { base64Image } = req.body;
    if (!base64Image) {
      return res.status(400).json({ error: "Falta la imagen" });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: "GEMINI_API_KEY no está configurada en las variables de entorno." });
    }

    const candidateModels = [
      process.env.GEMINI_UPC_MODEL || 'gemini-3.5-flash-lite',
      'gemini-3.5-flash',
      'gemini-flash-latest'
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
            config: {
              maxOutputTokens: 50,
              temperature: 0.1,
            }
          });

          const textOutput = response.text?.trim() || 'NOT_FOUND';
          if (textOutput === 'NOT_FOUND') {
            throw new Error("No se detectó el código UPC. Intenta de nuevo o digítalo.");
          }
          return textOutput.replace(/[^0-9A-Z]/gi, '');
        }, 2, 800);

        if (result) break;
      } catch (modelErr: any) {
        console.warn(`[extract-upc] Modelo ${currentModel} falló:`, modelErr.message || modelErr);
        lastError = modelErr;
        if (modelErr.message && modelErr.message.includes("No se detectó el código UPC")) {
          throw modelErr;
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
      return res.status(500).json({ error: "GEMINI_API_KEY no está configurada en las variables de entorno." });
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
      return res.status(500).json({ error: "GEMINI_API_KEY no está configurada en las variables de entorno." });
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

INSTRUCCIONES Y REGLAS ESTRICTAS:
1. Transcribe en "transcription" fielmente lo dicho por el operador.
2. Genera en "title" un título comercial conciso y directo con un MÁXIMO DE 60 CARACTERES.
3. Genera en "description" una descripción profesional para tienda web con los atributos esenciales y un MÁXIMO DE 500 CARACTERES.
   - REGLA DE ADJETIVOS: Usa un MÁXIMO DE 2 ADJETIVOS calificativos en toda la descripción. Prioriza datos objetivos y descriptivos (material, color, uso, dimensiones o especificaciones) sin adornos ni florituras excesivas.

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

// Regenerar individualmente título o descripción
app.post("/api/gemini/regenerate-field", async (req, res) => {
  try {
    const { field, transcription, currentTitle, currentDescription, base64Image, upcCode } = req.body;
    if (!field || (field !== 'title' && field !== 'description')) {
      return res.status(400).json({ error: "Campo a regenerar inválido (debe ser 'title' o 'description')." });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: "GEMINI_API_KEY no está configurada." });
    }

    const candidateModels = [
      process.env.GEMINI_AUDIO_MODEL || 'gemini-3.5-flash-lite',
      'gemini-3.5-flash',
      'gemini-flash-latest',
      'gemini-3.8-flash'
    ];
    const uniqueModels = Array.from(new Set(candidateModels));

    const parts: any[] = [];
    if (base64Image) {
      const cleanImgBase64 = base64Image.split(',')[1] || base64Image;
      parts.push({
        inlineData: {
          mimeType: 'image/jpeg',
          data: cleanImgBase64,
        },
      });
    }

    const promptContext = `Actúa como catalogador e-commerce profesional para Stevens.
${upcCode ? `Código UPC: ${upcCode}.\n` : ''}
CONTEXTO DISPONIBLE:
- Transcripción de voz del operador: "${transcription || 'No disponible'}"
- Título actual: "${currentTitle || 'No especificado'}"
- Descripción actual: "${currentDescription || 'No especificada'}"

TAREA ESPECÍFICA:
${field === 'title' 
  ? `Genera un NUEVO título comercial atractivo, conciso y diferente para este producto.
REGLAS:
- MÁXIMO 60 CARACTERES (<= 60 caracteres).
- Debe incluir tipo de producto, marca/modelo o característica principal.
- Responde ÚNICAMENTE un JSON con: {"title": "..."}`
  : `Genera una NUEVA descripción comercial para tienda web con los atributos esenciales del producto.
REGLAS:
- MÁXIMO 500 CARACTERES (<= 500 caracteres).
- REGLA DE ADJETIVOS: Usa un MÁXIMO DE 2 ADJETIVOS calificativos en toda la descripción. Prioriza datos objetivos y descriptivos (material, color, uso, dimensiones o especificaciones) sin adornos ni florituras excesivas.
- Responde ÚNICAMENTE un JSON con: {"description": "..."}`
}`;

    parts.push({ text: promptContext });

    let result: any = null;
    let lastError: any = null;

    for (const currentModel of uniqueModels) {
      try {
        result = await executeWithRetry(async () => {
          const client = getGeminiClient();
          const response = await client.models.generateContent({
            model: currentModel,
            contents: { parts },
            config: {
              responseMimeType: "application/json",
              maxOutputTokens: 300,
              temperature: 0.4
            }
          });

          const textOutput = response.text?.trim() || '';
          const parsed = JSON.parse(textOutput);
          if (field === 'title') {
            let clean = (parsed.title || textOutput).trim();
            if (clean.length > 60) clean = clean.substring(0, 60).trim();
            return { title: clean };
          } else {
            let clean = (parsed.description || textOutput).trim();
            if (clean.length > 500) clean = clean.substring(0, 500).trim();
            return { description: clean };
          }
        }, 2, 800);

        if (result) break;
      } catch (modelErr: any) {
        console.warn(`[regenerate-field] Modelo ${currentModel} falló:`, modelErr.message || modelErr);
        lastError = modelErr;
      }
    }

    if (!result) {
      let cleanMsg = lastError?.message || "No se pudo regenerar el campo con IA.";
      return res.status(500).json({ error: cleanMsg });
    }

    return res.json(result);
  } catch (error: any) {
    console.error("Error in regenerate-field endpoint:", error);
    return res.status(500).json({ error: error.message || "Error al regenerar el campo" });
  }
});

app.get("/api/admin/upcs-count", async (_req, res) => {
  try {
    const supabase = getSupabaseAdmin();

    const { count: inventoryCount, error } = await supabase
      .from('published_upcs')
      .select('upc', { count: 'exact', head: true });

    if (error) {
      throw new Error(`${error.message}${error.hint ? ' — ' + error.hint : ''}`);
    }

    const { data: productRows, error: errProducts } = await supabase
      .from('products')
      .select('upc');
    if (errProducts) throw errProducts;

    const photoUpcs = Array.from(
      new Set((productRows || []).map(r => String(r.upc).trim()).filter(Boolean))
    );

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

    res.json({ count: total, inventory, photos: photoUpcs.length, photosOnly });
  } catch (error: any) {
    console.error("Error in upcs-count:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/admin/upload-upcs", async (req, res) => {
  try {
    const { upcs } = req.body;
    if (!upcs || !Array.isArray(upcs) || upcs.length === 0) {
      return res.status(400).json({ error: "Falta el arreglo de UPCs" });
    }

    const supabase = getSupabaseAdmin();
    const uniqueUpcs = Array.from(new Set(upcs.map((u: any) => String(u).trim()).filter((u: string) => u.length > 0)));
    const rows = uniqueUpcs.map(u => ({ upc: u }));

    const chunkSize = 1000;
    let totalInserted = 0;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const { error } = await supabase
        .from('published_upcs')
        .upsert(chunk, { onConflict: 'upc', ignoreDuplicates: true });

      if (error) throw error;
      totalInserted += chunk.length;
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

export default app;
