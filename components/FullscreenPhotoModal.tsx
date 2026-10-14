import React, { useState, useEffect, useRef } from 'react';
import { 
  X, 
  ZoomIn, 
  ZoomOut, 
  RotateCcw, 
  CheckCircle2, 
  RefreshCw, 
  Maximize2, 
  Sliders, 
  Sparkles,
  Grid
} from 'lucide-react';

interface FullscreenPhotoModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string | null;
  upcCode?: string | null;
  title?: string | null;
  onApprove?: () => void;
  onRetake?: () => void;
  showApprovalControls?: boolean;
}

export const FullscreenPhotoModal: React.FC<FullscreenPhotoModalProps> = ({
  isOpen,
  onClose,
  imageUrl,
  upcCode,
  title,
  onApprove,
  onRetake,
  showApprovalControls = false,
}) => {
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [bgMode, setBgMode] = useState<'white' | 'checker' | 'dark'>('white');
  const [showGuidelines, setShowGuidelines] = useState<boolean>(true);
  const [panPosition, setPanPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Reset controls when modal opens
  useEffect(() => {
    if (isOpen) {
      setZoomLevel(1);
      setPanPosition({ x: 0, y: 0 });
    }
  }, [isOpen, imageUrl]);

  // Keyboard navigation (Escape to close, +/- zoom)
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === '+' || e.key === '=') {
        setZoomLevel((prev) => Math.min(prev + 0.25, 3));
      } else if (e.key === '-') {
        setZoomLevel((prev) => {
          const next = Math.max(prev - 0.25, 1);
          if (next === 1) setPanPosition({ x: 0, y: 0 });
          return next;
        });
      } else if (e.key === '0') {
        setZoomLevel(1);
        setPanPosition({ x: 0, y: 0 });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !imageUrl) return null;

  const handleZoomIn = () => setZoomLevel((prev) => Math.min(prev + 0.5, 3));
  const handleZoomOut = () => {
    setZoomLevel((prev) => {
      const next = Math.max(prev - 0.5, 1);
      if (next === 1) setPanPosition({ x: 0, y: 0 });
      return next;
    });
  };
  const handleResetZoom = () => {
    setZoomLevel(1);
    setPanPosition({ x: 0, y: 0 });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoomLevel <= 1) return;
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX - panPosition.x, y: e.clientY - panPosition.y };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || zoomLevel <= 1) return;
    setPanPosition({
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y
    });
  };

  const handleMouseUp = () => setIsDragging(false);

  return (
    <div 
      className="fixed inset-0 z-[120] bg-slate-950/95 backdrop-blur-2xl flex flex-col select-none animate-in fade-in duration-200"
      onMouseUp={handleMouseUp}
    >
      {/* BARRA SUPERIOR: INFORMACIÓN Y HERRAMIENTAS */}
      <header className="px-4 py-3 sm:px-6 bg-slate-900/90 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 text-white z-20">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <Maximize2 size={18} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-black tracking-wide uppercase font-display text-white">
                Inspección de Foto de Estudio
              </h3>
              {upcCode && (
                <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700 text-amber-400">
                  UPC: {upcCode}
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400 font-medium">
              Verifica el estándar Stevens: Fondo blanco puro • 1000x1000 px • Centrado 80%
            </p>
          </div>
        </div>

        {/* HERRAMIENTAS DE INSPECCIÓN: ZOOM, FONDOS Y GUÍAS */}
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          {/* Selector de Fondo */}
          <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 text-[11px] font-bold">
            <button
              type="button"
              onClick={() => setBgMode('white')}
              className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1.5 ${
                bgMode === 'white' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
              title="Fondo Blanco Estándar de Tienda"
            >
              <span className="w-2.5 h-2.5 rounded-full bg-white border border-slate-300" />
              Blanco
            </button>
            <button
              type="button"
              onClick={() => setBgMode('checker')}
              className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1.5 ${
                bgMode === 'checker' ? 'bg-amber-500 text-slate-950 shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
              title="Cuadrícula para revisar recorte y bordes transparentes"
            >
              <Grid size={12} />
              Bordes
            </button>
            <button
              type="button"
              onClick={() => setBgMode('dark')}
              className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1.5 ${
                bgMode === 'dark' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
              title="Fondo Oscuro para contrastar contornos claros"
            >
              <span className="w-2.5 h-2.5 rounded-full bg-slate-800 border border-slate-600" />
              Contraste
            </button>
          </div>

          {/* Toggle Guía 80% */}
          <button
            type="button"
            onClick={() => setShowGuidelines(prev => !prev)}
            className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-bold transition-all flex items-center gap-1.5 ${
              showGuidelines 
                ? 'bg-amber-500/20 border-amber-500/50 text-amber-300' 
                : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
            }`}
            title="Activar/desactivar zona segura de encuadre 80%"
          >
            <Sliders size={13} />
            Guía 80%
          </button>

          {/* Controles de Zoom */}
          <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 text-slate-300">
            <button
              type="button"
              onClick={handleZoomOut}
              disabled={zoomLevel <= 1}
              className="p-1.5 hover:bg-slate-800 disabled:opacity-40 rounded-lg transition-colors"
              title="Alejar (-)"
            >
              <ZoomOut size={15} />
            </button>
            <span className="text-[11px] font-mono font-bold px-2 text-amber-400 min-w-[42px] text-center">
              {Math.round(zoomLevel * 100)}%
            </span>
            <button
              type="button"
              onClick={handleZoomIn}
              disabled={zoomLevel >= 3}
              className="p-1.5 hover:bg-slate-800 disabled:opacity-40 rounded-lg transition-colors"
              title="Acercar (+)"
            >
              <ZoomIn size={15} />
            </button>
            {zoomLevel > 1 && (
              <button
                type="button"
                onClick={handleResetZoom}
                className="p-1.5 hover:bg-slate-800 rounded-lg transition-colors text-slate-400 hover:text-white border-l border-slate-800 ml-1"
                title="Restablecer 100% (0)"
              >
                <RotateCcw size={13} />
              </button>
            )}
          </div>

          {/* Cerrar Visor */}
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
            title="Cerrar pantalla completa (Esc)"
          >
            <X size={18} />
          </button>
        </div>
      </header>

      {/* ÁREA CENTRAL: LIENZO DE FOTO A PANTALLA COMPLETA */}
      <div 
        className="flex-1 flex items-center justify-center overflow-hidden p-3 sm:p-6 relative cursor-default"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
      >
        {/* Contenedor Cuadrado con el fondo seleccionado */}
        <div 
          className={`relative max-h-[82vh] max-w-[82vh] aspect-square rounded-2xl shadow-2xl overflow-hidden border-2 transition-colors flex items-center justify-center ${
            bgMode === 'white' 
              ? 'bg-white border-slate-200' 
              : bgMode === 'dark' 
              ? 'bg-slate-900 border-slate-700' 
              : 'border-slate-600'
          }`}
          style={
            bgMode === 'checker' ? {
              backgroundColor: '#f8fafc',
              backgroundImage: 'linear-gradient(45deg, #cbd5e1 25%, transparent 25%), linear-gradient(-45deg, #cbd5e1 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #cbd5e1 75%), linear-gradient(-45deg, transparent 75%, #cbd5e1 75%)',
              backgroundSize: '20px 20px',
              backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px'
            } : undefined
          }
        >
          {/* IMAGEN DEL PRODUCTO CON ZOOM Y PAN */}
          <img
            src={imageUrl}
            alt={title || upcCode || 'Foto de estudio producto'}
            draggable={false}
            className={`w-full h-full object-contain transition-transform duration-100 ease-out ${
              zoomLevel > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in'
            }`}
            style={{
              transform: `scale(${zoomLevel}) translate(${panPosition.x / zoomLevel}px, ${panPosition.y / zoomLevel}px)`
            }}
            onClick={() => {
              if (zoomLevel === 1) handleZoomIn();
            }}
          />

          {/* GUÍA DE ENCUADRE AL 80% (ESTÁNDAR STEVENS) */}
          {showGuidelines && (
            <div 
              className="absolute inset-[10%] border-2 border-dashed border-amber-500/60 pointer-events-none rounded-xl flex items-start justify-end p-2 z-10"
              title="Zona del 80%: El producto debe ocupar aproximadamente esta área sin tocar los bordes"
            >
              <span className="bg-amber-500 text-slate-950 text-[9px] font-black uppercase px-2 py-0.5 rounded-full shadow-sm tracking-wider">
                Zona 80% Estándar
              </span>
            </div>
          )}

          {/* Insignia de Dimensiones */}
          <div className="absolute bottom-3 left-3 bg-slate-950/80 backdrop-blur-md border border-slate-700 text-white px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold pointer-events-none z-10">
            1000 × 1000 px
          </div>
        </div>
      </div>

      {/* BARRA INFERIOR: CHECKLIST DE ESTÁNDARES Y ACCIONES DE APROBACIÓN */}
      <footer className="px-4 py-3 sm:px-6 bg-slate-900/95 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3 z-20">
        {/* Checklist de Estándares */}
        <div className="flex items-center gap-2 sm:gap-4 text-xs font-semibold text-slate-300 flex-wrap">
          <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">
            Criterios de Aceptación:
          </span>
          <span className="inline-flex items-center gap-1.5 text-emerald-400 text-xs">
            <CheckCircle2 size={14} /> Fondo Blanco Puro
          </span>
          <span className="inline-flex items-center gap-1.5 text-emerald-400 text-xs">
            <CheckCircle2 size={14} /> 1000×1000 px
          </span>
          <span className="inline-flex items-center gap-1.5 text-emerald-400 text-xs">
            <CheckCircle2 size={14} /> Centrado ≥80%
          </span>
          <span className="inline-flex items-center gap-1.5 text-emerald-400 text-xs">
            <CheckCircle2 size={14} /> Bordes Nítidos
          </span>
        </div>

        {/* Botones de Acción */}
        <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
          {showApprovalControls ? (
            <>
              {onRetake && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onRetake();
                  }}
                  className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer border border-slate-700"
                >
                  <RefreshCw size={14} className="text-amber-400" />
                  Volver a Tomar
                </button>
              )}
              {onApprove && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onApprove();
                  }}
                  className="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black rounded-xl text-xs uppercase tracking-wider transition-all shadow-lg shadow-amber-500/20 flex items-center gap-2 cursor-pointer active:scale-95"
                >
                  <CheckCircle2 size={16} />
                  Aprobar Foto y Continuar
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
            >
              Cerrar Visor
            </button>
          )}
        </div>
      </footer>
    </div>
  );
};

export default FullscreenPhotoModal;
