import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Camera as CameraIcon, RotateCw, AlertTriangle, Upload, RefreshCw, Grid, Zap } from 'lucide-react';

interface CameraProps {
  onCapture: (base64Image: string) => void;
  label: string;
  mode?: 'upc' | 'product';
}

const Camera: React.FC<CameraProps> = ({ onCapture, label, mode = 'product' }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [isFlashing, setIsFlashing] = useState<boolean>(false);

  const startCamera = useCallback(async (facing: 'environment' | 'user' = facingMode) => {
    try {
      setError(null);
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      const newStream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          facingMode: facing,
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false 
      });
      setStream(newStream);
      if (videoRef.current) {
        videoRef.current.srcObject = newStream;
      }
    } catch (err: any) {
      console.error("Error accessing camera:", err);
      setError("No se pudo acceder a la cámara. Revisa los permisos o sube una imagen directamente.");
    }
  }, [facingMode, stream]);

  useEffect(() => {
    startCamera(facingMode);
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facingMode]);

  const toggleCameraFacing = () => {
    const nextFacing = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(nextFacing);
  };

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      // Shutter flash effect
      setIsFlashing(true);
      setTimeout(() => setIsFlashing(false), 200);

      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.90);
        onCapture(dataUrl);
      }
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        onCapture(event.target.result as string);
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="w-full max-w-2xl mx-auto flex flex-col items-center">
      {/* Container Principal Estilo App Móvil Nativa */}
      <div className="relative w-full aspect-[3/4] sm:aspect-[4/3] bg-slate-950 rounded-3xl overflow-hidden shadow-2xl border border-slate-800/80 group">
        
        {/* EFECTO FLASH SHUTTER */}
        {isFlashing && (
          <div className="absolute inset-0 bg-white z-50 animate-pulse pointer-events-none" />
        )}

        {error ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-300 p-8 text-center bg-slate-900/90 backdrop-blur-xl">
            <div className="bg-red-500/10 text-red-400 p-5 rounded-2xl mb-4 border border-red-500/20">
              <AlertTriangle size={36} />
            </div>
            <p className="font-bold text-red-400 text-sm uppercase tracking-wider mb-2">Cámara No Disponible</p>
            <p className="text-slate-400 text-xs max-w-xs mb-6 leading-relaxed">{error}</p>
            
            <div className="flex flex-col sm:flex-row gap-3 w-full max-w-xs">
              <button 
                onClick={() => startCamera(facingMode)}
                className="flex-1 px-4 py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold text-xs uppercase tracking-wider rounded-xl flex items-center justify-center gap-2 transition-all active:scale-95"
              >
                <RotateCw size={16} className="text-amber-400" /> Reintentar
              </button>
              
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 px-4 py-3 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs uppercase tracking-wider rounded-xl flex items-center justify-center gap-2 transition-all active:scale-95 shadow-lg shadow-amber-500/20"
              >
                <Upload size={16} /> Subir Imagen
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* VISTA DE VIDEO EN TIEMPO REAL */}
            <video 
              ref={videoRef} 
              autoPlay 
              playsInline 
              className="w-full h-full object-cover"
            />

            {/* SUPERPOSICIÓN DE GRILLA GUÍA (Si está activa) */}
            {showGrid && (
              <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none opacity-20">
                <div className="border-r border-b border-white"></div>
                <div className="border-r border-b border-white"></div>
                <div className="border-b border-white"></div>
                <div className="border-r border-b border-white"></div>
                <div className="border-r border-b border-white"></div>
                <div className="border-b border-white"></div>
                <div className="border-r border-white"></div>
                <div className="border-r border-white"></div>
                <div></div>
              </div>
            )}

            {/* MARCO Y VISOR ENCUADRE SEGÚN EL MODO */}
            {mode === 'upc' ? (
              // Visor Estilo Escáner de Código de Barras
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none p-8">
                <div className="w-full max-w-xs h-40 border-2 border-amber-400/80 rounded-2xl relative bg-black/10 backdrop-blur-[1px] shadow-[0_0_50px_rgba(251,191,36,0.15)] flex items-center justify-center overflow-hidden">
                  {/* Láser de Escáner Animado */}
                  <div className="w-full h-0.5 bg-gradient-to-r from-transparent via-amber-400 to-transparent shadow-[0_0_15px_#f59e0b] animate-[bounce_2s_infinite]" />
                  {/* Esquinas del Escáner */}
                  <div className="absolute top-2 left-2 w-4 h-4 border-t-2 border-l-2 border-amber-400" />
                  <div className="absolute top-2 right-2 w-4 h-4 border-t-2 border-r-2 border-amber-400" />
                  <div className="absolute bottom-2 left-2 w-4 h-4 border-b-2 border-l-2 border-amber-400" />
                  <div className="absolute bottom-2 right-2 w-4 h-4 border-b-2 border-r-2 border-amber-400" />
                </div>
              </div>
            ) : (
              // Visor Estilo Foto de Producto de Estudio
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none p-6">
                <div className="w-full h-full border-2 border-dashed border-white/40 rounded-2xl relative flex items-center justify-center">
                  <div className="w-12 h-12 border-t-2 border-l-2 border-white/60 absolute top-4 left-4 rounded-tl-lg" />
                  <div className="w-12 h-12 border-t-2 border-r-2 border-white/60 absolute top-4 right-4 rounded-tr-lg" />
                  <div className="w-12 h-12 border-b-2 border-l-2 border-white/60 absolute bottom-4 left-4 rounded-bl-lg" />
                  <div className="w-12 h-12 border-b-2 border-r-2 border-white/60 absolute bottom-4 right-4 rounded-br-lg" />
                  <div className="text-white/30 text-xs uppercase tracking-widest font-mono">Encuadre Producto</div>
                </div>
              </div>
            )}

            {/* CONTROL SUPERIOR FLOTANTE */}
            <div className="absolute top-4 left-4 right-4 flex items-center justify-between pointer-events-auto">
              <span className="bg-slate-900/80 backdrop-blur-md text-amber-400 border border-amber-500/20 px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider shadow-lg flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                {label}
              </span>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowGrid(!showGrid)}
                  className={`p-2.5 rounded-full backdrop-blur-md border transition-all ${
                    showGrid ? 'bg-amber-400 text-slate-950 border-amber-300' : 'bg-slate-900/80 text-white border-slate-700'
                  }`}
                  title="Conmutar grilla de encuadre"
                >
                  <Grid size={16} />
                </button>

                <button
                  type="button"
                  onClick={toggleCameraFacing}
                  className="p-2.5 rounded-full bg-slate-900/80 hover:bg-slate-800 text-white border border-slate-700 backdrop-blur-md transition-all active:scale-95"
                  title="Cambiar cámara"
                >
                  <RefreshCw size={16} />
                </button>
              </div>
            </div>

            {/* MENSAJE DE INDICACIÓN EN LA PARTE INFERIOR DE LA CÁMARA */}
            <div className="absolute bottom-4 left-4 right-4 text-center pointer-events-none">
              <p className="bg-slate-950/70 text-slate-300 text-xs px-4 py-1.5 rounded-full inline-block backdrop-blur-md border border-slate-800 shadow-md">
                {mode === 'upc' 
                  ? 'Coloque el código de barras dentro del marco para capturar' 
                  : 'Centre el producto en una superficie bien iluminada'
                }
              </p>
            </div>
          </>
        )}
      </div>
      
      <canvas ref={canvasRef} className="hidden" />
      <input 
        ref={fileInputRef}
        type="file" 
        accept="image/*" 
        className="hidden"
        onChange={handleFileUpload}
      />

      {/* BARRA DE BOTONES DE ACCIÓN (DISPARADOR & GALERÍA) */}
      <div className="mt-6 flex items-center justify-center gap-8 w-full max-w-xs">
        {/* Botón Galería/Subir */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="p-4 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 rounded-2xl shadow-lg active:scale-95 transition-all flex flex-col items-center gap-1 group"
          title="Subir desde la galería"
        >
          <Upload size={20} className="group-hover:text-amber-400 transition-colors" />
          <span className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">Subir</span>
        </button>

        {/* BOTÓN SHUTTER DE DISPARO */}
        <button
          type="button"
          onClick={capturePhoto}
          disabled={!!error || !stream}
          className="w-20 h-20 bg-slate-900 border-4 border-amber-500/30 rounded-full flex items-center justify-center shadow-2xl active:scale-90 transition-all disabled:opacity-30 disabled:pointer-events-none group"
          title="Capturar Foto"
        >
          <div className="w-14 h-14 bg-amber-400 group-hover:bg-amber-300 rounded-full flex items-center justify-center text-slate-950 shadow-lg shadow-amber-400/30 group-hover:scale-105 transition-all">
            <CameraIcon size={28} />
          </div>
        </button>

        {/* Botón Cambiar Cámara */}
        <button
          type="button"
          onClick={toggleCameraFacing}
          disabled={!!error || !stream}
          className="p-4 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 rounded-2xl shadow-lg active:scale-95 transition-all flex flex-col items-center gap-1 group disabled:opacity-30"
          title="Rotar cámara"
        >
          <RefreshCw size={20} className="group-hover:text-amber-400 transition-colors" />
          <span className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">Girar</span>
        </button>
      </div>
    </div>
  );
};

export default Camera;
