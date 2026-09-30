
import React, { useState, useEffect } from 'react';
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
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { AppStep, AppState, User } from './types';
import Camera from './components/Camera';
import AudioRecorder from './components/AudioRecorder';
import { geminiService } from './services/geminiService';
import { supabase } from './services/supabase';
import { processAndResizeProductImage } from './services/imageProcessor';
import { createZip, uniqueName } from './services/zipUtils';
import type { ZipEntry } from './services/zipUtils';

const DEFAULT_BUCKET_NAME = 'product-photos';


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
  const [copied, setCopied] = useState(false);

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

  const [adminErrorMsg, setAdminErrorMsg] = useState<string | null>(null);
  const [adminSuccessMsg, setAdminSuccessMsg] = useState<string | null>(null);

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



  const copyOrigin = () => {
    navigator.clipboard.writeText(window.location.origin);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCaptureUPC = async (image: string) => {
    setProcessingMessage('IDENTIFICANDO PRODUCTO...');
    setState(prev => ({ ...prev, isProcessing: true, error: null, upcImage: image }));
    try {
      const upc = await geminiService.extractUPC(image, (attempt, delayMs) => {
        setProcessingMessage(`LÍMITE EXCEDIDO. REINTENTANDO (${attempt}/3) EN ${Math.round(delayMs / 1000)}s...`);
      });
      
      setProcessingMessage('VALIDANDO UPC CON BASE DE DATOS...');
      const validateRes = await fetch(`/api/products/validate/${upc}`).then(r => r.json());
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
      setState(prev => ({
        ...prev,
        error: err.message || "Error al leer el código.",
        isProcessing: false
      }));
    }
  };

  const handleCaptureProduct = async (image: string) => {
    setProcessingMessage('GENERANDO FOTO E-COMMERCE (FONDO BLANCO)...');
    setState(prev => ({ ...prev, isProcessing: true, error: null }));
    
    try {
      const studioImage = await geminiService.transformToStudioShot(image, (attempt, delayMs) => {
        setProcessingMessage(`LÍMITE EXCEDIDO. REINTENTANDO (${attempt}/3) EN ${Math.round(delayMs / 1000)}s...`);
      });
      
      setProcessingMessage('ESCALANDO PRODUCTO AL 95% Y AJUSTANDO A 1000x1000 px...');
      const finalResizedImage = await processAndResizeProductImage(studioImage);

      setState(prev => ({
        ...prev,
        productImage: finalResizedImage,
        step: AppStep.RECORD_AUDIO,
        isProcessing: false
      }));
    } catch (err: any) {
      setState(prev => ({
        ...prev,
        error: "Error en el estudio AI: " + (err.message || "Reintenta."),
        isProcessing: false
      }));
    }
  };

  const reset = () => {
    setState(prev => ({
      ...prev,
      step: AppStep.SCAN_UPC,
      upcCode: null,
      upcImage: null,
      productImage: null,
      audioBase64: null,
      transcription: null,
      productTitle: null,
      productDescription: null,
      isProcessing: false,
      error: null
    }));
    setUploadStatus('idle');
    setProcessingMessage('');
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
    setProcessingMessage('SUBIENDO IMAGEN A SUPABASE STORAGE...');
    setState(prev => ({ ...prev, isProcessing: true, error: null }));

    try {
      const file = base64ToFile(state.productImage, `${state.upcCode}.jpg`);
      const filePath = `${state.upcCode}_${Date.now()}.jpg`;
      
      // Subir archivo al bucket de Supabase Storage
      const { data: uploadRes, error: uploadErr } = await supabase.storage
        .from(DEFAULT_BUCKET_NAME)
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: true
        });

      if (uploadErr) throw uploadErr;

      setProcessingMessage('REGISTRANDO PRODUCTO Y FICHA DE AUDIO EN SUPABASE...');
      
      // Obtener URL pública de visualización
      const { data: { publicUrl } } = supabase.storage
        .from(DEFAULT_BUCKET_NAME)
        .getPublicUrl(filePath);

      // Insertar producto en la base de datos con información de audio y detalles
      const productPayload: any = {
        upc: state.upcCode,
        image_url: publicUrl,
        file_path: filePath,
        user_id: state.user?.id || null,
        user_name: state.user?.name || 'Usuario',
        title: state.productTitle || null,
        description: state.productDescription || null,
        transcription: state.transcription || null,
      };

      let { error: dbErr } = await supabase
        .from('products')
        .insert(productPayload);

      // Si las columnas nuevas de audio/detalles aún no existen en Supabase, reintentar sin ellas
      if (dbErr && (dbErr.code === '42703' || /title|description|transcription/i.test(dbErr.message || ''))) {
        console.warn("[saveToSupabase] Las columnas title/description/transcription no existen aún en la BDD. Guardando datos básicos.");
        delete productPayload.title;
        delete productPayload.description;
        delete productPayload.transcription;

        const { error: fallbackErr } = await supabase
          .from('products')
          .insert(productPayload);
          
        if (fallbackErr) throw fallbackErr;
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

  const handleDownload = () => {
    if (!state.productImage || !state.upcCode) return;
    const link = document.createElement('a');
    link.href = state.productImage;
    link.download = `${state.upcCode}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
        const { data: profileByName, error: nameErr } = await supabase
          .from('profiles')
          .select('email')
          .ilike('name', authEmail)
          .maybeSingle();

        if (nameErr) throw new Error("Error al buscar usuario: " + nameErr.message);
        if (!profileByName) {
          throw new Error(`No se encontró el usuario "${authEmail}". Verifica el nombre o usa tu correo completo.`);
        }
        authEmail = profileByName.email;
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
      const { data: profileData, error: profileErr } = await supabase
        .from('profiles')
        .select('role, name')
        .eq('id', authData.user.id)
        .maybeSingle();

      if (profileErr) throw new Error("Error al consultar perfiles: " + profileErr.message);
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
        const res = await fetch('/api/admin/products').then(r => r.json());
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
  const previewPhoto = previewIndex !== null ? previewList[previewIndex] : null;

  const openPreview = (photos: any[], photo: any) => {
    const idx = photos.findIndex(p => p.$id === photo.$id);
    setPreviewList(photos);
    setPreviewIndex(idx >= 0 ? idx : 0);
  };
  const closePreview = () => setPreviewIndex(null);
  const showPrev = () => setPreviewIndex(i => (i === null ? i : (i - 1 + previewList.length) % previewList.length));
  const showNext = () => setPreviewIndex(i => (i === null ? i : (i + 1) % previewList.length));

  const downloadSinglePhoto = async (photo: any) => {
    try {
      const response = await fetch(photo.imageUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${photo.upc || 'foto'}.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => window.URL.revokeObjectURL(url), 2000);
    } catch {
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

  /** Descarga en un solo .zip la lista de fotos que reciba. */
  const downloadPhotosAsZip = async (photos: any[], zipLabel: string) => {
    if (photos.length === 0) return;

    setIsAdminActionLoading(true);
    setAdminErrorMsg(null);
    setAdminSuccessMsg(null);

    try {
      const entries: ZipEntry[] = [];
      const used = new Set<string>();
      const failed: string[] = [];

      for (let i = 0; i < photos.length; i++) {
        const photo = photos[i];
        setZipProgress(`Descargando ${i + 1} de ${photos.length}...`);
        try {
          const response = await fetch(photo.imageUrl);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const buffer = await response.arrayBuffer();
          const ext = (photo.imageUrl || '').toLowerCase().includes('.png') ? 'png' : 'jpg';
          entries.push({
            name: uniqueName(`${photo.upc || 'sin-upc'}.${ext}`, used),
            data: new Uint8Array(buffer),
            date: photo.createdAt ? new Date(photo.createdAt) : new Date(),
          });
        } catch {
          failed.push(photo.upc || photo.$id);
        }
      }

      if (entries.length === 0) throw new Error("No se pudo descargar ninguna foto.");

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
          ? `ZIP generado con ${entries.length} fotos.`
          : `ZIP generado con ${entries.length} fotos. No se pudieron descargar ${failed.length}: ${failed.slice(0, 5).join(', ')}${failed.length > 5 ? '...' : ''}`
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

  // Derived states and handlers for Mass Actions
  const displayedPhotos = photosList.filter(p => {
    if (!filterStartDate && !filterEndDate) return true;
    const pDate = new Date(p.createdAt).toISOString().split('T')[0];
    if (filterStartDate && filterEndDate) return pDate >= filterStartDate && pDate <= filterEndDate;
    if (filterStartDate) return pDate >= filterStartDate;
    if (filterEndDate) return pDate <= filterEndDate;
    return true;
  });

  const toggleSelection = (id: string) => {
    const next = new Set(selectedPhotos);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedPhotos(next);
  };
  
  const toggleAll = () => {
    if (selectedPhotos.size === displayedPhotos.length && displayedPhotos.length > 0) {
      setSelectedPhotos(new Set());
    } else {
      setSelectedPhotos(new Set(displayedPhotos.map(p => p.$id)));
    }
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
          {/* Logo */}
          <div className="flex items-center gap-3 p-6 border-b border-white/60">
            <div className="bg-slate-900 p-2 rounded-full text-brand-navy">
              <Package size={20} />
            </div>
            <div>
              <p className="text-sm font-black text-slate-900 leading-none">Stevens Studio AI</p>
              <p className="text-[9px] text-slate-900 font-bold uppercase tracking-widest mt-0.5">Admin Panel</p>
            </div>
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
                    <div className="divide-y divide-slate-800">
                      {usersList.map((usr: any) => (
                        <div key={usr.$id} className="py-4 flex justify-between items-center first:pt-0 last:pb-0">
                          <div>
                            <p className="text-sm font-black text-slate-800">
                              {usr.name}
                              <span className={`ml-2 text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${usr.role === 'admin' ? 'bg-amber-900/35 border border-amber-500/20 text-slate-900' : 'bg-slate-800 border border-slate-200 text-slate-500'}`}>{usr.role}</span>
                            </p>
                            <p className="text-[10px] font-bold text-slate-500 font-mono mt-0.5">{usr.email}</p>
                          </div>
                          <button onClick={() => handleDeleteUser(usr.userId, usr.$id)}
                            disabled={usr.userId === state.user?.id}
                            className="p-2.5 bg-rose-50 border border-rose-200 text-rose-600 hover:bg-rose-900/25 rounded-full transition-all disabled:opacity-30 disabled:pointer-events-none"
                            title="Eliminar">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Sección: Catálogo Fotos ───────────────────────────── */}
          {adminSection === 'photos' && (
            <div className="p-4 md:p-8">
              <div className="glass-card border border-white/60 rounded-[32px] overflow-hidden">
                <div className="p-6 border-b border-white/60 flex flex-col gap-4 md:flex-row md:items-center justify-between">
                  <h3 className="text-xs font-black text-slate-600 uppercase tracking-wider">Fotos publicadas ({displayedPhotos.length})</h3>
                  
                  <div className="flex flex-wrap items-center gap-3">
                    {/* Size controls */}
                    <div className="flex glass-panel border border-white/60 rounded-full p-1">
                      <button onClick={() => setGridSize('small')} className={`p-1.5 rounded-full ${gridSize === 'small' ? 'bg-slate-800 text-slate-800' : 'text-slate-500 hover:text-slate-600'}`} title="Chico">S</button>
                      <button onClick={() => setGridSize('medium')} className={`p-1.5 rounded-full ${gridSize === 'medium' ? 'bg-slate-800 text-slate-800' : 'text-slate-500 hover:text-slate-600'}`} title="Mediano">M</button>
                      <button onClick={() => setGridSize('large')} className={`p-1.5 rounded-full ${gridSize === 'large' ? 'bg-slate-800 text-slate-800' : 'text-slate-500 hover:text-slate-600'}`} title="Grande">L</button>
                    </div>

                    <div className="h-6 w-px bg-slate-800 hidden md:block"></div>

                    {/* Date range filter */}
                    <div className="flex items-center gap-2 glass-panel border border-white/60 rounded-full px-2">
                      <input
                        type="date"
                        value={filterStartDate}
                        onChange={(e) => {
                          setFilterStartDate(e.target.value);
                          setSelectedPhotos(new Set());
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
                          setSelectedPhotos(new Set());
                        }}
                        className="px-2 py-2 bg-transparent text-[10px] sm:text-xs text-slate-600 font-mono outline-none"
                        title="Fecha Fin"
                      />
                    </div>
                    
                    {(filterStartDate || filterEndDate) && (
                      <button onClick={() => { setFilterStartDate(''); setFilterEndDate(''); setSelectedPhotos(new Set()); }} className="text-xs text-slate-500 hover:text-slate-600 font-bold">
                        Quitar Filtro
                      </button>
                    )}
                  </div>
                </div>

                {/* Mass Actions Bar */}
                {displayedPhotos.length > 0 && (
                  <div className="px-4 md:px-6 py-3 bg-white/50 backdrop-blur-md border-b border-white/60 flex flex-wrap items-center justify-between gap-2">
                    <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-600 hover:text-white">
                      <input 
                        type="checkbox" 
                        checked={selectedPhotos.size === displayedPhotos.length && displayedPhotos.length > 0} 
                        onChange={toggleAll}
                        className="w-4 h-4 rounded glass-panel border-slate-200 text-slate-900 focus:ring-slate-900 focus:ring-offset-brand-navy"
                      />
                      Seleccionar Todo ({selectedPhotos.size} / {displayedPhotos.length})
                    </label>

                    <div className="flex flex-wrap gap-2 items-center">
                      {zipProgress && (
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                          <Loader2 className="animate-spin" size={12} /> {zipProgress}
                        </span>
                      )}
                      <button 
                        onClick={() => handleDownloadAllZip(displayedPhotos)}
                        disabled={displayedPhotos.length === 0 || isAdminActionLoading}
                        className="px-3 py-1.5 bg-slate-900 border border-slate-900 text-white hover:bg-slate-800 rounded-full text-[10px] font-bold uppercase tracking-wider disabled:opacity-50 transition-all flex items-center gap-1"
                      >
                        <Download size={12} /> ZIP Todas ({displayedPhotos.length})
                      </button>
                      <button 
                        onClick={() => handleMassDownload(displayedPhotos)}
                        disabled={selectedPhotos.size === 0 || isAdminActionLoading}
                        className="px-3 py-1.5 bg-emerald-50 border border-emerald-200 text-emerald-600 hover:bg-emerald-100 rounded-full text-[10px] font-bold uppercase tracking-wider disabled:opacity-50 transition-all flex items-center gap-1"
                      >
                        <Download size={12} /> ZIP Selección ({selectedPhotos.size})
                      </button>
                      <button 
                        onClick={() => handleMassDelete(displayedPhotos)}
                        disabled={selectedPhotos.size === 0 || isAdminActionLoading}
                        className="px-3 py-1.5 bg-rose-50 border border-rose-200 text-rose-600 hover:bg-rose-100 rounded-full text-[10px] font-bold uppercase tracking-wider disabled:opacity-50 transition-all flex items-center gap-1"
                      >
                        Eliminar ({selectedPhotos.size})
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
                    <div className={`grid gap-4 ${
                      gridSize === 'small' ? 'grid-cols-3 sm:grid-cols-6 lg:grid-cols-8' : 
                      gridSize === 'medium' ? 'grid-cols-2 sm:grid-cols-4 lg:grid-cols-6' : 
                      'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
                    }`}>
                      {displayedPhotos.map((photo: any) => (
                        <div 
                          key={photo.$id} 
                          className={`glass-panel border rounded-[20px] overflow-hidden relative cursor-pointer transition-all ${
                            selectedPhotos.has(photo.$id) ? 'border-brand-gold ring-1 ring-slate-900' : 'border-white/60'
                          }`}
                          onClick={() => toggleSelection(photo.$id)}
                        >
                          <div className="absolute top-2 left-2 z-10 glass-card/80 p-1 rounded-full backdrop-blur-sm">
                            <input 
                              type="checkbox"
                              checked={selectedPhotos.has(photo.$id)}
                              onChange={() => toggleSelection(photo.$id)}
                              onClick={e => e.stopPropagation()}
                              className="w-4 h-4 rounded border-slate-200 text-slate-900"
                            />
                          </div>
                          
                          <div className="bg-white aspect-square flex items-center justify-center p-2">
                            <img src={photo.imageUrl} alt={photo.upc} className="w-full h-full object-contain" />
                          </div>
                          <div className="p-4">
                            <p className="text-sm font-mono font-black text-slate-800">{photo.upc}</p>
                            <p className="text-[9px] font-bold text-slate-500 uppercase tracking-tight mt-1">
                              {photo.userName || 'Anónimo'} · {new Date(photo.createdAt || '').toLocaleDateString()}
                            </p>
                            <div className="flex gap-2 mt-3">
                              <button type="button"
                                onClick={e => { e.stopPropagation(); openPreview(displayedPhotos, photo); }}
                                className="flex-1 flex items-center justify-center gap-1 py-1.5 glass-card border border-slate-200 text-slate-500 hover:text-slate-900 rounded-full text-[10px] font-bold transition-all">
                                <ExternalLink size={12} /> Ver
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
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
                    
                    <div className="glass-card p-4 rounded-[20px] border border-white/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="p-3 bg-emerald-100 text-emerald-700 rounded-full">
                          <FileText size={20} />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-slate-800">Subir archivo CSV o TXT</p>
                          <p className="text-[10px] text-slate-500">Recomendado para 350,000+ códigos</p>
                        </div>
                      </div>
                      <input 
                        type="file" 
                        id="upcMassFile" 
                        accept=".txt,.csv" 
                        className="text-xs max-w-full file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-bold file:bg-slate-900 file:text-white hover:file:bg-slate-800 cursor-pointer"
                      />
                    </div>

                    <div className="text-center text-xs text-slate-400 font-bold uppercase tracking-widest">O pega manualmente:</div>

                    <textarea 
                      id="upcMassInput"
                      placeholder="Pega aquí los UPCs separados por coma, espacio o salto de línea..."
                      className="w-full h-32 glass-input px-4 py-3 rounded-[20px] text-xs text-slate-700 font-mono focus:border-slate-900 outline-none resize-none"
                    ></textarea>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-4">
                    <button 
                                            onClick={async () => {
                        const fileInput = document.getElementById('upcMassFile') as HTMLInputElement;
                        const textInput = document.getElementById('upcMassInput') as HTMLTextAreaElement;
                        let val = textInput.value;
                        
                        if (fileInput.files && fileInput.files.length > 0) {
                          const file = fileInput.files[0];
                          try {
                            val = await file.text();
                          } catch (e) {
                            return alert("Error al leer el archivo.");
                          }
                        }

                        const upcs = val.split(/[\s,]+/).filter(u => u.trim().length > 0);
                        if(upcs.length === 0) return alert('No hay UPCs para subir. Selecciona un archivo o pega el texto.');
                        if(!confirm('¿Subir ' + upcs.length + ' códigos al inventario? Esto puede tomar un minuto si son cientos de miles.')) return;
                        
                        setIsAdminActionLoading(true);
                        try {
                          const res = await fetch('/api/admin/upload-upcs', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ upcs })
                          });
                          const json = await res.json();
                          if(!res.ok) throw new Error(json.error || 'Error subiendo UPCs');
                          setAdminSuccessMsg(json.message);
                          if (typeof json.count === 'number') setUpcsCount(json.count);
                          else loadUpcsCount();
                          textInput.value = '';
                          if(fileInput) fileInput.value = '';
                        } catch(err: any) {
                          setAdminErrorMsg(err.message);
                        } finally {
                          setIsAdminActionLoading(false);
                        }
                      }}
                      disabled={isAdminActionLoading}
                      className="w-full sm:w-auto px-6 py-3 bg-slate-900 text-white rounded-full text-xs font-bold hover:bg-slate-800 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {isAdminActionLoading ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />}
                      Subir Códigos al Inventario
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
                  <p className="text-sm font-mono font-black text-slate-800 truncate">{previewPhoto.upc}</p>
                  <p className="text-[9px] font-bold text-slate-500 uppercase tracking-tight">
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

              {/* Imagen */}
              <div className="relative flex-1 min-h-0 bg-white flex items-center justify-center p-4">
                <img
                  src={previewPhoto.imageUrl}
                  alt={previewPhoto.upc}
                  className="max-w-full max-h-[68vh] object-contain"
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

              {/* Acciones */}
              <div className="flex gap-2 px-5 py-3 border-t border-white/60 bg-white/60">
                <button
                  type="button"
                  onClick={() => downloadSinglePhoto(previewPhoto)}
                  className="flex items-center justify-center gap-1 px-4 py-2 bg-slate-900 text-white rounded-full text-[10px] font-bold uppercase tracking-wider hover:bg-slate-800 transition-all"
                >
                  <Download size={12} /> Descargar
                </button>
                <a
                  href={previewPhoto.imageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-center gap-1 px-4 py-2 glass-card border border-slate-200 text-slate-600 hover:text-slate-900 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all"
                >
                  <ExternalLink size={12} /> Abrir original
                </a>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── RENDER: Operador + pantalla de login ──────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col items-center p-4 md:p-8 font-sans relative z-0">
      <div className="absolute inset-0 z-[-1] glass-panel opacity-95"></div>
      <header className="w-full max-w-4xl mb-8 flex items-center justify-between glass-card/90 p-4 rounded-3xl shadow-xl shadow-black/40 border border-white/60/80 ring-1 ring-slate-900/15 backdrop-blur-md">
        <div className="flex items-center gap-4">
          <div className="bg-slate-900 p-2.5 rounded-[20px] shadow-lg shadow-slate-900/10 text-brand-navy">
            <Package size={24} />
          </div>
          <div className="hidden sm:block">
            <h1 className="text-xl font-black text-slate-900 tracking-tight leading-none font-display">Stevens Studio AI</h1>
            <p className="text-[10px] text-slate-900-light/90 font-bold uppercase tracking-widest mt-1.5 flex items-center gap-1">
              <Zap size={10} className="text-slate-900 animate-pulse" /> Catalogación de Productos
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {state.user && (
            <div className="flex items-center gap-3 glass-panel border border-white/60 px-3 py-1.5 rounded-[20px]">
              <div className="text-right hidden md:block">
                <p className="text-[10px] font-black text-slate-900 leading-none">{state.user.name}</p>
                <p className="text-[8px] font-bold text-slate-500 uppercase tracking-tighter">{state.user.email}</p>
              </div>
              <div className="w-8 h-8 rounded-full glass-card border border-white/60 shadow-sm flex items-center justify-center text-slate-900">
                <UserIcon size={16} />
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
              className="px-4 py-2 bg-slate-900/10 hover:bg-slate-900/25 border border-brand-gold/20 text-slate-900 font-bold text-xs uppercase tracking-wider rounded-[20px] transition-all"
            >
              {state.step === AppStep.ADMIN_DASHBOARD ? 'Modo Escáner' : 'Panel Admin'}
            </button>
          )}
          <div className="flex gap-1.5">
            {state.user && (
              <button onClick={logout} className="p-2.5 rounded-[20px] glass-panel text-slate-500 hover:text-red-400 border border-white/60 transition-all">
                <LogOut size={20} />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Steps indicator */}
      {[AppStep.SCAN_UPC, AppStep.PRODUCT_PHOTO, AppStep.RECORD_AUDIO, AppStep.REVIEW].includes(state.step) && (
        <div className="w-full max-w-lg mb-8 flex items-center justify-between relative px-2 animate-in fade-in duration-300">
          <div className="absolute top-1/2 left-0 w-full h-0.5 bg-slate-800 -z-10 -translate-y-1/2" />
          {[1, 2, 3, 4].map((s) => {
            const currentStep = state.step === AppStep.SCAN_UPC ? 1 
              : state.step === AppStep.PRODUCT_PHOTO ? 2 
              : state.step === AppStep.RECORD_AUDIO ? 3 
              : 4;
            const isActive = currentStep >= s;
            const isCurrent = currentStep === s;
            return (
              <div key={s} className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-black border-4 transition-all duration-500 ${isCurrent ? 'bg-slate-900 border-brand-gold-light text-brand-navy scale-125 shadow-xl shadow-slate-900/10' : isActive ? 'bg-slate-900-dark border-brand-gold text-brand-navy' : 'glass-card border-white/60 text-slate-500'}`}>
                {isActive && s < currentStep ? <CheckCircle size={16} /> : s}
              </div>
            );
          })}
        </div>
      )}

      <main className="w-full max-w-2xl glass-card/95 rounded-[3rem] shadow-2xl shadow-black/60 border border-white/60/80 p-6 md:p-10 min-h-[550px] flex flex-col items-center relative overflow-hidden ring-1 ring-slate-900/10 backdrop-blur-md">
        {state.isProcessing && (
          <div className="absolute inset-0 glass-panel/95 backdrop-blur-2xl z-50 flex flex-col items-center justify-center animate-in fade-in duration-300 px-8 text-center">
            <div className="relative mb-10">
              <Loader2 className="animate-spin text-slate-900" size={80} strokeWidth={3} />
              <div className="absolute inset-0 flex items-center justify-center">
                <Sparkles size={24} className="text-slate-900-light animate-pulse" />
              </div>
            </div>
            <h3 className="text-2xl font-black text-slate-900 tracking-tight uppercase mb-2 font-display">{processingMessage}</h3>
            <p className="text-[10px] text-slate-900 font-bold uppercase tracking-[0.25em]">IA Optimizando para Stevens.com.pa</p>
          </div>
        )}

        {state.error && state.error.startsWith('DUPLICATE_UPC:') ? (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="bg-white rounded-[32px] p-8 max-w-sm w-full flex flex-col items-center text-center shadow-2xl animate-in zoom-in-95 duration-300">
              <div className="w-24 h-24 bg-red-100 rounded-full flex items-center justify-center mb-6">
                <AlertCircle size={48} className="text-red-600" />
              </div>
              <h2 className="text-2xl font-black text-slate-900 mb-2">¡ALTO AHÍ!</h2>
              <p className="text-sm text-slate-600 mb-6 font-medium">
                Este producto <span className="font-bold text-slate-900">(UPC: {state.error.split(':')[1]})</span> ya está publicado en la base de datos.<br/><br/>
                Para evitar trabajo doble, <b>NO</b> debes fotografiarlo.
              </p>
              <button 
                onClick={() => setState(prev => ({ ...prev, error: null, step: AppStep.SCAN_UPC, upcImage: null }))} 
                className="w-full bg-slate-900 text-white font-bold py-4 rounded-full hover:bg-slate-800 transition-colors"
              >
                Entendido, escanear otro
              </button>
            </div>
          </div>
        ) : state.error ? (
          <div className="w-full mb-8 p-6 bg-rose-50 border border-rose-200 rounded-3xl flex gap-4 items-center text-rose-800 animate-in zoom-in duration-300 shadow-sm">
            <AlertCircle size={32} className="shrink-0 text-rose-600" />
            <div className="flex-1">
              <p className="text-[10px] font-black uppercase mb-1 tracking-widest text-rose-600">Error</p>
              <p className="text-sm font-bold leading-tight">{state.error}</p>
            </div>
            <button onClick={() => setState(prev => ({ ...prev, error: null }))} className="glass-panel p-2 rounded-full border border-white/60 text-slate-700">
              <X size={16} />
            </button>
          </div>
        ) : null}

        {/* Login */}
        {state.step === AppStep.LOGIN && (
          <div className="w-full max-w-md flex flex-col items-center animate-in fade-in duration-300">
            <div className="text-center mb-8">
              <div className="glass-card w-16 h-16 rounded-3xl flex items-center justify-center mx-auto mb-4 border border-brand-gold/20 shadow-lg">
                <Lock className="text-slate-900" size={32} />
              </div>
              <h2 className="text-2xl font-black text-slate-900 tracking-tight uppercase font-display">Inicio de Sesión</h2>
              <p className="text-slate-500 font-medium text-xs mt-2">Ingresa tus credenciales de Stevens Studio AI</p>
            </div>
            <form onSubmit={handleLogin} className="w-full space-y-4">
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase mb-2 block tracking-widest">Usuario o Correo</label>
                <input type="text" value={loginEmail} onChange={e => setLoginEmail(e.target.value)}
                  placeholder="Admin  o  usuario@correo.com"
                  className="w-full px-5 py-3.5 glass-panel border border-white/60 rounded-[20px] text-sm focus:border-brand-gold outline-none transition-all text-slate-50" required />
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase mb-2 block tracking-widest">Contraseña</label>
                <input type="password" value={loginPassword} onChange={e => setLoginPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-5 py-3.5 glass-panel border border-white/60 rounded-[20px] text-sm focus:border-brand-gold outline-none transition-all text-slate-50" required />
              </div>
              <button type="submit"
                className="w-full py-4 mt-4 bg-slate-900 text-brand-navy font-black rounded-[20px] hover:bg-slate-900-light transition-all active:scale-95 uppercase tracking-widest text-xs shadow-lg shadow-brand-gold/15">
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
            <Camera onCapture={handleCaptureUPC} label="ESCÁNER UPC ACTIVO" mode="upc" />
          </div>
        )}

        {/* Paso 2: Product Photo */}
        {state.step === AppStep.PRODUCT_PHOTO && (
          <div className="w-full flex flex-col items-center animate-in fade-in slide-in-from-bottom-6 duration-500">
            <div className="w-full flex items-center justify-between mb-8">
              <button onClick={() => setState(prev => ({ ...prev, step: AppStep.SCAN_UPC }))} className="p-3 hover:glass-panel rounded-[20px] transition-all text-slate-500"><ArrowLeft size={22} /></button>
              <div className="text-center">
                <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tight font-display">Paso 2: Foto de Estudio</h2>
                <div className="mt-1 flex items-center justify-center gap-2">
                  <span className="text-slate-900 font-mono font-black text-[10px] bg-slate-900/10 px-3 py-1 rounded-full border border-brand-gold/30">UPC: {state.upcCode}</span>
                </div>
              </div>
              <div className="w-10" />
            </div>
            <Camera onCapture={handleCaptureProduct} label="FOTO DE PRODUCTO (FONDO BLANCO IA)" mode="product" />
            <p className="mt-6 text-[10px] text-slate-500 font-black uppercase tracking-widest text-center">Fondo Blanco Puro • Sin Sombras • Remoción Automática IA</p>
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
              initialTitle={state.productTitle}
              initialDescription={state.productDescription}
              initialTranscription={state.transcription}
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
              {/* VISTA PREVIA IMAGEN */}
              <div className="flex flex-col items-center">
                <div className="relative w-full aspect-square bg-slate-900 rounded-[2rem] overflow-hidden border-4 border-slate-800 shadow-2xl p-3 bg-white">
                  <img src={state.productImage} alt="Clean Product" className="w-full h-full object-contain" />
                </div>
                <div className="mt-3 text-center">
                  <span className="text-[10px] font-mono font-bold text-slate-400 bg-slate-900 px-3 py-1 rounded-full border border-slate-800">
                    {state.upcCode}.jpg
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
                    <p className="text-slate-300 text-xs mt-1">La foto optimizada y la ficha descriptiva fueron registradas en Supabase.</p>
                  </div>
                  <button onClick={reset} className="px-8 py-4 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-2xl font-bold transition-all shadow-lg active:scale-95 uppercase text-xs tracking-widest mt-2">
                    Siguiente Producto
                  </button>
                </div>
              ) : (
                <>
                  <button onClick={saveToSupabase} disabled={uploadStatus === 'uploading'}
                    className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-black py-5 rounded-2xl flex items-center justify-center gap-3 shadow-xl shadow-amber-500/20 transition-all active:scale-95 disabled:opacity-50">
                    <Cloud size={24} />
                    <span className="text-base uppercase tracking-wider font-display">Guardar en Supabase</span>
                  </button>
                  <div className="grid grid-cols-2 gap-4">
                    <button onClick={handleDownload} className="glass-panel border border-white/60 text-slate-900 hover:text-slate-900 font-bold py-3.5 rounded-xl flex items-center justify-center gap-2 uppercase text-[10px] tracking-widest hover:bg-slate-800/60 shadow-sm"><Download size={16} /> Descargar Imagen</button>
                    <button onClick={reset} className="glass-panel border border-white/60 text-slate-500 font-bold py-3.5 rounded-xl flex items-center justify-center gap-2 uppercase text-[10px] tracking-widest hover:bg-slate-800/60 shadow-sm">Cancelar</button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </main>

      <footer className="mt-auto pt-12 pb-8 text-slate-500 text-[10px] font-black uppercase tracking-[0.3em] flex flex-col items-center gap-4">
        <div className="flex items-center gap-6 glass-card/90 px-8 py-3 rounded-full border border-white/60/80 shadow-md">
          <span className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-slate-900 animate-pulse"/> GEMINI 2.5 PRO ENGINE</span>
          <div className="w-px h-4 bg-slate-800"/>
          <span className="flex items-center gap-2"><Sparkles size={14} className="text-slate-900"/> STEVENS ECOMMERCE STUDIO</span>
        </div>
        <p className="opacity-40">Stevens Panamá &copy; 2026 • Supabase Cloud Secure</p>
      </footer>
    </div>
  );
};

export default App;





