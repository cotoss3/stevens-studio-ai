
import React, { useState, useEffect, useRef } from 'react';
import { 
  Package, X,
  Database, 
  Barcode, 
  CheckCircle, 
  ArrowLeft, 
  Download, 
  Loader2, 
  AlertCircle,
  FileText,
  Cloud,
  ExternalLink,
  LogOut,
  Sparkles,
  Zap,
  User as UserIcon,
  Lock,
  Plus,
  Trash2,
  Users,
  TrendingUp,
  RefreshCw,
  Calendar,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Pencil,
  Keyboard,
  Maximize2,
  CheckCircle2,
  Eye,
  Camera as CameraIcon,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { AppStep, AppState, User } from './types';
import Camera from './components/Camera';
import AudioRecorder from './components/AudioRecorder';
import FullscreenPhotoModal from './components/FullscreenPhotoModal';
import { geminiService } from './services/geminiService';
import { supabase } from './services/supabase';
import { processAndResizeProductImage } from './services/imageProcessor';
import { createZip, uniqueName } from './services/zipUtils';
import type { ZipEntry } from './services/zipUtils';

const DEFAULT_BUCKET_NAME = 'product-photos';

/**
 * Extrae de forma inteligente únicamente los códigos UPC/barras válidos de cualquier texto,
 * archivo CSV, TXT o copiado directo de Excel / Supabase.
 * Ignora filas de encabezado (UPC, fecha, barcode), marcas de tiempo, fechas, saltos de línea y basura.
 */
function extractUpcsFromRawText(text: string): string[] {
  if (!text || !text.trim()) return [];
  const lines = text.split(/[\r\n]+/);
  const result: string[] = [];
  
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    
    // Ignorar encabezados comunes
    if (/^(upc|c[oó]digo|barcode|item|producto|sku|id)[\s,;\t]/i.test(line) || /^(upc|c[oó]digo|barcode|item|producto|sku|id)$/i.test(line)) {
      continue;
    }

    // Si tiene columnas separadas por tabulación, coma, punto y coma o 2+ espacios (como lo que pega Supabase o Excel)
    const parts = line.split(/[\t,;]|\s{2,}/);
    if (parts.length > 1) {
      const first = parts[0].trim().replace(/^["']|["']$/g, '');
      // Asegurarse de que el primer valor no sea una fecha (como 2026-10-15)
      if (first && !/^\d{4}-\d{2}-\d{2}/.test(first) && first.length >= 3 && first.length <= 32) {
        result.push(first);
        continue;
      }
    }

    // Si es una sola línea con código o varios códigos separados por espacios
    const tokens = line.split(/\s+/).map(t => t.trim().replace(/^["']|["']$/g, ''));
    for (const t of tokens) {
      // Filtrar fechas (ej: 2026-10-15), horas (ej: 21:04:49.842079+00) y basura
      if (!t || /^\d{4}-\d{2}-\d{2}/.test(t) || /^\d{2}:\d{2}/.test(t) || /^\+\d{2}/.test(t)) {
        continue;
      }
      // Si parece un código de producto (mínimo 3 caracteres alfanuméricos)
      if (t.length >= 3 && t.length <= 32) {
        result.push(t);
      }
    }
  }

  return result;
}

const App: React.FC = () => {
  const [state, setState] = useState<AppState>(() => {
    const savedUser = localStorage.getItem('cataloger_user');
    const user = savedUser ? JSON.parse(savedUser) : null;
    
    let initialStep = AppStep.LOGIN;
    if (user) {
      const role = String(user.role).toLowerCase().trim();
      if (window.location.pathname === '/dashboard') {
        if (role === 'admin') {
          initialStep = AppStep.ADMIN_DASHBOARD;
        } else {
          window.history.replaceState({}, '', '/');
          initialStep = AppStep.SCAN_UPC;
        }
      } else {
        // If they are on home, we just show scanner, even for admin
        initialStep = AppStep.SCAN_UPC;
      }
    }

    return {
      step: initialStep,
      upcCode: null,
      upcImage: null,
      productImage: null,
      productImage2: null,
      audioBase64: null,
      transcription: null,
      productTitle: null,
      productDescription: null,
      isProcessing: false,
      error: null,
      user: user
    };
  });

  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'success'>('idle');
  const [processingMessage, setProcessingMessage] = useState<string>('');
  const [processingElapsed, setProcessingElapsed] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!state.isProcessing) {
      setProcessingElapsed(0);
      return;
    }
    const start = Date.now();
    const interval = setInterval(() => {
      setProcessingElapsed(Math.floor((Date.now() - start) / 1000));
    }, 500);
    return () => clearInterval(interval);
  }, [state.isProcessing]);

  const getCalmStageInfo = () => {
    if (state.step === AppStep.SCAN_UPC) {
      if (processingElapsed < 2) {
        return {
          badge: 'Etapa 1 de 3',
          title: 'Detectando código de barras...',
          subtitle: 'Enfocando y leyendo la nitidez del código en la imagen.',
          progress: 35
        };
      }
      if (processingElapsed < 4) {
        return {
          badge: 'Etapa 2 de 3',
          title: 'Descifrando dígitos UPC...',
          subtitle: 'Extrayendo con IA el número exacto del producto.',
          progress: 70
        };
      }
      return {
        badge: 'Etapa 3 de 3',
        title: 'Verificando en catálogo...',
        subtitle: 'Comprobando que no esté registrado previamente para evitar duplicados.',
        progress: 92
      };
    }

    if (state.step === AppStep.PRODUCT_PHOTO) {
      if (processingElapsed < 2) {
        return {
          badge: 'Etapa 1 de 4',
          title: 'Analizando silueta del producto...',
          subtitle: 'Detectando bordes, contornos y detalles con inteligencia artificial.',
          progress: 25
        };
      }
      if (processingElapsed < 4) {
        return {
          badge: 'Etapa 2 de 4',
          title: 'Creando fondo blanco puro...',
          subtitle: 'Eliminando sombras y objetos de fondo para estilo catálogo web.',
          progress: 55
        };
      }
      if (processingElapsed < 7) {
        return {
          badge: 'Etapa 3 de 4',
          title: 'Centrando e iluminando...',
          subtitle: 'Ajustando escala al 80% y balanceando luces profesionales Full HD.',
          progress: 80
        };
      }
      return {
        badge: 'Etapa 4 de 4',
        title: 'Perfeccionando imagen 1000x1000 px...',
        subtitle: 'Casi listo. Asegurando el estándar óptimo de la tienda.',
        progress: 92
      };
    }

    return {
      badge: 'Guardando',
      title: processingMessage || 'Procesando información...',
      subtitle: 'Sincronizando de forma segura en el sistema.',
      progress: Math.min(85, 30 + processingElapsed * 15)
    };
  };

  const calmStageInfo = getCalmStageInfo();

  // States for Login form
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // States for Admin dashboard
  const [adminSection, setAdminSection] = useState<'reports' | 'users' | 'photos' | 'upcs' | 'config'>('reports');
  const [reportData, setReportData] = useState<any[]>([]);
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [usersList, setUsersList] = useState<any[]>([]);
  const [photosList, setPhotosList] = useState<any[]>([]);
  const [isAdminActionLoading, setIsAdminActionLoading] = useState(false);
  
  // Advanced Catalog States
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [selectedPhotos, setSelectedPhotos] = useState<Set<string>>(new Set());
  const [gridSize, setGridSize] = useState<'small' | 'medium' | 'large'>('medium');
  const [photosCurrentPage, setPhotosCurrentPage] = useState<number>(1);
  const PHOTOS_PER_PAGE = 20;

  const [adminErrorMsg, setAdminErrorMsg] = useState<string | null>(null);
  const [adminSuccessMsg, setAdminSuccessMsg] = useState<string | null>(null);

  // UPC Mass Upload States & Progress Bar
  const [upcProgress, setUpcProgress] = useState<{
    isActive: boolean;
    current: number;
    total: number;
    percentage: number;
    currentBatch: number;
    totalBatches: number;
    statusText: string;
    isComplete: boolean;
    error?: string | null;
  } | null>(null);
  const [upcFileSummary, setUpcFileSummary] = useState<{
    fileName: string;
    count: number;
  } | null>(null);
  const cancelUpcUploadRef = useRef<boolean>(false);
  const [cameraKey, setCameraKey] = useState<number>(0);

  // Sync state with URL on popstate (back/forward buttons)
  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname.replace(/\/$/, '');
      if (state.user) {
        const role = String(state.user.role).toLowerCase().trim();
        if (path === '/dashboard' || path.includes('dashboard')) {
          if (role === 'admin') {
            setState(prev => ({ ...prev, step: AppStep.ADMIN_DASHBOARD }));
          } else {
            window.history.replaceState({}, '', '/');
            setState(prev => ({ ...prev, step: AppStep.SCAN_UPC }));
          }
        } else {
          setState(prev => ({ ...prev, step: AppStep.SCAN_UPC }));
        }
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [state.user]);

  // States for Create User form
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [newUserRole, setNewUserRole] = useState<'admin' | 'user'>('user');

  // States for Edit Collaborator modal
  const [editingUser, setEditingUser] = useState<any | null>(null);
  const [editUserName, setEditUserName] = useState('');
  const [editUserEmail, setEditUserEmail] = useState('');
  const [editUserRole, setEditUserRole] = useState<'admin' | 'user'>('user');
  const [editUserPassword, setEditUserPassword] = useState('');



  // States for Manual UPC input modal and cancel controls
  const [showManualUpcModal, setShowManualUpcModal] = useState(false);
  const [manualUpcInput, setManualUpcInput] = useState('');
  const [manualUpcError, setManualUpcError] = useState<string | null>(null);
  const [isCheckingManualUpc, setIsCheckingManualUpc] = useState(false);
  const upcAbortControllerRef = useRef<AbortController | null>(null);

  // States for Fullscreen Photo Inspection (Standards verification)
  const [isFullscreenOpen, setIsFullscreenOpen] = useState(false);
  const [fullscreenPhotoData, setFullscreenPhotoData] = useState<{
    url: string;
    upc?: string | null;
    title?: string | null;
    showApproval?: boolean;
  } | null>(null);

  const openFullscreenPhoto = (
    url: string,
    upc?: string | null,
    title?: string | null,
    showApproval = false
  ) => {
    setFullscreenPhotoData({ url, upc, title, showApproval });
    setIsFullscreenOpen(true);
  };

  const copyOrigin = () => {
    navigator.clipboard.writeText(window.location.origin);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const compressBarcodeImage = async (dataUrl: string, maxDim = 800, quality = 0.82): Promise<string> => {
    return new Promise((resolve) => {
      try {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          if (width > height) {
            if (width > maxDim) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            }
          } else {
            if (height > maxDim) {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/jpeg', quality));
          } else {
            resolve(dataUrl);
          }
        };
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
      } catch {
        resolve(dataUrl);
      }
    });
  };

  const handleCancelProcessing = () => {
    if (upcAbortControllerRef.current) {
      try { upcAbortControllerRef.current.abort(); } catch {}
    }
    setState(prev => ({ ...prev, isProcessing: false, error: null }));
    setCameraKey(k => k + 1);
  };

  const handleManualUpcSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanCode = manualUpcInput.trim().replace(/[^0-9A-Za-z]/g, '');
    if (!cleanCode || cleanCode.length < 3) {
      setManualUpcError('Por favor ingresa un código UPC válido (al menos 3 dígitos).');
      return;
    }

    setIsCheckingManualUpc(true);
    setManualUpcError(null);

    if (upcAbortControllerRef.current) {
      try { upcAbortControllerRef.current.abort(); } catch {}
    }

    try {
      const validateRes = await fetch(`/api/products/validate/${cleanCode}`).then(r => r.json());
      if (validateRes.exists) {
        setShowManualUpcModal(false);
        setState(prev => ({
          ...prev,
          error: 'DUPLICATE_UPC:' + cleanCode,
          isProcessing: false
        }));
        return;
      }

      setShowManualUpcModal(false);
      setManualUpcInput('');
      setState(prev => ({
        ...prev,
        upcCode: cleanCode,
        step: AppStep.PRODUCT_PHOTO,
        isProcessing: false,
        error: null
      }));
    } catch (err: any) {
      setManualUpcError(err.message || 'Error al validar el código UPC.');
    } finally {
      setIsCheckingManualUpc(false);
    }
  };

  const handleCaptureUPC = async (image: string) => {
    if (upcAbortControllerRef.current) {
      try { upcAbortControllerRef.current.abort(); } catch {}
    }
    const abortController = new AbortController();
    upcAbortControllerRef.current = abortController;

    setProcessingMessage('IDENTIFICANDO PRODUCTO...');
    setState(prev => ({ ...prev, isProcessing: true, error: null, upcImage: image }));

    // Abort after 10 seconds of analysis so operator is never trapped
    const timeoutId = setTimeout(() => {
      try {
        abortController.abort(new Error('TIMEOUT'));
      } catch {}
    }, 10000);

    try {
      // Compress barcode image with high clarity for barcode line reading
      const compressedImage = await compressBarcodeImage(image, 1200, 0.88);

      const upc = await geminiService.extractUPC(
        compressedImage,
        (attempt, delayMs) => {
          setProcessingMessage(`REINTENTANDO LECTURA (${attempt}/2) EN ${Math.round(delayMs / 1000)}s...`);
        },
        abortController.signal
      );
      
      clearTimeout(timeoutId);

      setProcessingMessage('VALIDANDO UPC CON BASE DE DATOS...');
      const validateRes = await fetch(`/api/products/validate/${upc}`, { signal: abortController.signal }).then(r => r.json());
      if (validateRes.exists) {
        throw new Error('DUPLICATE_UPC:' + upc);
      }

      setState(prev => ({
        ...prev,
        upcCode: upc,
        step: AppStep.PRODUCT_PHOTO,
        isProcessing: false
      }));
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (abortController.signal.aborted) {
        if (err?.name === 'AbortError' || err?.message === 'TIMEOUT' || abortController.signal.reason?.message === 'TIMEOUT') {
          setState(prev => ({
            ...prev,
            error: "La lectura del código tomó más de 10s. Puedes escribir el código manualmente o reintentar con mejor luz.",
            isProcessing: false
          }));
          return;
        }
        return;
      }
      setState(prev => ({
        ...prev,
        error: err.message || "Error al leer el código.",
        isProcessing: false
      }));
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const [capturingPhotoSlot, setCapturingPhotoSlot] = useState<1 | 2>(1);
  const [lastProductRawImage, setLastProductRawImage] = useState<string | null>(null);
  const [lastProductRawImage2, setLastProductRawImage2] = useState<string | null>(null);

  const handleCaptureProduct = async (image: string) => {
    const slot = capturingPhotoSlot;
    if (slot === 1) {
      setLastProductRawImage(image);
    } else {
      setLastProductRawImage2(image);
    }

    setProcessingMessage(`GENERANDO FOTO ${slot} E-COMMERCE (FONDO BLANCO)...`);
    setState(prev => ({ ...prev, isProcessing: true, error: null }));
    
    try {
      const studioImage = await geminiService.transformToStudioShot(image, (attempt, delayMs) => {
        setProcessingMessage(`REINTENTANDO FOTO ${slot} CON IA (${attempt}/3) EN ${Math.round(delayMs / 1000)}s...`);
      });
      
      setProcessingMessage(`CENTRANDO FOTO ${slot} (≥80%) Y AJUSTANDO A 1000x1000 px FONDO BLANCO...`);
      const finalResizedImage = await processAndResizeProductImage(studioImage);

      setState(prev => ({
        ...prev,
        productImage: slot === 1 ? finalResizedImage : prev.productImage,
        productImage2: slot === 2 ? finalResizedImage : prev.productImage2,
        step: AppStep.PRODUCT_PHOTO,
        isProcessing: false
      }));
    } catch (err: any) {
      let rawMsg = err.message || "Reintenta.";
      try {
        const parsed = JSON.parse(rawMsg);
        if (parsed?.error?.message) rawMsg = parsed.error.message;
      } catch {}

      let friendlyError = "Error en el estudio AI: " + rawMsg;
      if (/503|high demand|alta demanda|UNAVAILABLE/i.test(rawMsg)) {
        friendlyError = "El estudio de IA tiene alta demanda momentánea de Google. Puedes reintentar o usar la foto directamente.";
      }

      setState(prev => ({
        ...prev,
        error: friendlyError,
        isProcessing: false
      }));
    }
  };

  const handleUseDirectPhoto = async () => {
    const slot = capturingPhotoSlot;
    const rawToUse = slot === 1 ? lastProductRawImage : lastProductRawImage2;
    if (!rawToUse) return;

    setProcessingMessage(`OPTIMIZANDO Y CENTRANDO FOTO ${slot} A 1000x1000 px FONDO BLANCO...`);
    setState(prev => ({ ...prev, isProcessing: true, error: null }));
    try {
      const finalResizedImage = await processAndResizeProductImage(rawToUse);
      setState(prev => ({
        ...prev,
        productImage: slot === 1 ? finalResizedImage : prev.productImage,
        productImage2: slot === 2 ? finalResizedImage : prev.productImage2,
        step: AppStep.PRODUCT_PHOTO,
        isProcessing: false
      }));
    } catch {
      setState(prev => ({
        ...prev,
        productImage: slot === 1 ? rawToUse : prev.productImage,
        productImage2: slot === 2 ? rawToUse : prev.productImage2,
        step: AppStep.PRODUCT_PHOTO,
        isProcessing: false
      }));
    }
  };

  const handleScanAnother = () => {
    if (upcAbortControllerRef.current) {
      try { upcAbortControllerRef.current.abort(); } catch {}
    }
    setState(prev => ({
      ...prev,
      error: null,
      step: AppStep.SCAN_UPC,
      upcImage: null,
      upcCode: '',
      isProcessing: false
    }));
    setCapturingPhotoSlot(1);
    setCameraKey(k => k + 1);
  };

  const reset = () => {
    setState(prev => ({
      ...prev,
      step: AppStep.SCAN_UPC,
      upcCode: null,
      upcImage: null,
      productImage: null,
      productImage2: null,
      audioBase64: null,
      transcription: null,
      productTitle: null,
      productDescription: null,
      isProcessing: false,
      error: null
    }));
    setLastProductRawImage(null);
    setLastProductRawImage2(null);
    setCapturingPhotoSlot(1);
    setUploadStatus('idle');
    setProcessingMessage('');
    setCameraKey(k => k + 1);
  };

  // Convert base64 to File object
  const base64ToFile = (base64Data: string, filename: string): File => {
    const arr = base64Data.split(',');
    const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/jpeg';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new File([u8arr], filename, { type: mime });
  };

  const saveToSupabase = async () => {
    if (!state.productImage || !state.upcCode) return;

    setUploadStatus('uploading');
    setProcessingMessage('GUARDANDO FOTO DEL PRODUCTO...');
    setState(prev => ({ ...prev, isProcessing: true, error: null }));

    try {
      const ts = Date.now();
      // Foto 1: obligatoria, convención UPC_1.jpg (con timestamp para cache-busting en storage)
      const file1 = base64ToFile(state.productImage, `${state.upcCode}_1.jpg`);
      const filePath1 = `${state.upcCode}_1_${ts}.jpg`;
      
      const { data: uploadRes1, error: uploadErr1 } = await supabase.storage
        .from(DEFAULT_BUCKET_NAME)
        .upload(filePath1, file1, {
          cacheControl: '3600',
          upsert: true
        });

      if (uploadErr1) throw uploadErr1;

      const { data: { publicUrl: publicUrl1 } } = supabase.storage
        .from(DEFAULT_BUCKET_NAME)
        .getPublicUrl(filePath1);

      // Foto 2: opcional, convención UPC_2.jpg
      let publicUrl2: string | null = null;
      let filePath2: string | null = null;
      if (state.productImage2) {
        setProcessingMessage('GUARDANDO SEGUNDA FOTO DEL PRODUCTO (_2.jpg)...');
        const file2 = base64ToFile(state.productImage2, `${state.upcCode}_2.jpg`);
        filePath2 = `${state.upcCode}_2_${ts}.jpg`;

        const { error: uploadErr2 } = await supabase.storage
          .from(DEFAULT_BUCKET_NAME)
          .upload(filePath2, file2, {
            cacheControl: '3600',
            upsert: true
          });

        if (uploadErr2) {
          console.warn("[saveToSupabase] Error al subir foto 2:", uploadErr2);
        } else {
          const { data: { publicUrl: pUrl2 } } = supabase.storage
            .from(DEFAULT_BUCKET_NAME)
            .getPublicUrl(filePath2);
          publicUrl2 = pUrl2;
        }
      }

      setProcessingMessage('REGISTRANDO PRODUCTO Y FICHA EN EL SISTEMA...');

      // Validar regla de caracteres en el título (<= 60) y descripción (<= 160)
      const safeTitle = state.productTitle ? state.productTitle.trim().slice(0, 60) : null;
      const safeDesc = state.productDescription ? state.productDescription.trim().slice(0, 160) : null;

      // Insertar producto en la base de datos con información completa
      const productPayload: any = {
        upc: state.upcCode,
        image_url: publicUrl1,
        file_path: filePath1,
        image_url_2: publicUrl2,
        file_path_2: filePath2,
        user_id: state.user?.id || null,
        user_name: state.user?.name || 'Usuario',
        title: safeTitle,
        description: safeDesc,
        transcription: state.transcription || null,
      };

      let { error: dbErr } = await supabase
        .from('products')
        .insert(productPayload);

      // Fallback si las columnas opcionales (_2 o audio/detalles) aún no existen en la tabla
      if (dbErr && (dbErr.code === '42703' || /image_url_2|file_path_2|title|description|transcription/i.test(dbErr.message || ''))) {
        console.warn("[saveToSupabase] Alguna columna extendida no existe aún en la BDD. Reintentando con campos compatibles.");
        delete productPayload.image_url_2;
        delete productPayload.file_path_2;

        let { error: retryErr } = await supabase
          .from('products')
          .insert(productPayload);

        if (retryErr && (retryErr.code === '42703' || /title|description|transcription/i.test(retryErr.message || ''))) {
          delete productPayload.title;
          delete productPayload.description;
          delete productPayload.transcription;

          const { error: fallbackErr } = await supabase
            .from('products')
            .insert(productPayload);

          if (fallbackErr) throw fallbackErr;
        } else if (retryErr) {
          throw retryErr;
        }
      } else if (dbErr) {
        throw dbErr;
      }

      setUploadStatus('success');
      setState(prev => ({ ...prev, isProcessing: false }));
      loadUpcsCount();
    } catch (err: any) {
      console.error("Supabase save error:", err);
      setState(prev => ({
        ...prev,
        error: "Error al guardar en Supabase: " + (err.message || err.toString()),
        isProcessing: false
      }));
      setUploadStatus('idle');
    }
  };

  const logout = async () => {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.warn("No active Supabase session found on logout.");
    }
    localStorage.removeItem('cataloger_user');
    setState(prev => ({
      ...prev,
      user: null,
      step: AppStep.LOGIN
    }));
  };

  const handleDownload = async () => {
    if (!state.productImage || !state.upcCode) return;
    try {
      const upcClean = state.upcCode;

      // Si tiene Foto 2, empaquetamos ambas en un archivo ZIP para evitar que el navegador o móvil bloquee la segunda descarga
      if (state.productImage2) {
        setProcessingMessage('PREPARANDO DESCARGA DE AMBAS FOTOS (_1.jpg y _2.jpg)...');
        const res1 = await fetch(state.productImage);
        const buf1 = await res1.arrayBuffer();

        const res2 = await fetch(state.productImage2);
        const buf2 = await res2.arrayBuffer();

        const entries: ZipEntry[] = [
          { name: `${upcClean}_1.jpg`, data: new Uint8Array(buf1), date: new Date() },
          { name: `${upcClean}_2.jpg`, data: new Uint8Array(buf2), date: new Date() }
        ];

        const zipBlob = createZip(entries);
        const zipUrl = window.URL.createObjectURL(zipBlob);
        const link = document.createElement('a');
        link.href = zipUrl;
        link.download = `${upcClean}_fotos.zip`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => window.URL.revokeObjectURL(zipUrl), 3000);
        return;
      }

      // Si solo tiene Foto 1, descargamos directamente el archivo JPG
      const res1 = await fetch(state.productImage);
      const blob1 = await res1.blob();
      const url1 = window.URL.createObjectURL(blob1);
      const link1 = document.createElement('a');
      link1.href = url1;
      link1.download = `${upcClean}_1.jpg`;
      document.body.appendChild(link1);
      link1.click();
      document.body.removeChild(link1);
      setTimeout(() => window.URL.revokeObjectURL(url1), 3000);
    } catch (e) {
      console.warn("Fallback de descarga directa:", e);
      const link1 = document.createElement('a');
      link1.href = state.productImage;
      link1.download = `${state.upcCode}_1.jpg`;
      link1.click();
      if (state.productImage2) {
        setTimeout(() => {
          const link2 = document.createElement('a');
          link2.href = state.productImage2!;
          link2.download = `${state.upcCode}_2.jpg`;
          link2.click();
        }, 600);
      }
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginEmail || !loginPassword) {
      setState(prev => ({ ...prev, error: "Por favor, ingresa usuario y contraseña." }));
      return;
    }

    setState(prev => ({ ...prev, isProcessing: true, error: null }));
    setProcessingMessage('VERIFICANDO USUARIO...');

    try {
      let authEmail = loginEmail.trim();

      // Si el input no tiene @, se trata como nombre de usuario:
      // buscamos el correo en la tabla profiles por nombre (case-insensitive)
      if (!authEmail.includes('@')) {
        setProcessingMessage('BUSCANDO USUARIO EN BASE DE DATOS...');
        const { data: profilesByName, error: nameErr } = await supabase
          .from('profiles')
          .select('email')
          .ilike('name', authEmail)
          .limit(1);

        if (nameErr) throw new Error("Error al buscar usuario: " + nameErr.message);
        if (!profilesByName || profilesByName.length === 0) {
          throw new Error(`No se encontró el usuario "${authEmail}". Verifica el nombre o usa tu correo completo.`);
        }
        authEmail = profilesByName[0].email;
      }

      // 1. Autenticar con Supabase Auth
      setProcessingMessage('INICIANDO SESIÓN EN SUPABASE...');
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: authEmail,
        password: loginPassword
      });

      if (authError) throw authError;
      if (!authData.user) throw new Error("No se pudo iniciar sesión.");

      // 2. Obtener el perfil (rol y nombre)
      setProcessingMessage('VERIFICANDO ROL DE USUARIO...');
      const { data: profilesData, error: profileErr } = await supabase
        .from('profiles')
        .select('role, name')
        .eq('id', authData.user.id)
        .limit(1);

      if (profileErr) throw new Error("Error al consultar perfiles: " + profileErr.message);
      const profileData = profilesData && profilesData.length > 0 ? profilesData[0] : null;
      if (!profileData) {
        await supabase.auth.signOut();
        throw new Error("Tu usuario no tiene acceso a Stevens Studio AI. Contacta al administrador.");
      }

      const role = String(profileData.role).toLowerCase().trim() as 'admin' | 'user';
      const name = profileData?.name || authData.user.email?.split('@')[0] || 'Operador';

      const loggedInUser: User = {
        id: authData.user.id,
        name: name,
        email: authData.user.email || authEmail,
        role: role
      };

      localStorage.setItem('cataloger_user', JSON.stringify(loggedInUser));
      
      if (role === 'admin') {
        window.history.pushState({}, '', '/dashboard');
      } else {
        window.history.pushState({}, '', '/');
      }

      setState(prev => ({
        ...prev,
        user: loggedInUser,
        step: role === 'admin' ? AppStep.ADMIN_DASHBOARD : AppStep.SCAN_UPC,
        isProcessing: false
      }));
    } catch (err: any) {
      console.error("Login error:", err);
      setState(prev => ({
        ...prev,
        error: err.message || "Credenciales incorrectas. Verifica tu usuario y contraseña.",
        isProcessing: false
      }));
    }
  };

  const [upcsCount, setUpcsCount] = useState<number | null>(null);
  const [upcsBreakdown, setUpcsBreakdown] = useState<{ inventory: number; photosOnly: number } | null>(null);
  const [isUpcsCountLoading, setIsUpcsCountLoading] = useState(false);
  const [upcsCountError, setUpcsCountError] = useState<string | null>(null);

  /** Trae el total de UPCs publicados en el inventario. */
  const loadUpcsCount = async () => {
    setIsUpcsCountLoading(true);
    setUpcsCountError(null);
    try {
      const res = await fetch('/api/admin/upcs-count');
      const contentType = res.headers.get('content-type') || '';

      // Si el servidor aún no tiene la ruta, devuelve el index.html del SPA
      if (!contentType.includes('application/json')) {
        throw new Error('El endpoint /api/admin/upcs-count no responde JSON. Reinicia el servidor (npm run dev).');
      }

      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`);
      if (typeof json.count !== 'number') throw new Error('Respuesta sin el campo count.');

      setUpcsCount(json.count);
      if (typeof json.inventory === 'number' && typeof json.photosOnly === 'number') {
        setUpcsBreakdown({ inventory: json.inventory, photosOnly: json.photosOnly });
      }
    } catch (err: any) {
      setUpcsCount(null);
      setUpcsCountError(err.message || 'No se pudo obtener el total.');
      console.error('[upcs-count]', err);
    } finally {
      setIsUpcsCountLoading(false);
    }
  };

  const loadAdminData = async () => {
    setIsAdminActionLoading(true);
    setAdminErrorMsg(null);
    setAdminSuccessMsg(null);
    try {
      if (adminSection === 'reports') {
        const query = new URLSearchParams(); if (dateRange.start) query.append('startDate', dateRange.start); if (dateRange.end) query.append('endDate', dateRange.end); const res = await fetch('/api/admin/reports?' + query.toString()).then(r => r.json());
        if (res.error) throw new Error(res.error);
        setReportData(res);
      } else if (adminSection === 'users') {
        const res = await fetch('/api/admin/users').then(r => r.json());
        if (res.error) throw new Error(res.error);
        setUsersList(res);
      } else if (adminSection === 'photos') {
        const res = await fetch('/api/admin/products?limit=5000').then(r => r.json());
        if (res.error) throw new Error(res.error);
        setPhotosList(res);
      }
    } catch (err: any) {
      setAdminErrorMsg(err.message || "Error al cargar datos administrativos.");
    } finally {
      setIsAdminActionLoading(false);
    }
  };

  useEffect(() => {
    if (state.user && state.step === AppStep.ADMIN_DASHBOARD) {
      loadAdminData();
      loadUpcsCount();
    }
  }, [state.step, adminSection]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserEmail || !newUserPassword || !newUserName) {
      setAdminErrorMsg("Faltan campos obligatorios para el nuevo usuario.");
      return;
    }

    setIsAdminActionLoading(true);
    setAdminErrorMsg(null);
    setAdminSuccessMsg(null);
    try {
      const res = await fetch('/api/admin/create-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: newUserEmail,
          password: newUserPassword,
          name: newUserName,
          role: newUserRole
        })
      }).then(r => r.json());

      if (res.error) throw new Error(res.error);

      setAdminSuccessMsg(`Usuario ${newUserName} creado correctamente.`);
      setNewUserEmail('');
      setNewUserPassword('');
      setNewUserName('');
      loadAdminData();
    } catch (err: any) {
      setAdminErrorMsg(err.message || "Error al crear usuario.");
    } finally {
      setIsAdminActionLoading(false);
    }
  };

  const handleDeleteUser = async (userId: string, docId: string) => {
    if (!confirm("¿Estás seguro de eliminar este usuario? Perderá acceso inmediatamente.")) return;
    
    setIsAdminActionLoading(true);
    setAdminErrorMsg(null);
    setAdminSuccessMsg(null);
    try {
      const res = await fetch('/api/admin/delete-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, docId })
      }).then(r => r.json());

      if (res.error) throw new Error(res.error);

      setAdminSuccessMsg("Usuario eliminado.");
      loadAdminData();
    } catch (err: any) {
      setAdminErrorMsg(err.message || "Error al eliminar usuario.");
    } finally {
      setIsAdminActionLoading(false);
    }
  };

  const openEditUser = (usr: any) => {
    setEditingUser(usr);
    setEditUserName(usr.name || '');
    setEditUserEmail(usr.email || '');
    setEditUserRole((usr.role === 'admin' ? 'admin' : 'user'));
    setEditUserPassword('');
    setAdminErrorMsg(null);
    setAdminSuccessMsg(null);
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    if (!editUserName.trim() || !editUserEmail.trim()) {
      setAdminErrorMsg("Nombre y correo son obligatorios.");
      return;
    }

    setIsAdminActionLoading(true);
    setAdminErrorMsg(null);
    setAdminSuccessMsg(null);
    try {
      const res = await fetch('/api/admin/update-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: editingUser.userId,
          name: editUserName.trim(),
          email: editUserEmail.trim(),
          role: editUserRole,
          password: editUserPassword.trim() ? editUserPassword.trim() : undefined
        })
      }).then(r => r.json());

      if (res.error) throw new Error(res.error);

      setAdminSuccessMsg(`Perfil de ${editUserName} actualizado correctamente.`);
      setEditingUser(null);
      loadAdminData();
    } catch (err: any) {
      setAdminErrorMsg(err.message || "Error al actualizar perfil de colaborador.");
    } finally {
      setIsAdminActionLoading(false);
    }
  };

  const handleMassDelete = async (displayedPhotos: any[]) => {
    if (selectedPhotos.size === 0) return;
    if (!confirm(`¿Estás seguro de eliminar ${selectedPhotos.size} fotos? Esta acción no se puede deshacer.\n\nLos UPCs quedarán registrados en el inventario, así que no se podrán volver a fotografiar.`)) return;

    setIsAdminActionLoading(true);
    setAdminErrorMsg(null);
    setAdminSuccessMsg(null);
    try {
      const items = displayedPhotos.filter(p => selectedPhotos.has(p.$id)).map(p => ({ docId: p.$id, fileId: p.fileId }));
      const res = await fetch('/api/admin/delete-products-mass', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items })
      }).then(r => r.json());

      if (res.error) throw new Error(res.error);

      setAdminSuccessMsg(`Se eliminaron ${selectedPhotos.size} fotos correctamente.`);
      setSelectedPhotos(new Set());
      loadAdminData();
      loadUpcsCount();
    } catch (err: any) {
      setAdminErrorMsg(err.message || "Error al eliminar las fotos.");
    } finally {
      setIsAdminActionLoading(false);
    }
  };

  const [zipProgress, setZipProgress] = useState<string | null>(null);

  // Vista previa de foto (modal, sin salir del catálogo)
  const [previewList, setPreviewList] = useState<any[]>([]);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [previewPhotoSlot, setPreviewPhotoSlot] = useState<1 | 2>(1);
  const previewPhoto = previewIndex !== null ? previewList[previewIndex] : null;

  const openPreview = (photos: any[], photo: any) => {
    const idx = photos.findIndex(p => p.$id === photo.$id);
    setPreviewList(photos);
    setPreviewIndex(idx >= 0 ? idx : 0);
    setPreviewPhotoSlot(1);
  };
  const closePreview = () => {
    setPreviewIndex(null);
    setPreviewPhotoSlot(1);
  };
  const showPrev = () => {
    setPreviewIndex(i => (i === null ? i : (i - 1 + previewList.length) % previewList.length));
    setPreviewPhotoSlot(1);
  };
  const showNext = () => {
    setPreviewIndex(i => (i === null ? i : (i + 1) % previewList.length));
    setPreviewPhotoSlot(1);
  };

  const downloadSinglePhoto = async (photo: any) => {
    try {
      const upcClean = photo.upc || 'foto';

      if (photo.imageUrl2) {
        // Empaquetar ambas fotos en un .zip para que los navegadores móviles y de escritorio descarguen ambas sin bloqueos
        const res1 = await fetch(photo.imageUrl);
        const buf1 = await res1.arrayBuffer();

        const res2 = await fetch(photo.imageUrl2);
        const buf2 = await res2.arrayBuffer();

        const ext1 = (photo.imageUrl || '').toLowerCase().includes('.png') ? 'png' : 'jpg';
        const ext2 = (photo.imageUrl2 || '').toLowerCase().includes('.png') ? 'png' : 'jpg';

        const entries: ZipEntry[] = [
          { name: `${upcClean}_1.${ext1}`, data: new Uint8Array(buf1), date: new Date() },
          { name: `${upcClean}_2.${ext2}`, data: new Uint8Array(buf2), date: new Date() }
        ];

        const zipBlob = createZip(entries);
        const zipUrl = window.URL.createObjectURL(zipBlob);
        const link = document.createElement('a');
        link.href = zipUrl;
        link.download = `${upcClean}_fotos.zip`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => window.URL.revokeObjectURL(zipUrl), 3000);
        return;
      }

      // Descarga directa individual de Foto 1
      const response = await fetch(photo.imageUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${upcClean}_1.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => window.URL.revokeObjectURL(url), 2000);
    } catch (err) {
      console.warn("Error descargando foto individual:", err);
      window.open(photo.imageUrl, '_blank');
    }
  };

  // Teclado: Esc cierra, flechas navegan
  useEffect(() => {
    if (previewIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePreview();
      if (e.key === 'ArrowLeft') showPrev();
      if (e.key === 'ArrowRight') showNext();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [previewIndex, previewList.length]);

  /** Descarga en un solo .zip la lista de fotos junto con la info de UPC, título y descripción. */
  const downloadPhotosAsZip = async (photos: any[], zipLabel: string) => {
    if (photos.length === 0) return;

    setIsAdminActionLoading(true);
    setAdminErrorMsg(null);
    setAdminSuccessMsg(null);

    try {
      const entries: ZipEntry[] = [];
      const used = new Set<string>();
      const failed: string[] = [];
      const downloadedProducts: Array<{
        upc: string;
        title: string;
        description: string;
        fileName: string;
        fileName2?: string;
        userName: string;
        createdAt: string;
      }> = [];

      for (let i = 0; i < photos.length; i++) {
        const photo = photos[i];
        setZipProgress(`Descargando ${i + 1} de ${photos.length}...`);
        try {
          const response = await fetch(photo.imageUrl);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const buffer = await response.arrayBuffer();
          const ext = (photo.imageUrl || '').toLowerCase().includes('.png') ? 'png' : 'jpg';
          const upcClean = photo.upc || 'sin-upc';
          const fileName = uniqueName(`${upcClean}_1.${ext}`, used);
          const photoDate = photo.createdAt ? new Date(photo.createdAt) : new Date();

          // 1. Imagen principal (_1.jpg)
          entries.push({
            name: fileName,
            data: new Uint8Array(buffer),
            date: photoDate,
          });

          // 1b. Imagen secundaria opcional (_2.jpg)
          let fileName2: string | undefined = undefined;
          if (photo.imageUrl2) {
            try {
              const res2 = await fetch(photo.imageUrl2);
              if (res2.ok) {
                const buffer2 = await res2.arrayBuffer();
                const ext2 = (photo.imageUrl2 || '').toLowerCase().includes('.png') ? 'png' : 'jpg';
                fileName2 = uniqueName(`${upcClean}_2.${ext2}`, used);
                entries.push({
                  name: fileName2,
                  data: new Uint8Array(buffer2),
                  date: photoDate,
                });
              }
            } catch (err2) {
              console.warn(`[zip] Error al descargar foto secundaria de ${upcClean}:`, err2);
            }
          }

          // Solo acumulamos los datos para el CSV consolidado de productos
          downloadedProducts.push({
            upc: photo.upc || '',
            title: photo.title || '',
            description: photo.description || '',
            fileName: fileName,
            fileName2: fileName2,
            userName: photo.userName || 'Anónimo',
            createdAt: photo.createdAt ? new Date(photo.createdAt).toLocaleString() : ''
          });
        } catch {
          failed.push(photo.upc || photo.$id);
        }
      }

      if (entries.length === 0) throw new Error("No se pudo descargar ninguna foto.");

      // Único documento complementario: Archivo CSV consolidado (con UTF-8 BOM para apertura perfecta en Excel)
      const escapeCsv = (val: any) => {
        if (val === null || val === undefined) return '""';
        const str = String(val).replace(/"/g, '""');
        return `"${str}"`;
      };

      const csvHeader = '\uFEFF"UPC","Título","Descripción","Archivo Foto 1","Archivo Foto 2","Usuario","Fecha"\r\n';
      const csvRows = downloadedProducts.map(p =>
        [
          escapeCsv(p.upc),
          escapeCsv(p.title),
          escapeCsv(p.description),
          escapeCsv(p.fileName),
          escapeCsv(p.fileName2 || ''),
          escapeCsv(p.userName),
          escapeCsv(p.createdAt)
        ].join(',')
      ).join('\r\n');

      entries.push({
        name: uniqueName('productos.csv', used),
        data: new TextEncoder().encode(csvHeader + csvRows),
        date: new Date(),
      });

      setZipProgress('Comprimiendo ZIP...');
      const blob = createZip(entries);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      const stamp = new Date().toISOString().slice(0, 10);
      link.href = url;
      link.download = `fotos-${zipLabel}-${stamp}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => window.URL.revokeObjectURL(url), 2000);

      setAdminSuccessMsg(
        failed.length === 0
          ? `ZIP generado con ${downloadedProducts.length} fotos e información completa (Excel CSV, TXT y JSON).`
          : `ZIP generado con ${downloadedProducts.length} fotos. No se pudieron descargar ${failed.length}: ${failed.slice(0, 5).join(', ')}${failed.length > 5 ? '...' : ''}`
      );
    } catch (err: any) {
      setAdminErrorMsg("Error al generar el ZIP: " + err.message);
    } finally {
      setZipProgress(null);
      setIsAdminActionLoading(false);
    }
  };

  /** Descarga solo las fotos seleccionadas. */
  const handleMassDownload = async (displayedPhotos: any[]) => {
    const selectedList = displayedPhotos.filter(p => selectedPhotos.has(p.$id));
    if (selectedList.length === 0) return;
    await downloadPhotosAsZip(selectedList, 'seleccion');
  };

  /** Descarga todas las fotos visibles con el filtro actual. */
  const handleDownloadAllZip = async (displayedPhotos: any[]) => {
    if (displayedPhotos.length === 0) return;
    if (displayedPhotos.length > 200 &&
        !confirm(`Vas a descargar ${displayedPhotos.length} fotos en un ZIP. Puede tardar varios minutos. ¿Continuar?`)) return;
    await downloadPhotosAsZip(displayedPhotos, 'todas');
  };

  const handleDeleteProduct = async (docId: string, fileId: string) => {
    if (!confirm("¿Estás seguro de eliminar esta foto?\n\nSe borrará de la base de datos y del almacenamiento, pero el UPC quedará registrado en el inventario para impedir que se vuelva a subir.")) return;

    setIsAdminActionLoading(true);
    setAdminErrorMsg(null);
    setAdminSuccessMsg(null);
    try {
      const res = await fetch('/api/admin/delete-product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docId, fileId })
      }).then(r => r.json());

      if (res.error) throw new Error(res.error);

      setAdminSuccessMsg("Foto eliminada correctamente.");
      loadAdminData();
    } catch (err: any) {
      setAdminErrorMsg(err.message || "Error al eliminar la foto.");
    } finally {
      setIsAdminActionLoading(false);
    }
  };

  const isDashboardRoute = window.location.pathname.includes('dashboard');

  // Derived states and handlers for Mass Actions & Pagination (20 photos per page)
  const displayedPhotos = photosList.filter(p => {
    if (!filterStartDate && !filterEndDate) return true;
    const pDate = new Date(p.createdAt).toISOString().split('T')[0];
    if (filterStartDate && filterEndDate) return pDate >= filterStartDate && pDate <= filterEndDate;
    if (filterStartDate) return pDate >= filterStartDate;
    if (filterEndDate) return pDate <= filterEndDate;
    return true;
  });

  const totalPhotosPages = Math.max(1, Math.ceil(displayedPhotos.length / PHOTOS_PER_PAGE));
  const safePhotosPage = Math.min(Math.max(1, photosCurrentPage), totalPhotosPages);
  const photosStartIndex = (safePhotosPage - 1) * PHOTOS_PER_PAGE;
  const photosEndIndex = Math.min(photosStartIndex + PHOTOS_PER_PAGE, displayedPhotos.length);
  const paginatedPhotos = displayedPhotos.slice(photosStartIndex, photosEndIndex);

  // Selection states (current page vs global persistent selection)
  const selectedOnCurrentPage = paginatedPhotos.filter(p => selectedPhotos.has(p.$id));
  const isCurrentPageFullySelected = paginatedPhotos.length > 0 && selectedOnCurrentPage.length === paginatedPhotos.length;
  const isCurrentPagePartiallySelected = selectedOnCurrentPage.length > 0 && !isCurrentPageFullySelected;
  const areAllDisplayedSelected = displayedPhotos.length > 0 && selectedPhotos.size === displayedPhotos.length;

  const toggleSelection = (id: string) => {
    const next = new Set(selectedPhotos);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedPhotos(next);
  };

  const toggleSelectCurrentPage = () => {
    const next = new Set(selectedPhotos);
    if (isCurrentPageFullySelected) {
      paginatedPhotos.forEach(p => next.delete(p.$id));
    } else {
      paginatedPhotos.forEach(p => next.add(p.$id));
    }
    setSelectedPhotos(next);
  };

  const toggleSelectAllDisplayed = () => {
    if (areAllDisplayedSelected) {
      setSelectedPhotos(new Set());
    } else {
      setSelectedPhotos(new Set(displayedPhotos.map(p => p.$id)));
    }
  };

  const clearSelection = () => {
    setSelectedPhotos(new Set());
  };

  const getPageNumbers = (current: number, total: number) => {
    if (total <= 7) {
      return Array.from({ length: total }, (_, i) => i + 1);
    }
    const pages: (number | string)[] = [];
    if (current <= 4) {
      for (let i = 1; i <= 5; i++) pages.push(i);
      pages.push('...');
      pages.push(total);
    } else if (current >= total - 3) {
      pages.push(1);
      pages.push('...');
      for (let i = total - 4; i <= total; i++) pages.push(i);
    } else {
      pages.push(1);
      pages.push('...');
      pages.push(current - 1);
      pages.push(current);
      pages.push(current + 1);
      pages.push('...');
      pages.push(total);
    }
    return pages;
  };

  // ── RENDER: Admin pantalla completa con sidebar ──────────────────────────
  if (state.user && String(state.user.role).toLowerCase().trim() === 'admin' && isDashboardRoute) {
    const adminNavItems = [
      { key: 'reports', icon: <TrendingUp size={18}/>, label: 'Reportes',        short: 'Reportes' },
      { key: 'users',   icon: <Users size={18}/>,      label: 'Colaboradores',   short: 'Equipo' },
      { key: 'photos',  icon: <FileText size={18}/>,   label: 'Catálogo Fotos',  short: 'Fotos' },
      { key: 'upcs',    icon: <Database size={18}/>,   label: 'Inventario UPCs', short: 'UPCs' },
      { key: 'config',  icon: <UserIcon size={18}/>,   label: 'Configuración',   short: 'Ajustes' },
    ] as { key: typeof adminSection | 'config'; icon: React.ReactNode; label: string; short: string }[];

    const goToScanner = () => {
      window.history.pushState({}, '', '/');
      setState(prev => ({ ...prev, step: AppStep.SCAN_UPC }));
    };

    return (
      <div className="min-h-screen flex font-sans glass-panel">
        {/* ── Sidebar (solo escritorio) ─────────────────────────────────────── */}
        <aside className="hidden md:flex w-64 min-h-screen glass-card border-r border-white/60 flex-col shadow-xl shadow-black/30 shrink-0">
          {/* Logo Stevens */}
          <div className="p-6 border-b border-white/60">
            <div className="flex items-center gap-3">
              <div className="bg-slate-900 px-3 py-2 rounded-2xl shadow-md border border-slate-800 flex items-center justify-center">
                <img src="/stevens-logo-white.png" alt="Stevens" className="h-6 w-auto object-contain" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-black text-slate-900 leading-tight uppercase tracking-tight font-display">Studio AI</p>
                <p className="text-[9px] text-[#06BAB8] font-black uppercase tracking-widest mt-0.5">Admin Panel</p>
              </div>
            </div>
            <div className="stevens-brand-stripe rounded-full mt-4 h-1"></div>
          </div>

          {/* Nav items */}
          <nav className="flex-1 p-4 space-y-1">
            {adminNavItems.map(item => (
              <button
                key={item.key}
                onClick={() => setAdminSection(item.key as typeof adminSection)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-[20px] text-sm font-bold transition-all ${
                  adminSection === item.key
                    ? 'bg-slate-900 text-brand-navy shadow-lg shadow-slate-900/10'
                    : 'text-slate-500 hover:text-slate-800 hover:bg-white/50'
                }`}
              >
                {item.icon}
                {item.label}
              </button>
            ))}

            {/* Botón Modo Escáner */}
            <div className="pt-4 border-t border-white/60 mt-4">
              <button
                onClick={goToScanner}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-[20px] text-sm font-bold text-slate-500 hover:text-slate-900 hover:bg-white/50 transition-all"
              >
                <Barcode size={18} />
                Modo Escáner
              </button>
            </div>
          </nav>

          {/* Usuario + Logout */}
          <div className="p-4 border-t border-white/60">
            <div className="flex items-center gap-3 mb-3 glass-panel rounded-full p-3">
              <div className="w-8 h-8 bg-slate-900/10 border border-brand-gold/30 rounded-full flex items-center justify-center text-slate-900">
                <UserIcon size={15} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-black text-slate-800 truncate">{state.user.name}</p>
                <p className="text-[9px] text-slate-500 uppercase font-bold tracking-wide">Administrador</p>
              </div>
            </div>
            <button
              onClick={logout}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-rose-50 border border-rose-200 text-rose-600 hover:bg-rose-900/25 rounded-full text-xs font-bold uppercase tracking-wider transition-all"
            >
              <LogOut size={14} /> Cerrar Sesión
            </button>
          </div>
        </aside>

        <div className="flex-1 flex flex-col min-h-screen overflow-y-auto pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0">
          {/* Topbar */}
          <header className="flex items-center justify-between px-4 md:px-8 py-4 md:py-5 border-b border-white/60 glass-panel sticky top-0 z-10">
            <div className="min-w-0">
              <h2 className="text-base md:text-xl font-black text-slate-900 uppercase tracking-tight truncate">
                {adminSection === 'reports'  && 'Reportes de Actividad'}
                {adminSection === 'users'    && 'Colaboradores'}
                {adminSection === 'photos'   && 'Catálogo de Fotos'}
                {adminSection === 'upcs'     && 'Inventario de UPCs'}
                {adminSection === 'config'   && 'Configuración del Sistema'}
              </h2>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-0.5 truncate">
                {adminSection === 'upcs'
                  ? (upcsCount === null
                      ? 'Total de productos publicados no disponible'
                      : `${upcsCount.toLocaleString('es-PA')} productos publicados`)
                  : 'Stevens Studio AI • Panel de Administrador'}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={goToScanner}
                className="md:hidden p-2.5 glass-panel border border-white/60 text-slate-500 hover:text-slate-900 rounded-full transition-all"
                title="Modo Escáner"
              >
                <Barcode size={16} />
              </button>
              <button
                onClick={loadAdminData}
                disabled={isAdminActionLoading}
                className="p-2.5 glass-panel border border-white/60 text-slate-500 hover:text-slate-900 rounded-full transition-all"
                title="Actualizar datos"
              >
                <RefreshCw size={16} className={isAdminActionLoading ? 'animate-spin text-slate-900' : ''} />
              </button>
              <button
                onClick={logout}
                className="md:hidden p-2.5 bg-rose-50 border border-rose-200 text-rose-600 rounded-full transition-all"
                title="Cerrar sesión"
              >
                <LogOut size={16} />
              </button>
            </div>
          </header>

          {/* Notificaciones */}
          <div className="px-4 md:px-8 pt-4">
            {adminSuccessMsg && (
              <div className="mb-4 p-4 bg-emerald-50 border border-emerald-200 rounded-[20px] text-emerald-700 text-xs font-bold flex justify-between items-center animate-in zoom-in">
                <span className="flex items-center gap-2"><CheckCircle size={16} /> {adminSuccessMsg}</span>
                <button onClick={() => setAdminSuccessMsg(null)}><X size={16} /></button>
              </div>
            )}
            {adminErrorMsg && (
              <div className="mb-4 p-4 bg-rose-50 border border-rose-200 rounded-[20px] text-rose-700 text-xs font-bold flex justify-between items-center animate-in zoom-in">
                <span className="flex items-center gap-2"><AlertCircle size={16} /> {adminErrorMsg}</span>
                <button onClick={() => setAdminErrorMsg(null)}><X size={16} /></button>
              </div>
            )}
          </div>

          {adminSection === 'reports' && (
            <div className="p-4 md:p-8">
              <div className="glass-card border border-white/60 rounded-[32px] overflow-hidden mb-6">
                <div className="p-6 border-b border-white/60 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <h3 className="text-xs font-black text-slate-900 uppercase tracking-wider">Fotos tomadas por colaborador</h3>
                  
                  {/* Date range filter */}
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input 
                        type="date" 
                        value={dateRange.start}
                        onChange={(e) => {
                          setDateRange(prev => ({ ...prev, start: e.target.value }));
                          setTimeout(loadAdminData, 50);
                        }}
                        className="glass-input pl-9 pr-3 py-2 rounded-full text-xs font-bold text-slate-700 outline-none w-32 cursor-pointer"
                        title="Fecha Inicio"
                        onClick={(e) => (e.target).showPicker()}
                      />
                    </div>
                    <span className="text-slate-400 font-bold">-</span>
                    <div className="relative">
                      <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input 
                        type="date" 
                        value={dateRange.end}
                        onChange={(e) => {
                          setDateRange(prev => ({ ...prev, end: e.target.value }));
                          setTimeout(loadAdminData, 50);
                        }}
                        className="glass-input pl-9 pr-3 py-2 rounded-full text-xs font-bold text-slate-700 outline-none w-32 cursor-pointer"
                        title="Fecha Fin"
                        onClick={(e) => (e.target).showPicker()}
                      />
                    </div>
                    {(dateRange.start || dateRange.end) && (
                      <button 
                        onClick={() => { setDateRange({start: '', end: ''}); setTimeout(loadAdminData, 50); }}
                        className="p-2 glass-panel rounded-full text-slate-500 hover:text-rose-500 ml-1"
                        title="Limpiar fechas"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </div>
                
                <div className="p-6">
                  {isAdminActionLoading ? (
                    <div className="flex justify-center p-12"><Loader2 className="animate-spin text-slate-900" size={28} /></div>
                  ) : reportData.length === 0 ? (
                    <p className="text-slate-500 text-sm text-center py-8 font-bold">Sin registros aún en este rango de fechas.</p>
                  ) : (
                    <div className="w-full h-80 mt-4">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={reportData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                          <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                          <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                          <Tooltip 
                            cursor={{ fill: 'rgba(241, 245, 249, 0.5)' }} 
                            contentStyle={{ borderRadius: '16px', border: '1px solid rgba(255,255,255,0.6)', background: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(10px)', boxShadow: '0 10px 25px rgba(0,0,0,0.05)', fontWeight: 'bold' }}
                          />
                          <Bar dataKey="count" fill="#0f172a" radius={[6, 6, 0, 0]} name="Fotos" barSize={40} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {adminSection === 'users' && (
            <div className="p-8 space-y-8">
              {/* Formulario crear usuario */}
              <div className="glass-card border border-white/60 rounded-[32px] p-6">
                <h3 className="text-xs font-black text-slate-900 uppercase tracking-wider mb-5 flex items-center gap-2">
                  <Plus size={15} /> Agregar Nuevo Colaborador
                </h3>
                <form onSubmit={handleCreateUser} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-[9px] font-black text-slate-500 uppercase mb-2 block tracking-widest">Nombre completo</label>
                      <input type="text" value={newUserName} onChange={e => setNewUserName(e.target.value)}
                        placeholder="Juan Pérez" required
                        className="w-full px-4 py-3 glass-panel border border-slate-200 rounded-full text-sm focus:border-brand-gold outline-none text-slate-700" />
                    </div>
                    <div>
                      <label className="text-[9px] font-black text-slate-500 uppercase mb-2 block tracking-widest">Correo electrónico</label>
                      <input type="email" value={newUserEmail} onChange={e => setNewUserEmail(e.target.value)}
                        placeholder="jperez@stevens.com.pa" required
                        className="w-full px-4 py-3 glass-panel border border-slate-200 rounded-full text-sm focus:border-brand-gold outline-none text-slate-700" />
                    </div>
                    <div>
                      <label className="text-[9px] font-black text-slate-500 uppercase mb-2 block tracking-widest">Contraseña</label>
                      <input type="password" value={newUserPassword} onChange={e => setNewUserPassword(e.target.value)}
                        placeholder="Mínimo 8 caracteres" required minLength={8}
                        className="w-full px-4 py-3 glass-panel border border-slate-200 rounded-full text-sm focus:border-brand-gold outline-none text-slate-700" />
                    </div>
                    <div>
                      <label className="text-[9px] font-black text-slate-500 uppercase mb-2 block tracking-widest">Rol</label>
                      <select value={newUserRole} onChange={e => setNewUserRole(e.target.value as 'admin' | 'user')}
                        className="w-full px-4 py-3 glass-panel border border-slate-200 rounded-full text-sm focus:border-brand-gold outline-none text-slate-700">
                        <option value="user">Operador (toma fotos)</option>
                        <option value="admin">Administrador</option>
                      </select>
                    </div>
                  </div>
                  <button type="submit" disabled={isAdminActionLoading}
                    className="px-8 py-3 bg-slate-900 text-brand-navy font-black text-xs uppercase tracking-widest rounded-full hover:bg-slate-900-light transition-all disabled:opacity-50">
                    {isAdminActionLoading ? 'Registrando...' : 'Registrar Colaborador'}
                  </button>
                </form>
              </div>

              {/* Lista usuarios */}
              <div className="glass-card border border-white/60 rounded-[32px] overflow-hidden">
                <div className="p-6 border-b border-white/60">
                  <h3 className="text-xs font-black text-slate-600 uppercase tracking-wider">Lista de Colaboradores</h3>
                </div>
                <div className="p-6">
                  {isAdminActionLoading && usersList.length === 0 ? (
                    <div className="flex justify-center p-12"><Loader2 className="animate-spin text-slate-900" size={28} /></div>
                  ) : usersList.length === 0 ? (
                    <p className="text-slate-500 text-sm text-center py-8 font-bold">Sin registros aún.</p>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {usersList.map((usr: any) => (
                        <div key={usr.$id} className="py-4 flex justify-between items-center first:pt-0 last:pb-0">
                          <div>
                            <p className="text-sm font-black text-slate-800">
                              {usr.name}
                              <span className={`ml-2 text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${usr.role === 'admin' ? 'bg-amber-100 border border-amber-300 text-amber-900 font-bold' : 'bg-slate-100 border border-slate-200 text-slate-600'}`}>{usr.role === 'admin' ? 'Administrador' : 'Operador'}</span>
                            </p>
                            <p className="text-[10px] font-bold text-slate-500 font-mono mt-0.5">{usr.email}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => openEditUser(usr)}
                              className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-full transition-all border border-slate-200"
                              title="Editar Perfil del Colaborador"
                            >
                              <Pencil size={14} />
                            </button>
                            <button onClick={() => handleDeleteUser(usr.userId, usr.$id)}
                              disabled={usr.userId === state.user?.id}
                              className="p-2.5 bg-rose-50 border border-rose-200 text-rose-600 hover:bg-rose-100 rounded-full transition-all disabled:opacity-30 disabled:pointer-events-none"
                              title="Eliminar">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Modal para Editar Perfil del Colaborador */}
              {editingUser && (
                <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setEditingUser(null)}>
                  <div className="glass-card border border-white/60 rounded-[28px] overflow-hidden w-full max-w-lg bg-white shadow-2xl p-6" onClick={e => e.stopPropagation()}>
                    <div className="flex justify-between items-center mb-5 border-b border-slate-100 pb-3">
                      <div>
                        <h3 className="text-base font-black text-slate-900 uppercase tracking-tight">Editar Colaborador</h3>
                        <p className="text-xs text-slate-500 font-medium">Actualiza el nombre, correo o rol del usuario</p>
                      </div>
                      <button
                        onClick={() => setEditingUser(null)}
                        className="p-2 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"
                      >
                        <X size={18} />
                      </button>
                    </div>

                    <form onSubmit={handleUpdateUser} className="space-y-4">
                      <div>
                        <label className="text-[10px] font-black text-slate-500 uppercase mb-1.5 block tracking-wider">Nombre Completo</label>
                        <input
                          type="text"
                          value={editUserName}
                          onChange={e => setEditUserName(e.target.value)}
                          required
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:border-brand-gold outline-none text-slate-800"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-black text-slate-500 uppercase mb-1.5 block tracking-wider">Correo Electrónico</label>
                        <input
                          type="email"
                          value={editUserEmail}
                          onChange={e => setEditUserEmail(e.target.value)}
                          required
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:border-brand-gold outline-none text-slate-800"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-black text-slate-500 uppercase mb-1.5 block tracking-wider">Rol de Acceso</label>
                        <select
                          value={editUserRole}
                          onChange={e => setEditUserRole(e.target.value as 'admin' | 'user')}
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:border-brand-gold outline-none text-slate-800"
                        >
                          <option value="user">Operador (Toma fotos y cataloga)</option>
                          <option value="admin">Administrador (Acceso completo a métricas y catálogo)</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-[10px] font-black text-slate-500 uppercase mb-1.5 block tracking-wider">
                          Nueva Contraseña <span className="text-slate-400 font-normal lowercase">(opcional, deja en blanco para no cambiarla)</span>
                        </label>
                        <input
                          type="password"
                          value={editUserPassword}
                          onChange={e => setEditUserPassword(e.target.value)}
                          placeholder="Mínimo 8 caracteres"
                          minLength={8}
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:border-brand-gold outline-none text-slate-800"
                        />
                      </div>

                      <div className="flex gap-3 pt-4 border-t border-slate-100">
                        <button
                          type="button"
                          onClick={() => setEditingUser(null)}
                          className="flex-1 py-3 border border-slate-200 text-slate-600 rounded-xl text-xs font-bold hover:bg-slate-50 transition-colors uppercase tracking-wider"
                        >
                          Cancelar
                        </button>
                        <button
                          type="submit"
                          disabled={isAdminActionLoading}
                          className="flex-1 py-3 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-800 transition-colors uppercase tracking-wider disabled:opacity-50"
                        >
                          {isAdminActionLoading ? 'Guardando...' : 'Guardar Cambios'}
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Sección: Catálogo Fotos ───────────────────────────── */}
          {adminSection === 'photos' && (
            <div className="p-4 md:p-8">
              <div className="glass-card border border-white/60 rounded-[32px] overflow-hidden">
                <div className="p-6 border-b border-white/60 flex flex-col gap-4 md:flex-row md:items-center justify-between">
                  <div className="flex flex-wrap items-center gap-3">
                    <h3 className="text-xs font-black text-slate-700 uppercase tracking-wider">
                      Fotos publicadas ({displayedPhotos.length})
                    </h3>
                    {totalPhotosPages > 1 && (
                      <span className="text-[11px] font-bold text-slate-600 bg-white/70 px-2.5 py-0.5 rounded-full border border-slate-200 shadow-xs">
                        Página {safePhotosPage} de {totalPhotosPages} · 20 por página
                      </span>
                    )}
                  </div>
                  
                  <div className="flex flex-wrap items-center gap-3">
                    {/* Size controls */}
                    <div className="flex glass-panel border border-white/60 rounded-full p-1">
                      <button onClick={() => setGridSize('small')} className={`p-1.5 rounded-full ${gridSize === 'small' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-600'}`} title="Chico">S</button>
                      <button onClick={() => setGridSize('medium')} className={`p-1.5 rounded-full ${gridSize === 'medium' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-600'}`} title="Mediano">M</button>
                      <button onClick={() => setGridSize('large')} className={`p-1.5 rounded-full ${gridSize === 'large' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-600'}`} title="Grande">L</button>
                    </div>

                    <div className="h-6 w-px bg-slate-800/20 hidden md:block"></div>

                    {/* Date range filter */}
                    <div className="flex items-center gap-2 glass-panel border border-white/60 rounded-full px-2">
                      <input
                        type="date"
                        value={filterStartDate}
                        onChange={(e) => {
                          setFilterStartDate(e.target.value);
                          setPhotosCurrentPage(1);
                        }}
                        className="px-2 py-2 bg-transparent text-[10px] sm:text-xs text-slate-600 font-mono outline-none"
                        title="Fecha Inicio"
                      />
                      <span className="text-slate-500 font-bold">-</span>
                      <input
                        type="date"
                        value={filterEndDate}
                        onChange={(e) => {
                          setFilterEndDate(e.target.value);
                          setPhotosCurrentPage(1);
                        }}
                        className="px-2 py-2 bg-transparent text-[10px] sm:text-xs text-slate-600 font-mono outline-none"
                        title="Fecha Fin"
                      />
                    </div>
                    
                    {(filterStartDate || filterEndDate) && (
                      <button onClick={() => { setFilterStartDate(''); setFilterEndDate(''); setPhotosCurrentPage(1); }} className="text-xs text-slate-500 hover:text-slate-700 font-bold underline">
                        Quitar Filtro
                      </button>
                    )}
                  </div>
                </div>

                {/* Mass Actions Bar */}
                {displayedPhotos.length > 0 && (
                  <div className="px-4 md:px-6 py-3 bg-white/60 backdrop-blur-md border-b border-white/60 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2.5">
                      {/* Checkbox para la página actual */}
                      <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-700 hover:text-slate-900 select-none bg-white/80 border border-slate-200 px-3 py-1.5 rounded-full shadow-xs">
                        <input 
                          type="checkbox" 
                          checked={isCurrentPageFullySelected} 
                          ref={el => {
                            if (el) el.indeterminate = isCurrentPagePartiallySelected;
                          }}
                          onChange={toggleSelectCurrentPage}
                          className="w-4 h-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900 cursor-pointer"
                        />
                        <span>Página actual ({selectedOnCurrentPage.length}/{paginatedPhotos.length})</span>
                      </label>

                      {/* Botón para seleccionar todo el catálogo */}
                      <button
                        type="button"
                        onClick={toggleSelectAllDisplayed}
                        className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all border shadow-xs ${
                          areAllDisplayedSelected
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-white/80 hover:bg-white text-slate-700 border-slate-200'
                        }`}
                      >
                        {areAllDisplayedSelected ? 'Deseleccionar todo' : `Seleccionar catálogo completo (${displayedPhotos.length})`}
                      </button>

                      {/* Badge de selección total persistente */}
                      {selectedPhotos.size > 0 && (
                        <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 text-amber-900 px-3 py-1 rounded-full text-xs font-bold">
                          <span>{selectedPhotos.size} seleccionada{selectedPhotos.size > 1 ? 's' : ''} en total</span>
                          <button 
                            type="button" 
                            onClick={clearSelection} 
                            className="text-amber-700 hover:text-rose-600 ml-1 underline text-[11px]"
                            title="Limpiar selección"
                          >
                            Limpiar
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2 items-center">
                      {zipProgress && (
                        <span className="text-[10px] font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1 bg-white/80 border border-slate-200 px-2.5 py-1 rounded-full">
                          <Loader2 className="animate-spin text-slate-700" size={12} /> {zipProgress}
                        </span>
                      )}
                      <button 
                        onClick={() => handleDownloadAllZip(displayedPhotos)}
                        disabled={displayedPhotos.length === 0 || isAdminActionLoading}
                        className="px-3.5 py-1.5 bg-slate-900 border border-slate-900 text-white hover:bg-slate-800 rounded-full text-[10px] font-bold uppercase tracking-wider disabled:opacity-50 transition-all flex items-center gap-1 shadow-sm cursor-pointer"
                        title="Descargar todas las fotos del catálogo en un ZIP con fotos (_1 y _2) y el archivo productos.csv"
                      >
                        <Download size={12} /> ZIP Todo ({displayedPhotos.length})
                      </button>
                      <button 
                        onClick={() => handleMassDownload(displayedPhotos)}
                        disabled={selectedPhotos.size === 0 || isAdminActionLoading}
                        className="px-3.5 py-1.5 bg-emerald-600 border border-emerald-600 text-white hover:bg-emerald-700 rounded-full text-[10px] font-bold uppercase tracking-wider disabled:opacity-50 transition-all flex items-center gap-1 shadow-sm cursor-pointer"
                        title="Descargar las fotos seleccionadas en un ZIP con fotos (_1 y _2) y el archivo productos.csv"
                      >
                        <Download size={12} /> ZIP Selección ({selectedPhotos.size})
                      </button>
                      <button 
                        onClick={() => handleMassDelete(displayedPhotos)}
                        disabled={selectedPhotos.size === 0 || isAdminActionLoading}
                        className="px-3 py-1.5 bg-rose-50 border border-rose-200 text-rose-600 hover:bg-rose-100 rounded-full text-[10px] font-bold uppercase tracking-wider disabled:opacity-50 transition-all flex items-center gap-1"
                        title="Eliminar las fotos seleccionadas"
                      >
                        <Trash2 size={12} /> Eliminar ({selectedPhotos.size})
                      </button>
                    </div>
                  </div>
                )}

                {/* Paginación Superior */}
                {totalPhotosPages > 1 && (
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-6 py-2.5 bg-white/40 backdrop-blur-sm border-b border-white/60">
                    <div className="text-xs text-slate-500 font-medium">
                      Mostrando <span className="font-bold text-slate-800">{displayedPhotos.length > 0 ? photosStartIndex + 1 : 0}–{photosEndIndex}</span> de <span className="font-bold text-slate-800">{displayedPhotos.length}</span> fotos
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setPhotosCurrentPage(1)}
                        disabled={safePhotosPage === 1}
                        className="p-1.5 rounded-lg border border-slate-200 bg-white/80 text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                        title="Primera página"
                      >
                        <ChevronsLeft size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setPhotosCurrentPage(p => Math.max(1, p - 1))}
                        disabled={safePhotosPage === 1}
                        className="p-1.5 rounded-lg border border-slate-200 bg-white/80 text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                        title="Página anterior"
                      >
                        <ChevronLeft size={16} />
                      </button>

                      <div className="flex items-center gap-1 mx-1">
                        {getPageNumbers(safePhotosPage, totalPhotosPages).map((num, i) =>
                          num === '...' ? (
                            <span key={`top-dots-${i}`} className="px-1.5 text-xs font-bold text-slate-400 select-none">…</span>
                          ) : (
                            <button
                              key={`top-page-${num}`}
                              type="button"
                              onClick={() => setPhotosCurrentPage(Number(num))}
                              className={`min-w-[32px] h-8 px-2 rounded-lg text-xs font-bold transition-all ${
                                safePhotosPage === num
                                  ? 'bg-slate-900 text-white shadow-sm'
                                  : 'border border-slate-200 bg-white/80 text-slate-700 hover:bg-slate-100'
                              }`}
                            >
                              {num}
                            </button>
                          )
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => setPhotosCurrentPage(p => Math.min(totalPhotosPages, p + 1))}
                        disabled={safePhotosPage === totalPhotosPages}
                        className="p-1.5 rounded-lg border border-slate-200 bg-white/80 text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                        title="Página siguiente"
                      >
                        <ChevronRight size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setPhotosCurrentPage(totalPhotosPages)}
                        disabled={safePhotosPage === totalPhotosPages}
                        className="p-1.5 rounded-lg border border-slate-200 bg-white/80 text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                        title="Última página"
                      >
                        <ChevronsRight size={16} />
                      </button>
                    </div>
                  </div>
                )}

                <div className="p-6">
                  {isAdminActionLoading && photosList.length === 0 ? (
                    <div className="flex justify-center p-12"><Loader2 className="animate-spin text-slate-900" size={28} /></div>
                  ) : displayedPhotos.length === 0 ? (
                    <p className="text-slate-500 text-sm text-center py-8 font-bold">Sin registros aún.</p>
                  ) : (
                    <>
                      <div className={`grid gap-4 ${
                        gridSize === 'small' ? 'grid-cols-3 sm:grid-cols-6 lg:grid-cols-8' : 
                        gridSize === 'medium' ? 'grid-cols-2 sm:grid-cols-4 lg:grid-cols-6' : 
                        'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
                      }`}>
                        {paginatedPhotos.map((photo: any) => {
                          const isSelected = selectedPhotos.has(photo.$id);
                          return (
                            <div 
                              key={photo.$id} 
                              className={`glass-panel border rounded-[20px] overflow-hidden relative cursor-pointer transition-all ${
                                isSelected ? 'border-brand-gold ring-2 ring-slate-900 bg-white/95 shadow-md' : 'border-white/60 bg-white/70 hover:bg-white/90'
                              }`}
                              onClick={() => toggleSelection(photo.$id)}
                            >
                              <div className="absolute top-2 left-2 z-10 glass-card/90 p-1 rounded-full backdrop-blur-sm shadow-xs">
                                <input 
                                  type="checkbox" 
                                  checked={isSelected} 
                                  onChange={() => toggleSelection(photo.$id)} 
                                  onClick={e => e.stopPropagation()} 
                                  className="w-4 h-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900 cursor-pointer"
                                />
                              </div>
                              
                              <div 
                                className="bg-white aspect-square flex items-center justify-center p-2 relative group"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openPreview(displayedPhotos, photo);
                                }}
                              >
                                <img src={photo.imageUrl} alt={photo.upc} className="w-full h-full object-contain" />
                                {photo.imageUrl2 && (
                                  <div className="absolute bottom-2 right-2 z-10 bg-slate-900/90 text-amber-400 border border-amber-400/30 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider flex items-center gap-1 shadow-md">
                                    <span>2 fotos</span>
                                  </div>
                                )}
                                <div className="absolute inset-0 bg-slate-950/25 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                  <span className="p-1.5 bg-slate-900/90 text-white rounded-lg shadow-md flex items-center gap-1 text-[10px] font-bold">
                                    <Maximize2 size={12} /> {photo.imageUrl2 ? 'Ver 2 fotos' : 'Ampliar'}
                                  </span>
                                </div>
                              </div>
                              <div className="p-4">
                                <div className="flex items-center justify-between gap-1">
                                  <p className="text-sm font-mono font-black text-slate-800">{photo.upc}</p>
                                  {photo.imageUrl2 && (
                                    <span className="text-[8px] font-mono font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">_1 y _2</span>
                                  )}
                                </div>
                                {photo.title && (
                                  <p className="text-xs font-semibold text-slate-700 truncate mt-1" title={photo.title}>
                                    {photo.title}
                                  </p>
                                )}
                                {photo.description && (
                                  <p className="text-[10px] text-slate-500 line-clamp-2 mt-0.5" title={photo.description}>
                                    {photo.description}
                                  </p>
                                )}
                                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-tight mt-1.5">
                                  {photo.userName || 'Anónimo'} · {new Date(photo.createdAt || '').toLocaleDateString()}
                                </p>
                                <div className="flex gap-2 mt-3">
                                  <button type="button"
                                    onClick={e => { e.stopPropagation(); openPreview(displayedPhotos, photo); }}
                                    className="flex-1 flex items-center justify-center gap-1 py-1.5 glass-card border border-slate-200 text-slate-700 hover:text-slate-950 hover:bg-slate-100 rounded-full text-[10px] font-bold transition-all">
                                    <ExternalLink size={12} /> {photo.imageUrl2 ? 'Ver Fotos (2)' : 'Ver Foto'}
                                  </button>
                                  <button type="button"
                                    onClick={e => { e.stopPropagation(); downloadSinglePhoto(photo); }}
                                    className="p-1.5 glass-card border border-slate-200 text-slate-600 hover:text-slate-950 hover:bg-slate-100 rounded-full text-[10px] font-bold transition-all"
                                    title={photo.imageUrl2 ? "Descargar ambas fotos (_1.jpg y _2.jpg)" : "Descargar foto (_1.jpg)"}>
                                    <Download size={13} />
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Paginación Inferior */}
                      {totalPhotosPages > 1 && (
                        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-6 mt-6 border-t border-slate-200/60">
                          <div className="text-xs text-slate-500 font-medium">
                            Página <span className="font-bold text-slate-800">{safePhotosPage}</span> de <span className="font-bold text-slate-800">{totalPhotosPages}</span> · Mostrando {photosStartIndex + 1}–{photosEndIndex} de {displayedPhotos.length} fotos
                          </div>

                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                setPhotosCurrentPage(1);
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                              }}
                              disabled={safePhotosPage === 1}
                              className="p-1.5 rounded-lg border border-slate-200 bg-white/80 text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                              title="Primera página"
                            >
                              <ChevronsLeft size={16} />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setPhotosCurrentPage(p => Math.max(1, p - 1));
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                              }}
                              disabled={safePhotosPage === 1}
                              className="p-1.5 rounded-lg border border-slate-200 bg-white/80 text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                              title="Página anterior"
                            >
                              <ChevronLeft size={16} />
                            </button>

                            <div className="flex items-center gap-1 mx-1">
                              {getPageNumbers(safePhotosPage, totalPhotosPages).map((num, i) =>
                                num === '...' ? (
                                  <span key={`bot-dots-${i}`} className="px-1.5 text-xs font-bold text-slate-400 select-none">…</span>
                                ) : (
                                  <button
                                    key={`bot-page-${num}`}
                                    type="button"
                                    onClick={() => {
                                      setPhotosCurrentPage(Number(num));
                                      window.scrollTo({ top: 0, behavior: 'smooth' });
                                    }}
                                    className={`min-w-[32px] h-8 px-2 rounded-lg text-xs font-bold transition-all ${
                                      safePhotosPage === num
                                        ? 'bg-slate-900 text-white shadow-sm'
                                        : 'border border-slate-200 bg-white/80 text-slate-700 hover:bg-slate-100'
                                    }`}
                                  >
                                    {num}
                                  </button>
                                )
                              )}
                            </div>

                            <button
                              type="button"
                              onClick={() => {
                                setPhotosCurrentPage(p => Math.min(totalPhotosPages, p + 1));
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                              }}
                              disabled={safePhotosPage === totalPhotosPages}
                              className="p-1.5 rounded-lg border border-slate-200 bg-white/80 text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                              title="Página siguiente"
                            >
                              <ChevronRight size={16} />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setPhotosCurrentPage(totalPhotosPages);
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                              }}
                              disabled={safePhotosPage === totalPhotosPages}
                              className="p-1.5 rounded-lg border border-slate-200 bg-white/80 text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                              title="Última página"
                            >
                              <ChevronsRight size={16} />
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

                    {/* ── Sección: Configuración ───────────────────────────── */}
                    {/* Seccion: Inventario UPCs */}
          {adminSection === 'upcs' && (
            <div className="p-4 md:p-8">
              <div className="glass-card border border-white/60 rounded-[32px] overflow-hidden">
                
                {/* Header */}
                <div className="p-4 md:p-6 bg-slate-100/50 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                  <div className="min-w-0">
                    <h3 className="text-slate-800 font-bold text-base md:text-lg">Inventario de Productos (UPC)</h3>
                    <p className="text-xs text-slate-500 mt-1">Sube los UPCs que ya están publicados en el sitio web para evitar que los operadores los vuelvan a fotografiar.</p>
                  </div>

                  {/* Total de productos publicados — siempre visible */}
                  <div className="w-full md:w-auto glass-card border border-white/60 rounded-[20px] px-5 py-3 flex items-center gap-3 shrink-0">
                    <div className="p-2.5 bg-slate-900 text-white rounded-full shrink-0">
                      <Database size={18} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest leading-none">
                        Productos publicados
                      </p>
                      <p className={`text-2xl md:text-3xl font-black leading-tight tabular-nums ${
                        upcsCountError ? 'text-rose-500' : 'text-slate-900'
                      }`}>
                        {isUpcsCountLoading && upcsCount === null
                          ? '…'
                          : upcsCount === null
                            ? '—'
                            : upcsCount.toLocaleString('es-PA')}
                      </p>
                      {upcsCountError ? (
                        <p className="text-[9px] font-bold text-rose-500 leading-tight mt-0.5 max-w-[220px]">
                          {upcsCountError}
                        </p>
                      ) : upcsBreakdown && (
                        <p className="text-[9px] font-bold text-slate-400 leading-tight mt-0.5 uppercase tracking-tight">
                          {upcsBreakdown.inventory.toLocaleString('es-PA')} inventario
                          {' + '}
                          {upcsBreakdown.photosOnly.toLocaleString('es-PA')} fotos nuevas
                        </p>
                      )}
                    </div>
                    <button
                      onClick={loadUpcsCount}
                      disabled={isUpcsCountLoading}
                      title="Actualizar total"
                      className="ml-auto md:ml-2 p-2 glass-panel border border-white/60 text-slate-500 hover:text-slate-900 rounded-full transition-all shrink-0"
                    >
                      <RefreshCw size={13} className={isUpcsCountLoading ? 'animate-spin text-slate-900' : ''} />
                    </button>
                  </div>
                </div>

                <div className="p-4 md:p-6 space-y-6">
                  <div className="space-y-4">
                    <label className="text-[10px] font-black text-slate-500 uppercase block tracking-widest">Carga de Códigos</label>
                    
                    {/* Tarjeta de Selección de Archivo */}
                    <div className="glass-card p-4 rounded-[20px] border border-white/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="p-3 bg-emerald-100 text-emerald-700 rounded-full shrink-0">
                          <FileText size={20} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-800">Subir archivo CSV, TXT o Excel exportado</p>
                          <p className="text-[10px] text-slate-500">Recomendado para 35,000+ o cientos de miles de códigos</p>
                          {upcFileSummary && (
                            <div className="mt-1.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-bold">
                              <CheckCircle2 size={13} className="text-emerald-600" />
                              <span>{upcFileSummary.fileName}: <strong>{upcFileSummary.count.toLocaleString('es-PA')}</strong> códigos listos</span>
                            </div>
                          )}
                        </div>
                      </div>
                      <input 
                        type="file" 
                        id="upcMassFile" 
                        accept=".txt,.csv" 
                        disabled={upcProgress?.isActive}
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) {
                            setUpcFileSummary(null);
                            return;
                          }
                          try {
                            const text = await file.text();
                            const extracted = extractUpcsFromRawText(text);
                            const unique = Array.from(new Set(extracted));
                            setUpcFileSummary({
                              fileName: file.name,
                              count: unique.length,
                            });
                          } catch {
                            setUpcFileSummary(null);
                          }
                        }}
                        className="text-xs max-w-full file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-bold file:bg-slate-900 file:text-white hover:file:bg-slate-800 cursor-pointer disabled:opacity-50"
                      />
                    </div>

                    <div className="text-center text-xs text-slate-400 font-bold uppercase tracking-widest">O pega manualmente los datos:</div>

                    <div className="space-y-1.5">
                      <textarea 
                        id="upcMassInput"
                        disabled={upcProgress?.isActive}
                        placeholder="Pega aquí los UPCs o las columnas copiadas de Excel / Supabase (se limpian fechas y encabezados automáticamente)..."
                        className="w-full h-32 glass-input px-4 py-3 rounded-[20px] text-xs text-slate-700 font-mono focus:border-slate-900 outline-none resize-none disabled:opacity-50"
                      ></textarea>
                      <p className="text-[10px] text-slate-400 font-medium px-2">
                        Tip: Si copiaste columnas con fecha como en Supabase Studio, el sistema detecta y extrae únicamente los números de código.
                      </p>
                    </div>
                  </div>

                  {/* Barra de progreso en vivo */}
                  {upcProgress && (
                    <div className="glass-card border border-white/60 p-5 rounded-[24px] space-y-3 bg-white/80 shadow-md transition-all">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          {upcProgress.isComplete ? (
                            <div className="p-2 bg-emerald-100 text-emerald-700 rounded-full">
                              <CheckCircle2 size={20} />
                            </div>
                          ) : upcProgress.error ? (
                            <div className="p-2 bg-rose-100 text-rose-700 rounded-full">
                              <AlertCircle size={20} />
                            </div>
                          ) : (
                            <div className="p-2 bg-slate-900 text-white rounded-full">
                              <Loader2 size={20} className="animate-spin text-white" />
                            </div>
                          )}
                          <div>
                            <p className="text-sm font-black text-slate-800">
                              {upcProgress.isComplete
                                ? '¡Carga de inventario completada!'
                                : upcProgress.error
                                ? 'Carga interrumpida'
                                : 'Procesando e ingresando códigos al inventario...'}
                            </p>
                            <p className="text-xs text-slate-500 font-medium mt-0.5">
                              {upcProgress.statusText}
                            </p>
                          </div>
                        </div>
                        
                        <div className="text-right">
                          <span className="text-xl font-black text-slate-900 font-mono">
                            {upcProgress.percentage}%
                          </span>
                          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                            {upcProgress.current.toLocaleString('es-PA')} / {upcProgress.total.toLocaleString('es-PA')}
                          </p>
                        </div>
                      </div>

                      {/* Barra de progreso visual con degradado */}
                      <div className="w-full bg-slate-200 rounded-full h-4 overflow-hidden p-0.5 border border-slate-300 shadow-inner">
                        <div 
                          className={`h-full rounded-full transition-all duration-300 ease-out flex items-center justify-end pr-2 ${
                            upcProgress.isComplete
                              ? 'bg-emerald-500 shadow-sm'
                              : upcProgress.error
                              ? 'bg-rose-500'
                              : 'bg-gradient-to-r from-slate-900 via-indigo-900 to-slate-900'
                          }`}
                          style={{ width: `${Math.max(3, upcProgress.percentage)}%` }}
                        >
                          {!upcProgress.isComplete && !upcProgress.error && (
                            <span className="w-2 h-2 bg-white rounded-full animate-ping inline-block" />
                          )}
                        </div>
                      </div>

                      {/* Info inferior de lote y acciones */}
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs pt-1">
                        <span className="text-slate-500 font-semibold text-[11px]">
                          Lote {upcProgress.currentBatch} de {upcProgress.totalBatches} ({Math.min(2500, upcProgress.total)} códigos por lote)
                        </span>

                        <div className="flex items-center gap-2">
                          {upcProgress.isActive && (
                            <button
                              type="button"
                              onClick={() => {
                                if (confirm("¿Seguro que deseas detener la carga? Los códigos ya procesados quedarán guardados en el inventario.")) {
                                  cancelUpcUploadRef.current = true;
                                }
                              }}
                              className="px-3 py-1 bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer"
                            >
                              Detener carga
                            </button>
                          )}
                          {upcProgress.isComplete && (
                            <button
                              type="button"
                              onClick={() => setUpcProgress(null)}
                              className="px-3.5 py-1 bg-emerald-100 border border-emerald-300 text-emerald-800 hover:bg-emerald-200 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer"
                            >
                              Aceptar y Limpiar
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Botones de acción */}
                  <div className="flex flex-wrap items-center gap-4">
                    <button 
                      onClick={async () => {
                        const fileInput = document.getElementById('upcMassFile') as HTMLInputElement;
                        const textInput = document.getElementById('upcMassInput') as HTMLTextAreaElement;
                        let rawText = textInput ? textInput.value : '';
                        
                        if (fileInput && fileInput.files && fileInput.files.length > 0) {
                          const file = fileInput.files[0];
                          try {
                            rawText = await file.text();
                          } catch (e) {
                            return alert("Error al leer el archivo seleccionado.");
                          }
                        }

                        const extracted = extractUpcsFromRawText(rawText);
                        const uniqueUpcs = Array.from(new Set(extracted));

                        if (uniqueUpcs.length === 0) {
                          return alert('No se encontraron códigos UPC válidos para subir. Selecciona un archivo CSV/TXT o pega los códigos en el campo de texto.');
                        }

                        if (!confirm(`¿Deseas iniciar la carga de ${uniqueUpcs.length.toLocaleString('es-PA')} códigos únicos al inventario?\n\nSe procesará en lotes con barra de progreso en tiempo real.`)) {
                          return;
                        }

                        setIsAdminActionLoading(true);
                        setAdminErrorMsg(null);
                        setAdminSuccessMsg(null);
                        cancelUpcUploadRef.current = false;

                        const BATCH_SIZE = 2500;
                        const totalBatches = Math.ceil(uniqueUpcs.length / BATCH_SIZE);
                        let uploadedSoFar = 0;

                        setUpcProgress({
                          isActive: true,
                          current: 0,
                          total: uniqueUpcs.length,
                          percentage: 0,
                          currentBatch: 1,
                          totalBatches,
                          statusText: `Iniciando carga de ${uniqueUpcs.length.toLocaleString('es-PA')} códigos...`,
                          isComplete: false,
                          error: null,
                        });

                        try {
                          for (let b = 0; b < totalBatches; b++) {
                            if (cancelUpcUploadRef.current) {
                              throw new Error(`Carga detenida por el usuario. Se guardaron ${uploadedSoFar.toLocaleString('es-PA')} de ${uniqueUpcs.length.toLocaleString('es-PA')} códigos.`);
                            }

                            const start = b * BATCH_SIZE;
                            const end = Math.min(start + BATCH_SIZE, uniqueUpcs.length);
                            const batch = uniqueUpcs.slice(start, end);
                            const batchNum = b + 1;

                            setUpcProgress(prev => prev ? ({
                              ...prev,
                              currentBatch: batchNum,
                              statusText: `Guardando lote ${batchNum} de ${totalBatches} (${(start + 1).toLocaleString('es-PA')} al ${end.toLocaleString('es-PA')})...`,
                            }) : null);

                            const res = await fetch('/api/admin/upload-upcs', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ upcs: batch })
                            });

                            const json = await res.json();
                            if (!res.ok) {
                              throw new Error(json.error || `Error al procesar lote ${batchNum}`);
                            }

                            uploadedSoFar = end;
                            const percentage = Math.round((uploadedSoFar / uniqueUpcs.length) * 100);

                            setUpcProgress(prev => prev ? ({
                              ...prev,
                              current: uploadedSoFar,
                              percentage,
                              statusText: batchNum === totalBatches
                                ? '¡Todos los lotes procesados exitosamente!'
                                : `Lote ${batchNum} de ${totalBatches} completado (${percentage}%)`,
                            }) : null);
                          }

                          setUpcProgress(prev => prev ? ({
                            ...prev,
                            isActive: false,
                            isComplete: true,
                            current: uniqueUpcs.length,
                            percentage: 100,
                            statusText: `¡Éxito! Se procesaron ${uniqueUpcs.length.toLocaleString('es-PA')} códigos correctamente.`,
                          }) : null);

                          setAdminSuccessMsg(`Se procesaron ${uniqueUpcs.length.toLocaleString('es-PA')} códigos correctamente.`);
                          loadUpcsCount();
                          if (textInput) textInput.value = '';
                          if (fileInput) fileInput.value = '';
                          setUpcFileSummary(null);
                        } catch (err: any) {
                          setUpcProgress(prev => prev ? ({
                            ...prev,
                            isActive: false,
                            error: err.message || 'Error durante la carga',
                            statusText: err.message || 'Ocurrió un error',
                          }) : null);
                          setAdminErrorMsg(err.message || 'Error al subir códigos al inventario.');
                          loadUpcsCount();
                        } finally {
                          setIsAdminActionLoading(false);
                        }
                      }}
                      disabled={isAdminActionLoading || upcProgress?.isActive}
                      className="w-full sm:w-auto px-6 py-3 bg-slate-900 text-white rounded-full text-xs font-bold hover:bg-slate-800 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 shadow-sm cursor-pointer"
                    >
                      {upcProgress?.isActive ? (
                        <>
                          <Loader2 size={14} className="animate-spin" />
                          <span>Subiendo {upcProgress.percentage}%...</span>
                        </>
                      ) : (
                        <>
                          <Database size={14} />
                          <span>Subir Códigos al Inventario</span>
                        </>
                      )}
                    </button>
                  </div>

                  <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-[20px] flex gap-3">
                    <AlertCircle size={18} className="text-emerald-700 shrink-0" />
                    <p className="text-xs text-emerald-700 leading-relaxed font-medium">
                      Una vez que un código esté en el inventario, los operadores no podrán subir fotos para ese producto. Se les mostrará una alerta indicando que ya está publicado.
                    </p>
                  </div>

                </div>
              </div>
            </div>
          )}

          {adminSection === 'config' && (
            <div className="p-8 space-y-6">
              {/* Info del sistema */}
              <div className="glass-card border border-white/60 rounded-[32px] p-6 space-y-4">
                <h3 className="text-xs font-black text-slate-900 uppercase tracking-wider mb-2">Información del Sistema</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="glass-panel border border-white/60 rounded-[20px] p-4">
                    <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Proyecto Supabase</p>
                    <p className="text-xs font-mono text-slate-700 break-all">{import.meta.env.VITE_SUPABASE_URL || '—'}</p>
                  </div>
                  <div className="glass-panel border border-white/60 rounded-[20px] p-4">
                    <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Storage Bucket</p>
                    <p className="text-xs font-mono text-slate-700">product-photos</p>
                  </div>
                  <div className="glass-panel border border-white/60 rounded-[20px] p-4">
                    <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Motor de IA</p>
                    <p className="text-xs font-mono text-slate-700">Gemini 2.5 Flash Image</p>
                  </div>
                  <div className="glass-panel border border-white/60 rounded-[20px] p-4">
                    <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Versión App</p>
                    <p className="text-xs font-mono text-slate-700">Stevens Studio AI v2.0</p>
                  </div>
                </div>
              </div>

              {/* Info del admin actual */}
              <div className="glass-card border border-white/60 rounded-[32px] p-6">
                <h3 className="text-xs font-black text-slate-900 uppercase tracking-wider mb-4">Tu Cuenta</h3>
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 bg-slate-900/10 border border-brand-gold/30 rounded-[20px] flex items-center justify-center text-slate-900">
                    <UserIcon size={24} />
                  </div>
                  <div>
                    <p className="text-lg font-black text-slate-50">{state.user.name}</p>
                    <p className="text-xs text-slate-500 font-mono">{state.user.email}</p>
                    <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-amber-900/35 border border-amber-500/20 text-slate-900 mt-1 inline-block">
                      Administrador
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Barra inferior de navegación (solo móvil) ─────────────── */}
        <nav
          className="md:hidden fixed bottom-0 left-0 right-0 z-40 glass-card border-t border-white/60 backdrop-blur-xl bg-white/85 shadow-[0_-4px_20px_rgba(0,0,0,0.06)]"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div className="flex items-stretch justify-around">
            {adminNavItems.map(item => {
              const active = adminSection === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => setAdminSection(item.key as typeof adminSection)}
                  className={`flex-1 flex flex-col items-center justify-center gap-1 py-2.5 transition-all ${
                    active ? 'text-slate-900' : 'text-slate-400'
                  }`}
                >
                  <span className={`flex items-center justify-center w-11 h-7 rounded-full transition-all ${
                    active ? 'bg-slate-900/10' : ''
                  }`}>
                    {item.icon}
                  </span>
                  <span className="text-[9px] font-black uppercase tracking-tight leading-none">
                    {item.short}
                  </span>
                </button>
              );
            })}
          </div>
        </nav>

        {/* ── Modal: vista previa de foto ───────────────────────────── */}
        {previewPhoto && (
          <div
            className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={closePreview}
          >
            <div
              className="glass-card border border-white/60 rounded-[28px] overflow-hidden w-full max-w-4xl max-h-[92vh] flex flex-col bg-white/90"
              onClick={e => e.stopPropagation()}
            >
              {/* Encabezado */}
              <div className="flex items-center justify-between gap-4 px-5 py-3 border-b border-white/60 bg-white/60">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-mono font-black text-slate-800 truncate">{previewPhoto.upc}</p>
                    {previewPhoto.title && (
                      <span className="text-xs font-bold text-slate-700 truncate">· {previewPhoto.title}</span>
                    )}
                  </div>
                  <p className="text-[9px] font-bold text-slate-500 uppercase tracking-tight mt-0.5">
                    {previewPhoto.userName || 'Anónimo'} · {new Date(previewPhoto.createdAt || '').toLocaleDateString()}
                    {previewList.length > 1 && ` · ${(previewIndex ?? 0) + 1} de ${previewList.length}`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closePreview}
                  title="Cerrar (Esc)"
                  className="p-2 rounded-full glass-card border border-slate-200 text-slate-500 hover:text-slate-900 transition-all shrink-0"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Selector de Foto 1 / Foto 2 si el producto tiene 2 fotos */}
              {previewPhoto.imageUrl2 && (
                <div className="flex items-center justify-center gap-3 px-5 py-2.5 bg-slate-100/90 border-b border-slate-200">
                  <button
                    type="button"
                    onClick={() => setPreviewPhotoSlot(1)}
                    className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all flex items-center gap-2 cursor-pointer shadow-xs ${
                      previewPhotoSlot === 1
                        ? 'bg-slate-900 text-white ring-2 ring-amber-400/40'
                        : 'bg-white text-slate-700 hover:bg-slate-200 border border-slate-300'
                    }`}
                  >
                    <div className="w-4 h-4 rounded overflow-hidden bg-white border border-slate-300 shrink-0">
                      <img src={previewPhoto.imageUrl} alt="1" className="w-full h-full object-contain" />
                    </div>
                    <span>Foto 1 (_1.jpg)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewPhotoSlot(2)}
                    className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all flex items-center gap-2 cursor-pointer shadow-xs ${
                      previewPhotoSlot === 2
                        ? 'bg-slate-900 text-white ring-2 ring-amber-400/40'
                        : 'bg-white text-slate-700 hover:bg-slate-200 border border-slate-300'
                    }`}
                  >
                    <div className="w-4 h-4 rounded overflow-hidden bg-white border border-slate-300 shrink-0">
                      <img src={previewPhoto.imageUrl2} alt="2" className="w-full h-full object-contain" />
                    </div>
                    <span>Foto 2 (_2.jpg)</span>
                  </button>
                </div>
              )}

              {/* Imagen */}
              <div className="relative flex-1 min-h-0 bg-white flex items-center justify-center p-4">
                <img
                  src={previewPhotoSlot === 2 && previewPhoto.imageUrl2 ? previewPhoto.imageUrl2 : previewPhoto.imageUrl}
                  alt={previewPhoto.upc}
                  className="max-w-full max-h-[64vh] object-contain"
                />

                {previewList.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={showPrev}
                      title="Anterior (←)"
                      className="absolute left-3 top-1/2 -translate-y-1/2 p-2 rounded-full glass-card border border-slate-200 text-slate-600 hover:text-slate-900 shadow-sm transition-all"
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <button
                      type="button"
                      onClick={showNext}
                      title="Siguiente (→)"
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full glass-card border border-slate-200 text-slate-600 hover:text-slate-900 shadow-sm transition-all"
                    >
                      <ChevronRight size={18} />
                    </button>
                  </>
                )}
              </div>

              {/* Ficha técnica: Título y Descripción */}
              {(previewPhoto.title || previewPhoto.description) && (
                <div className="px-5 py-3 bg-slate-50/90 border-t border-slate-200/70 max-h-36 overflow-y-auto">
                  {previewPhoto.title && (
                    <p className="text-xs font-bold text-slate-900 mb-1">
                      {previewPhoto.title}
                    </p>
                  )}
                  {previewPhoto.description && (
                    <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-line">
                      {previewPhoto.description}
                    </p>
                  )}
                </div>
              )}

              {/* Acciones */}
              <div className="flex gap-2 px-5 py-3 border-t border-white/60 bg-white/60">
                <button
                  type="button"
                  onClick={() => downloadSinglePhoto(previewPhoto)}
                  className="flex items-center justify-center gap-1 px-4 py-2 bg-slate-900 text-white rounded-full text-[10px] font-bold uppercase tracking-wider hover:bg-slate-800 transition-all cursor-pointer"
                >
                  <Download size={12} /> Descargar {previewPhoto.imageUrl2 ? 'Ambas Fotos' : 'Foto'}
                </button>
                <a
                  href={previewPhotoSlot === 2 && previewPhoto.imageUrl2 ? previewPhoto.imageUrl2 : previewPhoto.imageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-center gap-1 px-4 py-2 glass-card border border-slate-200 text-slate-600 hover:text-slate-900 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all"
                >
                  <ExternalLink size={12} /> Abrir original ({previewPhotoSlot === 2 && previewPhoto.imageUrl2 ? '_2.jpg' : '_1.jpg'})
                </a>
              </div>
            </div>
          </div>
        )}

        {/* MODAL VISOR A PANTALLA COMPLETA CON ZOOM Y ESTÁNDARES EN ADMIN */}
        <FullscreenPhotoModal
          isOpen={isFullscreenOpen}
          onClose={() => setIsFullscreenOpen(false)}
          imageUrl={fullscreenPhotoData?.url || null}
          upcCode={fullscreenPhotoData?.upc || null}
          title={fullscreenPhotoData?.title || null}
          showApprovalControls={false}
        />
      </div>
    );
  }

  // ── RENDER: Operador + pantalla de login ──────────────────────────────────
  const isUpcCameraActive = state.step === AppStep.SCAN_UPC && !state.isProcessing && !showManualUpcModal && !state.error?.startsWith('DUPLICATE_UPC:');
  const isProductCameraActive = state.step === AppStep.PRODUCT_PHOTO && (capturingPhotoSlot === 1 ? !state.productImage : !state.productImage2) && !state.isProcessing;

  return (
    <div className="min-h-screen flex flex-col items-center px-3 py-3 sm:p-4 md:p-8 font-sans relative z-0">
      <div className="absolute inset-0 z-[-1] glass-panel opacity-95"></div>
      
      {/* Header Compacto y Optimizado para Móvil con Branding Stevens */}
      <header className="w-full max-w-4xl mb-4 sm:mb-6 md:mb-8 glass-card/90 rounded-2xl sm:rounded-3xl shadow-xl shadow-black/40 border border-white/60/80 ring-1 ring-slate-900/15 backdrop-blur-md overflow-hidden">
        {/* Rayas oficiales de Stevens (#6CCAD0, #06BAB8, #E4716B, #FFFFFF) */}
        <div className="stevens-brand-stripe"></div>

        <div className="px-3 py-2.5 sm:p-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5 sm:gap-4">
            <div className="bg-slate-900 px-3 py-2 rounded-xl sm:rounded-[18px] shadow-lg shadow-slate-900/20 border border-slate-800 flex items-center justify-center">
              <img src="/stevens-logo-white.png" alt="Stevens" className="h-5 sm:h-6 w-auto object-contain" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-xl font-black text-slate-900 tracking-tight leading-none font-display">Studio AI</h1>
                <span className="hidden sm:inline-block px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-slate-900 text-amber-400 border border-amber-400/30">v1.9.1</span>
              </div>
              <p className="text-[8px] sm:text-[10px] text-slate-600 font-black uppercase tracking-widest mt-0.5 sm:mt-1 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#06BAB8] animate-pulse inline-block"></span> Catalogación E-commerce
              </p>
            </div>
          </div>
        <div className="flex items-center gap-1.5 sm:gap-3">
          {state.user && (
            <div className="flex items-center gap-2 glass-panel border border-white/60 px-2 sm:px-3 py-1 sm:py-1.5 rounded-full sm:rounded-[20px]">
              <div className="text-right hidden sm:block">
                <p className="text-[10px] font-black text-slate-900 leading-none">{state.user.name}</p>
                <p className="text-[8px] font-bold text-slate-500 uppercase tracking-tighter">{state.user.email}</p>
              </div>
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full glass-card border border-white/60 shadow-sm flex items-center justify-center text-slate-900">
                <UserIcon size={14} className="sm:w-4 sm:h-4" />
              </div>
            </div>
          )}
          {state.user && String(state.user.role).toLowerCase().trim() === 'admin' && (
            <button
              onClick={() => {
                const isGoingToAdmin = state.step !== AppStep.ADMIN_DASHBOARD;
                if (isGoingToAdmin) {
                  window.history.pushState({}, '', '/dashboard');
                } else {
                  window.history.pushState({}, '', '/');
                }
                setState(prev => ({
                  ...prev,
                  step: isGoingToAdmin ? AppStep.ADMIN_DASHBOARD : AppStep.SCAN_UPC
                }));
              }}
              className="px-2.5 sm:px-4 py-1.5 sm:py-2 bg-slate-900/10 hover:bg-slate-900/25 border border-brand-gold/20 text-slate-900 font-bold text-[10px] sm:text-xs uppercase tracking-wider rounded-xl sm:rounded-[20px] transition-all cursor-pointer"
            >
              {state.step === AppStep.ADMIN_DASHBOARD ? 'Escáner' : 'Admin'}
            </button>
          )}
          <div className="flex gap-1">
            {state.user && (
              <button 
                onClick={logout} 
                className="p-2 sm:p-2.5 rounded-xl sm:rounded-[20px] glass-panel text-slate-500 hover:text-red-400 border border-white/60 transition-all cursor-pointer"
                title="Cerrar Sesión"
              >
                <LogOut size={16} className="sm:w-5 sm:h-5" />
              </button>
            )}
          </div>
        </div>
        </div>
      </header>

      {/* Indicador de Pasos Móvil y Escritorio */}
      {[AppStep.SCAN_UPC, AppStep.PRODUCT_PHOTO, AppStep.RECORD_AUDIO, AppStep.REVIEW].includes(state.step) && (
        <div className="w-full max-w-lg mb-4 sm:mb-8 flex items-center justify-between relative px-2 animate-in fade-in duration-300">
          <div className="absolute top-1/2 left-0 w-full h-0.5 bg-slate-800 -z-10 -translate-y-1/2" />
          {[1, 2, 3, 4].map((s) => {
            const currentStep = state.step === AppStep.SCAN_UPC ? 1 
              : state.step === AppStep.PRODUCT_PHOTO ? 2 
              : state.step === AppStep.RECORD_AUDIO ? 3 
              : 4;
            const isActive = currentStep >= s;
            const isCurrent = currentStep === s;
            return (
              <div key={s} className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center text-[10px] sm:text-xs font-black border-2 sm:border-4 transition-all duration-500 ${isCurrent ? 'bg-slate-900 border-brand-gold-light text-brand-navy scale-110 sm:scale-125 shadow-xl shadow-slate-900/10' : isActive ? 'bg-slate-900-dark border-brand-gold text-brand-navy' : 'glass-card border-white/60 text-slate-500'}`}>
                {isActive && s < currentStep ? <CheckCircle size={14} className="sm:w-4 sm:h-4" /> : s}
              </div>
            );
          })}
        </div>
      )}

      <main className="w-full max-w-2xl glass-card/95 rounded-[2rem] sm:rounded-[3rem] shadow-2xl shadow-black/60 border border-white/60/80 p-4 sm:p-6 md:p-10 min-h-[480px] sm:min-h-[550px] flex flex-col items-center relative overflow-hidden ring-1 ring-slate-900/10 backdrop-blur-md">
        {state.isProcessing && (
          <div className="absolute inset-0 bg-white/95 backdrop-blur-2xl z-50 flex flex-col items-center justify-center animate-in fade-in duration-300 px-6 sm:px-10 text-center">
            {/* Halo pulsante calmante con icono centrado */}
            <div className="relative mb-6 flex items-center justify-center">
              <div className="absolute w-28 h-28 rounded-full bg-amber-400/20 animate-ping opacity-30" />
              <div className="w-24 h-24 rounded-full bg-gradient-to-tr from-amber-100 via-amber-50 to-emerald-50 border-2 border-amber-400/40 shadow-xl flex items-center justify-center relative">
                {state.step === AppStep.SCAN_UPC ? (
                  <Barcode className="text-slate-900 animate-pulse" size={38} />
                ) : state.step === AppStep.PRODUCT_PHOTO ? (
                  <Sparkles className="text-amber-500 animate-pulse" size={38} />
                ) : (
                  <Package className="text-slate-900 animate-pulse" size={38} />
                )}
                <div className="absolute -bottom-1 -right-1 bg-white p-1 rounded-full shadow-md border border-slate-200">
                  <Loader2 className="animate-spin text-amber-500" size={16} />
                </div>
              </div>
            </div>

            {/* Titulo y descripcion calmante de la etapa */}
            <div className="max-w-md space-y-2 mb-6">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100/80 border border-amber-300/60 text-amber-900 text-[10px] font-black uppercase tracking-wider">
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                {calmStageInfo.badge} · {processingElapsed}s
              </span>
              <h3 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight font-display">
                {calmStageInfo.title}
              </h3>
              <p className="text-xs text-slate-600 font-medium leading-relaxed">
                {calmStageInfo.subtitle}
              </p>
            </div>

            {/* Barra de progreso suave y continua */}
            <div className="w-full max-w-xs space-y-1.5 mb-5">
              <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden p-0.5 border border-slate-200/80 shadow-inner">
                <div 
                  className="h-full bg-gradient-to-r from-amber-400 via-amber-500 to-emerald-500 rounded-full transition-all duration-700 ease-out"
                  style={{ width: `${calmStageInfo.progress}%` }}
                />
              </div>
              <div className="flex justify-between items-center text-[10px] text-slate-400 font-bold">
                <span>Análisis en curso</span>
                <span>{calmStageInfo.progress}%</span>
              </div>
            </div>

            {/* Mensaje tranquilizador para el operador */}
            <div className="bg-slate-50 border border-slate-200/80 rounded-2xl px-4 py-2.5 max-w-xs flex items-center gap-2.5 shadow-sm text-left">
              <span className="text-base select-none">✨</span>
              <p className="text-[11px] text-slate-600 leading-tight font-medium">
                Todo va bien. La aplicación avanzará automáticamente al siguiente paso.
              </p>
            </div>

            {/* Opciones de contingencia y control para el operador */}
            <div className="mt-5 flex flex-col sm:flex-row items-center gap-2.5 animate-in fade-in duration-300">
              {state.step === AppStep.SCAN_UPC && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      if (upcAbortControllerRef.current) {
                        try { upcAbortControllerRef.current.abort(); } catch {}
                      }
                      setState(prev => ({ ...prev, isProcessing: false }));
                      setManualUpcInput('');
                      setManualUpcError(null);
                      setShowManualUpcModal(true);
                    }}
                    className="w-full sm:w-auto px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Keyboard size={15} className="text-amber-400" />
                    Digitar UPC manualmente
                  </button>

                  <button
                    type="button"
                    onClick={handleCancelProcessing}
                    className="w-full sm:w-auto px-3.5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-all border border-slate-300/70 flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <X size={14} className="text-slate-500" />
                    Cancelar y reintentar foto
                  </button>
                </>
              )}

              {state.step === AppStep.PRODUCT_PHOTO && lastProductRawImage && processingElapsed >= 5 && (
                <button
                  type="button"
                  onClick={handleUseDirectPhoto}
                  className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center gap-2 animate-in fade-in duration-300 cursor-pointer"
                >
                  <CheckCircle size={14} className="text-amber-400" />
                  ¿Tienes prisa? Usar foto directa sin esperar
                </button>
              )}

              {state.step !== AppStep.SCAN_UPC && processingElapsed >= 8 && (
                <button
                  type="button"
                  onClick={handleCancelProcessing}
                  className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-semibold transition-all border border-slate-300/70 flex items-center gap-1.5 cursor-pointer"
                >
                  <X size={13} /> Cancelar proceso
                </button>
              )}
            </div>
          </div>
        )}

        {/* Modal para digitar UPC manualmente */}
        {showManualUpcModal && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-[32px] p-6 sm:p-8 max-w-sm w-full flex flex-col shadow-2xl animate-in zoom-in-95 duration-200 border border-slate-100">
              <div className="flex items-center justify-between mb-4">
                <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                  <Keyboard size={24} className="text-amber-600" />
                </div>
                <button
                  type="button"
                  onClick={() => setShowManualUpcModal(false)}
                  className="p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              <h3 className="text-xl font-black text-slate-900 font-display tracking-tight mb-1">
                Ingresar UPC Manualmente
              </h3>
              <p className="text-xs text-slate-500 font-medium mb-5">
                Escribe o pega los dígitos del código de barras del producto.
              </p>

              <form onSubmit={handleManualUpcSubmit} className="space-y-4">
                <div>
                  <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider block mb-1.5">
                    Código de Barras / UPC
                  </label>
                  <input
                    type="text"
                    autoFocus
                    value={manualUpcInput}
                    onChange={(e) => setManualUpcInput(e.target.value)}
                    placeholder="Ej. 7501031311309"
                    className="w-full px-4 py-3.5 bg-slate-50 border-2 border-slate-200 focus:border-amber-500 focus:bg-white rounded-2xl text-slate-900 font-mono font-bold text-lg tracking-wider outline-none transition-all"
                  />
                  {manualUpcError && (
                    <p className="mt-2 text-xs font-bold text-red-600 flex items-center gap-1">
                      <AlertCircle size={14} className="shrink-0" /> {manualUpcError}
                    </p>
                  )}
                </div>

                <div className="flex gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowManualUpcModal(false);
                      setCameraKey(k => k + 1);
                    }}
                    className="flex-1 py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs uppercase tracking-wider rounded-xl transition-all cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={isCheckingManualUpc || !manualUpcInput.trim()}
                    className="flex-1 py-3 px-4 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {isCheckingManualUpc ? (
                      <>
                        <Loader2 size={14} className="animate-spin text-amber-400" />
                        Validando...
                      </>
                    ) : (
                      'Continuar'
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {state.error && state.error.startsWith('DUPLICATE_UPC:') ? (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="bg-white rounded-[32px] p-8 max-w-sm w-full flex flex-col items-center text-center shadow-2xl border border-amber-200/60 animate-in zoom-in-95 duration-300">
              <div className="w-20 h-20 bg-amber-50 border-2 border-amber-200 rounded-full flex items-center justify-center mb-4 shadow-sm">
                <CheckCircle2 size={40} className="text-amber-500" />
              </div>
              <span className="px-3 py-1 bg-amber-100 text-amber-900 rounded-full text-[10px] font-black uppercase tracking-wider mb-2">
                Producto en Catálogo
              </span>
              <h2 className="text-xl font-black text-slate-900 mb-2">¡Este producto ya está publicado!</h2>
              <p className="text-xs text-slate-600 mb-6 font-medium leading-relaxed">
                El código <span className="font-mono font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">{state.error.split(':')[1]}</span> ya cuenta con fotos y ficha en el catálogo activo.<br/><br/>
                ¡Excelente! Te ahorraste este artículo. Puedes continuar directamente con el siguiente producto.
              </p>
              <button 
                type="button"
                onClick={handleScanAnother} 
                className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-3.5 rounded-full transition-all shadow-md active:scale-95 flex items-center justify-center gap-2 cursor-pointer text-xs uppercase tracking-wider"
              >
                <Barcode size={16} className="text-amber-400" />
                <span>Escanear siguiente producto</span>
              </button>
            </div>
          </div>
        ) : state.error ? (
          <div className="w-full mb-8 p-6 bg-rose-50 border border-rose-200 rounded-3xl flex flex-col gap-3 text-rose-800 animate-in zoom-in duration-300 shadow-sm">
            <div className="flex gap-4 items-center">
              <AlertCircle size={32} className="shrink-0 text-rose-600" />
              <div className="flex-1">
                <p className="text-[10px] font-black uppercase mb-1 tracking-widest text-rose-600">Aviso</p>
                <p className="text-sm font-bold leading-tight">{state.error}</p>
              </div>
              <button onClick={() => { setState(prev => ({ ...prev, error: null })); setCameraKey(k => k + 1); }} className="glass-panel p-2 rounded-full border border-white/60 text-slate-700 cursor-pointer">
                <X size={16} />
              </button>
            </div>
            {state.step === AppStep.SCAN_UPC && !state.isProcessing && (
              <div className="flex flex-wrap gap-2 pt-2 border-t border-rose-200/60 justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setManualUpcInput('');
                    setManualUpcError(null);
                    setShowManualUpcModal(true);
                  }}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 shadow transition-colors cursor-pointer"
                >
                  <Keyboard size={13} className="text-amber-400" /> Escribir UPC manualmente
                </button>
              </div>
            )}
            {state.step === AppStep.PRODUCT_PHOTO && lastProductRawImage && !state.isProcessing && (
              <div className="flex flex-wrap gap-2 pt-2 border-t border-rose-200/60 justify-end">
                <button
                  type="button"
                  onClick={() => handleCaptureProduct(lastProductRawImage)}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-xl flex items-center gap-1.5 shadow transition-colors cursor-pointer"
                >
                  <RefreshCw size={13} /> Reintentar Estudio IA
                </button>
                <button
                  type="button"
                  onClick={handleUseDirectPhoto}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 shadow transition-colors cursor-pointer"
                >
                  <CheckCircle size={13} /> Usar Foto Directa
                </button>
              </div>
            )}
          </div>
        ) : null}

        {/* Login */}
        {state.step === AppStep.LOGIN && (
          <div className="w-full max-w-md flex flex-col items-center animate-in fade-in duration-300">
            <div className="text-center mb-8">
              <div className="bg-slate-900 px-6 py-4 rounded-3xl inline-flex items-center justify-center mx-auto mb-4 border border-slate-800 shadow-xl shadow-slate-900/30">
                <img src="/stevens-logo-white.png" alt="Stevens" className="h-8 w-auto object-contain" />
              </div>
              <div className="stevens-brand-stripe rounded-full max-w-[160px] mx-auto mb-3 h-1"></div>
              <h2 className="text-2xl font-black text-slate-900 tracking-tight uppercase font-display">Inicio de Sesión</h2>
              <p className="text-slate-600 font-medium text-xs mt-1">Ingresa tus credenciales de Stevens Studio AI</p>
            </div>
            <form onSubmit={handleLogin} className="w-full space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-700 uppercase mb-2 block tracking-wider">Usuario o Correo</label>
                <input type="text" value={loginEmail} onChange={e => setLoginEmail(e.target.value)}
                  placeholder="Admin o usuario@correo.com"
                  className="w-full px-5 py-4 bg-slate-900 border border-slate-700 text-white placeholder-slate-400 rounded-2xl text-sm focus:border-amber-400 focus:outline-none transition-all shadow-inner font-medium" required />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-700 uppercase mb-2 block tracking-wider">Contraseña</label>
                <input type="password" value={loginPassword} onChange={e => setLoginPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-5 py-4 bg-slate-900 border border-slate-700 text-white placeholder-slate-400 rounded-2xl text-sm focus:border-amber-400 focus:outline-none transition-all shadow-inner font-medium" required />
              </div>
              <button type="submit"
                className="w-full py-4 mt-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black rounded-2xl transition-all active:scale-95 uppercase tracking-wider text-xs shadow-lg shadow-amber-500/20">
                Ingresar
              </button>
            </form>
          </div>
        )}

        {/* Paso 1: Scan UPC */}
        {state.step === AppStep.SCAN_UPC && (
          <div className="w-full flex flex-col items-center animate-in fade-in slide-in-from-bottom-6 duration-500">
            <div className="text-center mb-8">
              <div className="glass-card w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3 border border-brand-gold/20 shadow-lg shadow-black/40">
                <Barcode className="text-slate-900" size={28} />
              </div>
              <h2 className="text-2xl font-black text-slate-900 tracking-tight uppercase font-display">Paso 1: Identificar UPC</h2>
              <p className="text-slate-500 font-medium text-xs mt-1">Apunta con la cámara al código de barras del producto</p>
            </div>
            <Camera 
              key={`upc-camera-${cameraKey}`} 
              isActive={isUpcCameraActive} 
              onCapture={handleCaptureUPC} 
              label="ESCÁNER UPC ACTIVO" 
              mode="upc" 
            />
            <button
              type="button"
              onClick={() => {
                setManualUpcInput('');
                setManualUpcError(null);
                setShowManualUpcModal(true);
              }}
              className="mt-6 flex items-center justify-center gap-2 text-xs font-bold text-slate-700 hover:text-slate-950 bg-white hover:bg-slate-50 border border-slate-200/90 hover:border-slate-300 px-5 py-3 rounded-2xl shadow-sm transition-all cursor-pointer"
            >
              <Keyboard size={16} className="text-amber-500" />
              ¿Problemas con el código? Escribir UPC manualmente
            </button>
          </div>
        )}

        {/* Paso 2: Product Photo (Foto 1 obligatoria + Foto 2 opcional) */}
        {state.step === AppStep.PRODUCT_PHOTO && (
          <div className="w-full flex flex-col items-center animate-in fade-in slide-in-from-bottom-6 duration-500">
            {/* Header del Paso 2 con selector de Foto 1 / Foto 2 */}
            <div className="w-full flex items-center justify-between mb-4 sm:mb-6">
              <button 
                onClick={() => {
                  setState(prev => ({ ...prev, step: AppStep.SCAN_UPC, upcCode: null, upcImage: null }));
                  setCameraKey(k => k + 1);
                }} 
                className="p-2 sm:p-3 hover:glass-panel rounded-xl sm:rounded-[20px] transition-all text-slate-500 cursor-pointer"
                title="Regresar al escáner UPC"
              >
                <ArrowLeft size={20} className="sm:w-[22px] sm:h-[22px]" />
              </button>
              <div className="text-center">
                <h2 className="text-lg sm:text-2xl font-black text-slate-900 uppercase tracking-tight font-display">Paso 2: Fotos de Estudio</h2>
                <div className="mt-0.5 sm:mt-1 flex items-center justify-center gap-2">
                  <span className="text-slate-900 font-mono font-black text-[9px] sm:text-[10px] bg-slate-900/10 px-2.5 sm:px-3 py-0.5 sm:py-1 rounded-full border border-brand-gold/30">UPC: {state.upcCode}</span>
                </div>
              </div>
              <div className="w-8 sm:w-10" />
            </div>

            {/* Selector de pestañas: Foto 1 (_1.jpg) y Foto 2 (_2.jpg opcional) */}
            <div className="w-full max-w-md grid grid-cols-2 gap-2 sm:gap-3 mb-4 sm:mb-6">
              <button
                type="button"
                onClick={() => setCapturingPhotoSlot(1)}
                className={`py-2.5 sm:py-3 px-3 sm:px-4 rounded-xl sm:rounded-2xl border text-[11px] sm:text-xs font-bold transition-all flex items-center justify-center gap-1.5 sm:gap-2 cursor-pointer shadow-sm ${
                  capturingPhotoSlot === 1
                    ? 'bg-slate-900 text-white border-amber-400 ring-2 ring-amber-400/30'
                    : 'bg-white/80 hover:bg-white text-slate-700 border-slate-200'
                }`}
              >
                <CameraIcon size={14} className={state.productImage ? 'text-emerald-500' : 'text-amber-400'} />
                <span className="truncate">Foto 1 (_1.jpg)</span>
                {state.productImage ? (
                  <CheckCircle2 size={13} className="text-emerald-500 shrink-0 ml-auto" />
                ) : (
                  <span className="text-[8px] sm:text-[9px] font-mono uppercase bg-amber-500/20 text-amber-600 px-1 py-0.5 rounded-full ml-auto">Req.</span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setCapturingPhotoSlot(2)}
                className={`py-2.5 sm:py-3 px-3 sm:px-4 rounded-xl sm:rounded-2xl border text-[11px] sm:text-xs font-bold transition-all flex items-center justify-center gap-1.5 sm:gap-2 cursor-pointer shadow-sm ${
                  capturingPhotoSlot === 2
                    ? 'bg-slate-900 text-white border-amber-400 ring-2 ring-amber-400/30'
                    : 'bg-white/80 hover:bg-white text-slate-700 border-slate-200'
                }`}
              >
                <CameraIcon size={14} className={state.productImage2 ? 'text-emerald-500' : 'text-slate-400'} />
                <span className="truncate">Foto 2 (_2.jpg)</span>
                {state.productImage2 ? (
                  <CheckCircle2 size={13} className="text-emerald-500 shrink-0 ml-auto" />
                ) : (
                  <span className="text-[8px] sm:text-[9px] font-mono uppercase bg-slate-200 text-slate-600 px-1 py-0.5 rounded-full ml-auto">Opc.</span>
                )}
              </button>
            </div>

            {/* Vista condicional: Cámara vs Foto ya tomada para el slot activo */}
            {((capturingPhotoSlot === 1 && !state.productImage) || (capturingPhotoSlot === 2 && !state.productImage2)) ? (
              <>
                <Camera 
                  key={`product-camera-${capturingPhotoSlot}-${cameraKey}`} 
                  isActive={isProductCameraActive} 
                  onCapture={handleCaptureProduct} 
                  label={`FOTO ${capturingPhotoSlot} (${capturingPhotoSlot === 1 ? 'PRINCIPAL _1.jpg' : 'OPCIONAL _2.jpg'})`} 
                  mode="product" 
                />
                <p className="mt-6 text-[10px] text-slate-500 font-black uppercase tracking-widest text-center">Fondo Blanco Puro • Sin Sombras • Remoción Automática IA</p>
              </>
            ) : (
              /* REVISIÓN INMEDIATA DE LA FOTO DEL SLOT ACTIVO */
              <div className="w-full flex flex-col items-center animate-in zoom-in-95 duration-300">
                <div className="w-full max-w-md flex items-center justify-between mb-4">
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 border border-emerald-300 text-emerald-800 text-[10px] font-black uppercase tracking-wider">
                    <CheckCircle2 size={12} className="text-emerald-600" /> Foto {capturingPhotoSlot} Lista ({capturingPhotoSlot === 1 ? '_1.jpg' : '_2.jpg'})
                  </div>

                  {capturingPhotoSlot === 2 && state.productImage2 && (
                    <button
                      type="button"
                      onClick={() => setState(prev => ({ ...prev, productImage2: null }))}
                      className="text-xs text-rose-600 hover:text-rose-700 font-bold underline cursor-pointer"
                    >
                      Eliminar Foto 2
                    </button>
                  )}
                </div>

                {/* CONTENEDOR DE VISTA PREVIA INTERACTIVA */}
                <div className="w-full max-w-md bg-white rounded-3xl p-4 sm:p-5 shadow-2xl border-2 border-slate-200/90 flex flex-col items-center relative group">
                  {/* Lienzo cuadrado 1:1 estilo e-commerce */}
                  <div 
                    onClick={() => {
                      const imgToOpen = capturingPhotoSlot === 1 ? state.productImage! : state.productImage2!;
                      openFullscreenPhoto(imgToOpen, state.upcCode, `Foto ${capturingPhotoSlot} (${capturingPhotoSlot === 1 ? '_1.jpg' : '_2.jpg'})`, true);
                    }}
                    className="relative w-full aspect-square bg-white rounded-2xl overflow-hidden border border-slate-200/80 cursor-pointer shadow-inner flex items-center justify-center group"
                    title="Toca para ampliar a pantalla completa"
                  >
                    <img 
                      src={(capturingPhotoSlot === 1 ? state.productImage! : state.productImage2!)} 
                      alt={`Foto ${capturingPhotoSlot}`} 
                      className="w-full h-full object-contain transition-transform duration-300 group-hover:scale-105" 
                    />
                    
                    {/* Hover / Overlay para invitar a pantalla completa */}
                    <div className="absolute inset-0 bg-slate-950/25 group-hover:bg-slate-950/45 opacity-0 group-hover:opacity-100 transition-all flex flex-col items-center justify-center gap-2 p-4 text-center">
                      <span className="px-4 py-2 bg-slate-950/90 text-white rounded-full text-xs font-bold flex items-center gap-2 shadow-xl backdrop-blur-md border border-white/20 transform group-hover:scale-105 transition-transform">
                        <Maximize2 size={16} className="text-amber-400" />
                        Toca para pantalla completa
                      </span>
                      <p className="text-[11px] text-white/95 font-medium drop-shadow">
                        Revisa fondo blanco, nitidez y recorte al detalle
                      </p>
                    </div>

                    {/* Badge de dimension estándar */}
                    <div className="absolute bottom-2 left-2 bg-slate-900/80 backdrop-blur-md border border-slate-700 text-white px-2 py-0.5 rounded-md text-[9px] font-mono font-bold">
                      {state.upcCode}_{capturingPhotoSlot}.jpg • 1000 × 1000 px
                    </div>
                  </div>

                  {/* Botón directo de pantalla completa para máxima claridad */}
                  <button
                    type="button"
                    onClick={() => {
                      const imgToOpen = capturingPhotoSlot === 1 ? state.productImage! : state.productImage2!;
                      openFullscreenPhoto(imgToOpen, state.upcCode, `Foto ${capturingPhotoSlot} (${capturingPhotoSlot === 1 ? '_1.jpg' : '_2.jpg'})`, true);
                    }}
                    className="mt-3.5 w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Maximize2 size={14} className="text-amber-400" />
                    Ampliar a Pantalla Completa (Zoom e Inspección)
                  </button>

                  {/* Miniaturas de ambas fotos si existen */}
                  <div className="w-full mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <div 
                        onClick={() => setCapturingPhotoSlot(1)}
                        className={`w-12 h-12 rounded-xl border-2 p-1 bg-white cursor-pointer transition-all ${
                          capturingPhotoSlot === 1 ? 'border-amber-500 scale-105 shadow-md' : 'border-slate-200 opacity-70 hover:opacity-100'
                        }`}
                        title="Ver Foto 1"
                      >
                        {state.productImage ? (
                          <img src={state.productImage} alt="Foto 1" className="w-full h-full object-contain" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-[10px] text-slate-400 font-bold">1</div>
                        )}
                      </div>

                      <div 
                        onClick={() => setCapturingPhotoSlot(2)}
                        className={`w-12 h-12 rounded-xl border-2 p-1 bg-white cursor-pointer transition-all ${
                          capturingPhotoSlot === 2 ? 'border-amber-500 scale-105 shadow-md' : 'border-slate-200 opacity-70 hover:opacity-100'
                        }`}
                        title="Ver Foto 2"
                      >
                        {state.productImage2 ? (
                          <img src={state.productImage2} alt="Foto 2" className="w-full h-full object-contain" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-[10px] text-slate-400 font-bold">+2</div>
                        )}
                      </div>
                    </div>

                    <div className="text-right">
                      <p className="text-[11px] font-bold text-slate-800">
                        {state.productImage2 ? '2 de 2 fotos listas' : '1 foto lista (2da opcional)'}
                      </p>
                      <p className="text-[9px] font-mono text-slate-500">
                        {state.productImage2 ? `${state.upcCode}_1.jpg y _2.jpg` : `${state.upcCode}_1.jpg`}
                      </p>
                    </div>
                  </div>
                </div>

                {/* ACCIONES DEL OPERADOR */}
                <div className="w-full max-w-md mt-4 sm:mt-5 flex flex-col gap-2.5">
                  {/* Si está en Foto 1 y aún no toma Foto 2, destacamos la opción de Foto 2 primero */}
                  {capturingPhotoSlot === 1 && !state.productImage2 && (
                    <button
                      type="button"
                      onClick={() => setCapturingPhotoSlot(2)}
                      className="w-full py-3.5 px-4 bg-slate-900 hover:bg-slate-800 text-white font-black text-xs uppercase tracking-wider rounded-xl sm:rounded-2xl transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md border border-amber-400/40"
                    >
                      <CameraIcon size={16} className="text-amber-400" />
                      <span>Tomar Foto 2 (_2.jpg Opcional)</span>
                    </button>
                  )}

                  <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        if (capturingPhotoSlot === 1) {
                          setState(prev => ({ ...prev, productImage: null }));
                        } else {
                          setState(prev => ({ ...prev, productImage2: null }));
                        }
                        setCameraKey(k => k + 1);
                      }}
                      className="w-full sm:flex-1 py-3 sm:py-3.5 px-3 sm:px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs uppercase tracking-wider rounded-xl sm:rounded-2xl transition-all border border-slate-300/80 flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <RefreshCw size={14} className="text-slate-500" />
                      Volver a Tomar
                    </button>

                    <button
                      type="button"
                      onClick={() => setState(prev => ({ ...prev, step: AppStep.RECORD_AUDIO }))}
                      disabled={!state.productImage}
                      className="w-full sm:flex-1 py-3.5 sm:py-3.5 px-4 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs uppercase tracking-wider rounded-xl sm:rounded-2xl transition-all shadow-lg shadow-amber-500/25 flex items-center justify-center gap-2 cursor-pointer active:scale-95 disabled:opacity-50"
                    >
                      <CheckCircle2 size={16} />
                      {state.productImage2 ? 'Continuar con 2 Fotos' : 'Continuar con 1 Foto'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Paso 3: Record Audio */}
        {state.step === AppStep.RECORD_AUDIO && (
          <div className="w-full flex flex-col items-center animate-in fade-in slide-in-from-bottom-6 duration-500">
            <div className="w-full flex items-center justify-between mb-6">
              <button onClick={() => setState(prev => ({ ...prev, step: AppStep.PRODUCT_PHOTO }))} className="p-3 hover:glass-panel rounded-[20px] transition-all text-slate-500"><ArrowLeft size={22} /></button>
              <div className="text-center">
                <span className="text-slate-900 font-mono font-black text-[10px] bg-slate-900/10 px-3 py-1 rounded-full border border-brand-gold/30">UPC: {state.upcCode}</span>
              </div>
              <div className="w-10" />
            </div>
            
            <AudioRecorder
              productImage={state.productImage}
              productImage2={state.productImage2}
              upcCode={state.upcCode}
              initialTitle={state.productTitle}
              initialDescription={state.productDescription}
              initialTranscription={state.transcription}
              onViewFullscreen={(img) => openFullscreenPhoto(img, state.upcCode, state.productTitle, false)}
              onAudioProcessed={(data) => {
                setState(prev => ({
                  ...prev,
                  audioBase64: data.audioBase64,
                  transcription: data.transcription,
                  productTitle: data.title,
                  productDescription: data.description,
                  step: AppStep.REVIEW
                }));
              }}
              onSkip={() => {
                setState(prev => ({
                  ...prev,
                  step: AppStep.REVIEW
                }));
              }}
            />
          </div>
        )}

        {/* Paso 4: Review */}
        {state.step === AppStep.REVIEW && state.productImage && (
          <div className="w-full flex flex-col items-center animate-in fade-in slide-in-from-bottom-6 duration-500">
            <div className="text-center mb-8">
              <div className="inline-flex items-center gap-2 bg-slate-900/10 text-slate-900 px-5 py-2 rounded-full text-[10px] font-black uppercase tracking-[0.2em] border border-brand-gold/30 mb-3 font-sans">
                <Sparkles size={14} className="text-slate-900" /> Ficha de Producto Lista
              </div>
              <h2 className="text-3xl font-black text-slate-900 tracking-tight uppercase font-display">Paso 4: Confirmación Final</h2>
            </div>

            <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              {/* VISTA PREVIA IMÁGENES (Foto 1 obligatoria + Foto 2 opcional) */}
              <div className="flex flex-col items-center gap-4">
                <div className={`w-full grid gap-4 ${state.productImage2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                  {/* Foto 1 */}
                  <div className="flex flex-col items-center">
                    <div 
                      onClick={() => openFullscreenPhoto(state.productImage!, state.upcCode, `${state.productTitle || ''} (Foto 1)`, false)}
                      className="relative w-full aspect-square rounded-[1.8rem] overflow-hidden border-2 border-slate-700 shadow-xl p-2 bg-white cursor-pointer group"
                      title="Toca para ampliar Foto 1 (_1.jpg)"
                    >
                      <img src={state.productImage} alt="Foto 1" className="w-full h-full object-contain" />
                      <div className="absolute inset-0 bg-slate-950/35 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                        <span className="px-2.5 py-1 rounded-full bg-slate-900/90 text-white text-[11px] font-bold flex items-center gap-1 shadow-md">
                          <Maximize2 size={12} /> Ampliar
                        </span>
                      </div>
                    </div>
                    <div className="mt-2 text-center">
                      <span className="text-[10px] font-mono font-bold text-slate-300 bg-slate-900 px-3 py-1 rounded-full border border-slate-800">
                        {state.upcCode}_1.jpg
                      </span>
                    </div>
                  </div>

                  {/* Foto 2 (si existe) */}
                  {state.productImage2 && (
                    <div className="flex flex-col items-center">
                      <div 
                        onClick={() => openFullscreenPhoto(state.productImage2!, state.upcCode, `${state.productTitle || ''} (Foto 2)`, false)}
                        className="relative w-full aspect-square rounded-[1.8rem] overflow-hidden border-2 border-slate-700 shadow-xl p-2 bg-white cursor-pointer group"
                        title="Toca para ampliar Foto 2 (_2.jpg)"
                      >
                        <img src={state.productImage2} alt="Foto 2" className="w-full h-full object-contain" />
                        <div className="absolute inset-0 bg-slate-950/35 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                          <span className="px-2.5 py-1 rounded-full bg-slate-900/90 text-white text-[11px] font-bold flex items-center gap-1 shadow-md">
                            <Maximize2 size={12} /> Ampliar
                          </span>
                        </div>
                      </div>
                      <div className="mt-2 text-center">
                        <span className="text-[10px] font-mono font-bold text-slate-300 bg-slate-900 px-3 py-1 rounded-full border border-slate-800">
                          {state.upcCode}_2.jpg
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="text-center">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 bg-amber-500/10 px-3 py-1 rounded-full border border-amber-500/20">
                    {state.productImage2 ? '✓ 2 Fotografías Listas (1000×1000 px)' : '✓ 1 Fotografía Lista (1000×1000 px)'}
                  </span>
                </div>
              </div>

              {/* DETALLES Y FICHA TÉCNICA */}
              <div className="space-y-4 text-left">
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
                  <div>
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mb-1">UPC del Producto</span>
                    <p className="text-lg font-mono font-bold text-white">{state.upcCode}</p>
                  </div>

                  {state.productTitle && (
                    <div>
                      <span className="text-[9px] font-bold text-amber-400 uppercase tracking-wider block mb-1">Título Generado</span>
                      <p className="text-sm font-semibold text-slate-100">{state.productTitle}</p>
                    </div>
                  )}

                  {state.productDescription && (
                    <div>
                      <span className="text-[9px] font-bold text-amber-400 uppercase tracking-wider block mb-1">Descripción Detallada</span>
                      <p className="text-xs text-slate-300 leading-relaxed max-h-32 overflow-y-auto">{state.productDescription}</p>
                    </div>
                  )}

                  {state.transcription && (
                    <div className="pt-2 border-t border-slate-800">
                      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">Transcripción de Audio</span>
                      <p className="text-[11px] text-slate-400 italic">"{state.transcription}"</p>
                    </div>
                  )}
                </div>

                {state.user && (
                  <div className="bg-slate-900/60 rounded-2xl p-4 border border-slate-800 flex items-center gap-3">
                    <Cloud size={20} className="text-amber-400 shrink-0" />
                    <div>
                      <p className="text-[9px] font-bold uppercase text-slate-400 tracking-wider">Destino en la Nube</p>
                      <p className="text-xs font-semibold text-slate-200">Supabase Catalog (Jorge) • {state.user.name}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-col w-full gap-4">
              {uploadStatus === 'success' ? (
                <div className="w-full bg-emerald-950/40 border border-emerald-500/30 p-8 rounded-[2.5rem] flex flex-col items-center gap-4 animate-in zoom-in duration-500 text-center">
                  <div className="w-16 h-16 bg-emerald-500 text-slate-950 rounded-full flex items-center justify-center shadow-lg shadow-emerald-500/20 border-4 border-slate-900 animate-bounce">
                    <CheckCircle size={36} />
                  </div>
                  <div>
                    <h4 className="font-black text-emerald-400 text-xl uppercase tracking-tight font-display">¡Producto Publicado!</h4>
                    <p className="text-slate-300 text-xs mt-1">La foto optimizada y la ficha descriptiva fueron registradas exitosamente.</p>
                  </div>
                  <button onClick={reset} className="px-8 py-4 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-2xl font-bold transition-all shadow-lg active:scale-95 uppercase text-xs tracking-widest mt-2">
                    Siguiente Producto
                  </button>
                </div>
              ) : (
                <>
                  <button onClick={saveToSupabase} disabled={uploadStatus === 'uploading'}
                    className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-black py-4 sm:py-5 rounded-2xl flex items-center justify-center gap-2 sm:gap-3 shadow-xl shadow-amber-500/20 transition-all active:scale-95 disabled:opacity-50 cursor-pointer">
                    <Package size={20} className="sm:w-6 sm:h-6" />
                    <span className="text-sm sm:text-base uppercase tracking-wider font-display">Guardar Producto</span>
                  </button>
                  <div className="grid grid-cols-2 gap-2 sm:gap-4">
                    <button onClick={handleDownload} className="glass-panel border border-white/60 text-slate-900 hover:text-slate-900 font-bold py-3 sm:py-3.5 px-2 rounded-xl flex items-center justify-center gap-1.5 uppercase text-[9px] sm:text-[10px] tracking-wider hover:bg-slate-800/60 shadow-sm cursor-pointer">
                      <Download size={14} className="sm:w-4 sm:h-4 text-amber-500" /> 
                      <span>{state.productImage2 ? 'Descargar Ambas' : 'Descargar Foto'}</span>
                    </button>
                    <button onClick={reset} className="glass-panel border border-white/60 text-slate-500 font-bold py-3 sm:py-3.5 px-2 rounded-xl flex items-center justify-center gap-1.5 uppercase text-[9px] sm:text-[10px] tracking-wider hover:bg-slate-800/60 shadow-sm cursor-pointer">
                      <span>Cancelar</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </main>

      <footer className="mt-auto pt-10 pb-6 text-slate-500 text-[10px] font-black uppercase tracking-[0.25em] flex flex-col items-center gap-3">
        <div className="flex items-center gap-4 glass-card/90 px-6 py-2.5 rounded-full border border-white/60/80 shadow-md">
          <div className="bg-slate-900 px-2.5 py-1 rounded-lg">
            <img src="/stevens-logo-white.png" alt="Stevens" className="h-3.5 w-auto object-contain" />
          </div>
          <div className="w-px h-3.5 bg-slate-300"/>
          <span className="flex items-center gap-1.5 text-slate-700 font-bold"><Sparkles size={13} className="text-[#06BAB8]"/> ECOMMERCE STUDIO AI</span>
        </div>
        <p className="opacity-50 text-[9px]">Stevens Panamá &copy; 2026 • Supabase Cloud Secure</p>
      </footer>

      {/* MODAL VISOR A PANTALLA COMPLETA CON ZOOM Y ESTÁNDARES */}
      <FullscreenPhotoModal
        isOpen={isFullscreenOpen}
        onClose={() => setIsFullscreenOpen(false)}
        imageUrl={fullscreenPhotoData?.url || null}
        upcCode={fullscreenPhotoData?.upc || state.upcCode}
        title={fullscreenPhotoData?.title || state.productTitle}
        showApprovalControls={fullscreenPhotoData?.showApproval || false}
        onApprove={() => {
          setIsFullscreenOpen(false);
          if (state.step === AppStep.PRODUCT_PHOTO) {
            if (capturingPhotoSlot === 1 && !state.productImage2) {
              // Si aprobó la Foto 1 en pantalla completa y aún no toma la Foto 2, lo pasamos directamente al slot 2
              setCapturingPhotoSlot(2);
              return;
            }
          }
          setState(prev => ({ ...prev, step: AppStep.RECORD_AUDIO }));
        }}
        onRetake={() => {
          setIsFullscreenOpen(false);
          if (capturingPhotoSlot === 1) {
            setState(prev => ({ ...prev, productImage: null }));
          } else {
            setState(prev => ({ ...prev, productImage2: null }));
          }
          setCameraKey(k => k + 1);
        }}
      />
    </div>
  );
};

export default App;





