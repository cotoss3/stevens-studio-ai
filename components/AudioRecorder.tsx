import React, { useState, useRef } from 'react';
import { Mic, Square, Sparkles, Upload, Volume2, RefreshCw, CheckCircle2, AlertCircle, Loader2, Play, Pause, Maximize2 } from 'lucide-react';
import { geminiService } from '../services/geminiService';

interface AudioRecorderProps {
  onAudioProcessed: (data: {
    audioBase64: string;
    transcription: string;
    title: string;
    description: string;
  }) => void;
  onSkip?: () => void;
  initialTitle?: string | null;
  initialDescription?: string | null;
  initialTranscription?: string | null;
  productImage?: string | null;
  productImage2?: string | null;
  upcCode?: string | null;
  onViewFullscreen?: (imageUrl: string) => void;
}

const AudioRecorder: React.FC<AudioRecorderProps> = ({
  onAudioProcessed,
  onSkip,
  initialTitle = '',
  initialDescription = '',
  initialTranscription = '',
  productImage = null,
  productImage2 = null,
  upcCode = null,
  onViewFullscreen
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioBase64, setAudioBase64] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState(initialTitle || '');
  const [description, setDescription] = useState(initialDescription || '');
  const [transcription, setTranscription] = useState(initialTranscription || '');
  const [isRegeneratingTitle, setIsRegeneratingTitle] = useState(false);
  const [isRegeneratingDesc, setIsRegeneratingDesc] = useState(false);

  const SUFFIX_DISPONIBILIDAD = ' - Modelo Según Disponibilidad';

  const hasSuffix = (text: string) => {
    return text.trim().toLowerCase().endsWith('modelo según disponibilidad') ||
           text.trim().toLowerCase().endsWith('modelo segun disponibilidad');
  };

  const removeSuffix = (text: string) => {
    return text
      .replace(/\s*[-–—]?\s*modelo\s+seg[úu]n\s+disponibilidad\s*$/i, '')
      .trim();
  };

  const isModelAvailabilityChecked = hasSuffix(title);

  const handleToggleModelAvailability = (checked: boolean) => {
    if (!title.trim()) return;

    if (checked) {
      const base = removeSuffix(title);
      // Espacio para añadir el sufijo sin exceder 60 caracteres
      const maxBaseLen = 60 - SUFFIX_DISPONIBILIDAD.length;
      const truncatedBase = base.slice(0, Math.max(1, maxBaseLen)).trim();
      setTitle(`${truncatedBase}${SUFFIX_DISPONIBILIDAD}`);
    } else {
      const base = removeSuffix(title);
      setTitle(base);
    }
  };

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Liberar el microfono si el usuario navega a otro paso mientras graba o al desmontar
  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try { mediaRecorderRef.current.stop(); } catch {}
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => {
          try { track.stop(); } catch {}
        });
        streamRef.current = null;
      }
    };
  }, []);

  const compressImageForAI = async (dataUrl: string, maxDim = 400, quality = 0.65): Promise<string> => {
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

  const startRecording = async () => {
    try {
      setError(null);
      audioChunksRef.current = [];
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        // Detener microfono en el instante en que termina la grabacion
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => {
            try { track.stop(); } catch {}
          });
          streamRef.current = null;
        }
        stream.getTracks().forEach(track => {
          try { track.stop(); } catch {}
        });

        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const url = URL.createObjectURL(audioBlob);
        setAudioUrl(url);

        // Convert Blob to Base64 and process with Gemini
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = async () => {
          const base64Data = reader.result as string;
          setAudioBase64(base64Data);
          await processAudioWithGemini(base64Data, 'audio/webm');
        };
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);

      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);

    } catch (err: any) {
      console.error("Error accessing microphone:", err);
      setError("No se pudo acceder al micrófono. Verifica los permisos o sube un archivo de audio.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    const mimeType = file.type || 'audio/webm';
    const url = URL.createObjectURL(file);
    setAudioUrl(url);

    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onloadend = async () => {
      const base64Data = reader.result as string;
      setAudioBase64(base64Data);
      await processAudioWithGemini(base64Data, mimeType);
    };
  };

  const processAudioWithGemini = async (base64AudioData: string, mime: string) => {
    setIsProcessing(true);
    setError(null);
    try {
      // Optimizacion: reducir tamano de la imagen de apoyo para acelerar el envio de red
      let optimizedImg = productImage;
      if (productImage && productImage.startsWith('data:image')) {
        optimizedImg = await compressImageForAI(productImage, 400, 0.65);
      }

      const result = await geminiService.processAudio(
        base64AudioData,
        mime,
        optimizedImg,
        upcCode
      );
      setTitle(result.title);
      setDescription(result.description);
      setTranscription(result.transcription);
    } catch (err: any) {
      console.error("Error processing audio:", err);
      let rawMsg = err.message || "Error al procesar el audio con IA. Puedes escribir los datos manualmente.";
      try {
        const parsed = JSON.parse(rawMsg);
        if (parsed?.error?.message) rawMsg = parsed.error.message;
      } catch {}
      if (/503|high demand|alta demanda|UNAVAILABLE/i.test(rawMsg)) {
        rawMsg = "Alta demanda momentánea en los servidores de IA de Google. Puedes pulsar 'Reintentar con IA' o completar la ficha manualmente.";
      }
      setError(rawMsg);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRegenerateTitle = async () => {
    if (isRegeneratingTitle || isProcessing) return;
    setIsRegeneratingTitle(true);
    setError(null);
    try {
      let optimizedImg = productImage;
      if (productImage && productImage.startsWith('data:image')) {
        optimizedImg = await compressImageForAI(productImage, 400, 0.65);
      }
      const res = await geminiService.regenerateField({
        field: 'title',
        transcription,
        currentTitle: title,
        currentDescription: description,
        base64Image: optimizedImg,
        upcCode
      });
      if (res.title) {
        // Si el sufijo de disponibilidad estaba marcado previamente, preservarlo si cabe
        if (isModelAvailabilityChecked) {
          const cleanNew = removeSuffix(res.title);
          const maxBase = 60 - SUFFIX_DISPONIBILIDAD.length;
          const basePart = cleanNew.length > maxBase ? cleanNew.slice(0, maxBase).trim() : cleanNew;
          setTitle(`${basePart}${SUFFIX_DISPONIBILIDAD}`);
        } else {
          setTitle(res.title.slice(0, 60));
        }
      }
    } catch (err: any) {
      console.error("Error regenerating title:", err);
      setError(err.message || "No se pudo regenerar el título");
    } finally {
      setIsRegeneratingTitle(false);
    }
  };

  const handleRegenerateDescription = async () => {
    if (isRegeneratingDesc || isProcessing) return;
    setIsRegeneratingDesc(true);
    setError(null);
    try {
      let optimizedImg = productImage;
      if (productImage && productImage.startsWith('data:image')) {
        optimizedImg = await compressImageForAI(productImage, 400, 0.65);
      }
      const res = await geminiService.regenerateField({
        field: 'description',
        transcription,
        currentTitle: title,
        currentDescription: description,
        base64Image: optimizedImg,
        upcCode
      });
      if (res.description) {
        setDescription(res.description.slice(0, 500));
      }
    } catch (err: any) {
      console.error("Error regenerating description:", err);
      setError(err.message || "No se pudo regenerar la descripción");
    } finally {
      setIsRegeneratingDesc(false);
    }
  };

  const togglePlayback = () => {
    if (!audioPlayerRef.current) return;
    if (isPlaying) {
      audioPlayerRef.current.pause();
      setIsPlaying(false);
    } else {
      audioPlayerRef.current.play();
      setIsPlaying(true);
    }
  };

  const handleContinue = () => {
    if (!title && !description) {
      setError("Por favor, ingresa al menos el título o la descripción del producto.");
      return;
    }
    const finalTitle = title.trim().slice(0, 60);
    const finalDesc = description.trim().slice(0, 500);
    onAudioProcessed({
      audioBase64: audioBase64 || '',
      transcription,
      title: finalTitle,
      description: finalDesc
    });
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="w-full max-w-2xl mx-auto space-y-6">
      <input 
        ref={fileInputRef} 
        type="file" 
        accept="audio/*" 
        className="hidden" 
        onChange={handleFileUpload} 
      />

      {/* HEADER DE LA SECCIÓN AUDIO */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-xl relative overflow-hidden">
        <div className="flex items-center gap-2.5 sm:gap-3 mb-2">
          <div className="p-2.5 sm:p-3 bg-amber-500/10 text-amber-400 rounded-xl sm:rounded-2xl border border-amber-500/20 shrink-0">
            <Mic size={20} className="sm:w-6 sm:h-6" />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-bold text-white tracking-wide">Paso 3: Audio y Detalles</h2>
            <p className="text-[11px] sm:text-xs text-slate-400">Graba una nota de voz corta describiendo el producto. La IA creará la ficha técnica automáticamente.</p>
          </div>
        </div>

        {/* VISTA PREVIA DE LAS FOTOS DEL PRODUCTO APROBADAS */}
        {(productImage || productImage2) && (
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {productImage && (
              <div 
                onClick={() => onViewFullscreen?.(productImage)}
                className="p-3 bg-slate-950/80 hover:bg-slate-950 border border-slate-800 hover:border-amber-500/40 rounded-2xl flex items-center justify-between gap-3 cursor-pointer transition-all group shadow-inner"
                title="Toca para ampliar Foto 1 a pantalla completa"
              >
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl overflow-hidden bg-white border border-slate-700 shrink-0 flex items-center justify-center p-0.5 shadow-sm">
                    <img src={productImage} alt="Foto 1" className="w-full h-full object-contain" />
                  </div>
                  <div className="text-left">
                    <span className="text-[10px] font-black uppercase tracking-wider text-amber-400 flex items-center gap-1">
                      <Sparkles size={11} /> Foto 1 (_1.jpg)
                    </span>
                    <p className="text-[11px] font-semibold text-slate-300 group-hover:text-white transition-colors">
                      1000×1000 px • Principal
                    </p>
                  </div>
                </div>
                <span className="p-2 rounded-xl bg-slate-800 group-hover:bg-amber-500 group-hover:text-slate-950 text-slate-400 transition-all shadow-sm">
                  <Maximize2 size={14} />
                </span>
              </div>
            )}

            {productImage2 && (
              <div 
                onClick={() => onViewFullscreen?.(productImage2)}
                className="p-3 bg-slate-950/80 hover:bg-slate-950 border border-slate-800 hover:border-amber-500/40 rounded-2xl flex items-center justify-between gap-3 cursor-pointer transition-all group shadow-inner"
                title="Toca para ampliar Foto 2 a pantalla completa"
              >
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl overflow-hidden bg-white border border-slate-700 shrink-0 flex items-center justify-center p-0.5 shadow-sm">
                    <img src={productImage2} alt="Foto 2" className="w-full h-full object-contain" />
                  </div>
                  <div className="text-left">
                    <span className="text-[10px] font-black uppercase tracking-wider text-amber-400 flex items-center gap-1">
                      <Sparkles size={11} /> Foto 2 (_2.jpg)
                    </span>
                    <p className="text-[11px] font-semibold text-slate-300 group-hover:text-white transition-colors">
                      1000×1000 px • Detalle/Secundaria
                    </p>
                  </div>
                </div>
                <span className="p-2 rounded-xl bg-slate-800 group-hover:bg-amber-500 group-hover:text-slate-950 text-slate-400 transition-all shadow-sm">
                  <Maximize2 size={14} />
                </span>
              </div>
            )}
          </div>
        )}

        {/* CONTROLES DE GRABACIÓN DE AUDIO */}
        <div className="mt-5 flex flex-col items-center justify-center p-5 bg-slate-950/80 rounded-2xl border border-slate-800/80 space-y-3">
          
          {isRecording ? (
            <div className="flex flex-col items-center gap-3 animate-fade-in w-full">
              <div className="flex items-center gap-2 text-red-400 font-mono text-xl font-bold">
                <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
                {formatTime(recordingTime)}
              </div>
              <p className="text-[11px] text-slate-400">Grabando... Habla de las características básicas del producto.</p>
              
              <button
                type="button"
                onClick={stopRecording}
                className="w-full max-w-xs py-3.5 px-6 bg-red-600 hover:bg-red-500 text-white font-black text-xs uppercase tracking-wider rounded-xl flex items-center justify-center gap-2.5 shadow-lg shadow-red-600/30 transition-all active:scale-95 cursor-pointer"
              >
                <Square size={16} />
                <span>Detener Grabación</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-center w-full max-w-md">
              <button
                type="button"
                onClick={startRecording}
                disabled={isProcessing}
                className="w-full py-4 px-6 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-sm uppercase tracking-wider rounded-2xl flex items-center justify-center gap-3 transition-all active:scale-95 shadow-xl shadow-amber-500/25 disabled:opacity-50 cursor-pointer"
              >
                <Mic size={22} className="text-slate-950" />
                <span>Grabar Nota de Voz</span>
              </button>
            </div>
          )}

          {/* REPRODUCTOR DE AUDIO GRABADO */}
          {audioUrl && !isRecording && (
            <div className="w-full flex items-center justify-between p-3 bg-slate-900 rounded-xl border border-slate-800 mt-2">
              <audio 
                ref={audioPlayerRef} 
                src={audioUrl} 
                onEnded={() => setIsPlaying(false)} 
                className="hidden" 
              />
              <div className="flex items-center gap-3">
                <button
                  onClick={togglePlayback}
                  className="p-2 bg-amber-500 text-slate-950 rounded-lg hover:bg-amber-400 transition-colors"
                >
                  {isPlaying ? <Pause size={16} /> : <Play size={16} />}
                </button>
                <span className="text-xs text-slate-300 font-medium flex items-center gap-1">
                  <Volume2 size={14} className="text-amber-400" /> Audio Capturado
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={startRecording}
                  className="text-xs text-slate-400 hover:text-amber-400 flex items-center gap-1 cursor-pointer"
                >
                  <RefreshCw size={12} /> Regrabar
                </button>
                {audioBase64 && !isProcessing && (
                  <button
                    type="button"
                    onClick={() => processAudioWithGemini(audioBase64, 'audio/webm')}
                    className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1 font-semibold ml-2 cursor-pointer"
                    title="Volver a analizar este audio con IA"
                  >
                    <Sparkles size={12} /> Reanalizar
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ESTADO DE PROCESAMIENTO CON IA GEMINI - CLARO Y CALMANTE */}
      {isProcessing && (
        <div className="bg-gradient-to-b from-slate-900 to-slate-950 border border-amber-500/30 rounded-3xl p-6 text-center space-y-4 shadow-2xl backdrop-blur-md animate-in fade-in duration-300">
          <div className="relative w-16 h-16 mx-auto flex items-center justify-center">
            <div className="absolute inset-0 rounded-full bg-amber-400/20 animate-ping opacity-40" />
            <div className="w-14 h-14 rounded-full bg-amber-500/10 border border-amber-500/40 flex items-center justify-center">
              <Sparkles className="text-amber-400 animate-pulse" size={26} />
            </div>
            <div className="absolute -bottom-1 -right-1 bg-slate-900 p-1 rounded-full border border-slate-700 shadow">
              <Loader2 className="animate-spin text-amber-400" size={14} />
            </div>
          </div>
          <div>
            <p className="text-sm font-bold text-slate-100 flex items-center justify-center gap-1.5">
              <span>Transcribiendo audio y creando título comercial...</span>
            </p>
            <p className="text-xs text-slate-400 mt-1">
              La IA está extrayendo los detalles de tu voz. En un par de segundos la ficha estará lista.
            </p>
          </div>
          <div className="w-full max-w-xs mx-auto h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-amber-500 to-emerald-400 rounded-full animate-pulse w-3/4" />
          </div>
        </div>
      )}

      {/* MENSAJE DE ERROR */}
      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-2xl text-red-400 text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-md">
          <div className="flex items-center gap-2">
            <AlertCircle size={18} className="shrink-0 text-red-400" />
            <span>{error}</span>
          </div>
          {audioBase64 && (
            <button
              type="button"
              onClick={() => processAudioWithGemini(audioBase64, 'audio/webm')}
              disabled={isProcessing}
              className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-900 rounded-xl font-bold text-xs transition-colors shrink-0 flex items-center gap-1.5 shadow-md self-end sm:self-auto cursor-pointer"
            >
              <RefreshCw size={12} className={isProcessing ? 'animate-spin' : ''} />
              Reintentar con IA
            </button>
          )}
        </div>
      )}

      {/* RESULTADOS DE TRANSCRIPCIÓN Y EDICIÓN DE FICHA */}
      {(title || description || transcription || !isProcessing) && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-5 shadow-xl">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
              <Sparkles size={16} className="text-amber-400" /> Ficha Generada por IA (Editable)
            </h3>
            <span className="text-[10px] text-amber-400/80 bg-amber-500/10 px-2.5 py-1 rounded-full border border-amber-500/20 font-semibold">
              Sugerencia Inteligente
            </span>
          </div>

          {/* CAMPO DE TÍTULO DEL PRODUCTO */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block">
                  Título del Producto
                </label>
                <button
                  type="button"
                  onClick={handleRegenerateTitle}
                  disabled={isRegeneratingTitle || isProcessing}
                  title="Regenerar solo el título con IA"
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-semibold bg-slate-800 hover:bg-slate-700 text-amber-300 hover:text-amber-200 border border-slate-700 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <RefreshCw size={10} className={isRegeneratingTitle ? 'animate-spin' : ''} />
                  <span>{isRegeneratingTitle ? 'Generando...' : 'Regenerar'}</span>
                </button>
              </div>
              <span className={`text-[10px] font-mono font-bold ${title.length > 60 ? 'text-red-400' : title.length >= 50 ? 'text-amber-400' : 'text-slate-400'}`}>
                {title.length}/60 car.
              </span>
            </div>
            <input
              type="text"
              maxLength={60}
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, 60))}
              placeholder="Ej: Camisa Casual de Algodón Hombre Talla M Azul"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-400 transition-colors"
            />
            
            {/* CHECKBOX: MODELO SEGÚN DISPONIBILIDAD */}
            <div className="pt-1">
              <label 
                className={`inline-flex items-center gap-2 select-none text-xs font-semibold px-3 py-2 rounded-xl border transition-all ${
                  !title.trim()
                    ? 'opacity-40 cursor-not-allowed border-slate-800 bg-slate-950/40 text-slate-500'
                    : isModelAvailabilityChecked
                    ? 'bg-amber-500/15 border-amber-400/50 text-amber-300 shadow-sm cursor-pointer'
                    : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700 cursor-pointer'
                }`}
                title={!title.trim() ? "Escribe o genera un título primero para activar esta opción" : "Agrega o quita '- Modelo Según Disponibilidad' del título"}
              >
                <input
                  type="checkbox"
                  disabled={!title.trim()}
                  checked={isModelAvailabilityChecked}
                  onChange={(e) => handleToggleModelAvailability(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-amber-500 focus:ring-amber-400 focus:ring-offset-slate-900 cursor-pointer disabled:cursor-not-allowed"
                />
                <span>Modelo Según Disponibilidad</span>
              </label>
            </div>

            <p className="text-[10px] text-slate-400">Regla Stevens: Máximo 60 caracteres.</p>
          </div>

          {/* CAMPO DE DESCRIPCIÓN DETALLADA */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block">
                  Descripción Detallada
                </label>
                <button
                  type="button"
                  onClick={handleRegenerateDescription}
                  disabled={isRegeneratingDesc || isProcessing}
                  title="Regenerar solo la descripción con IA (máximo 2 adjetivos)"
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-semibold bg-slate-800 hover:bg-slate-700 text-amber-300 hover:text-amber-200 border border-slate-700 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <RefreshCw size={10} className={isRegeneratingDesc ? 'animate-spin' : ''} />
                  <span>{isRegeneratingDesc ? 'Generando...' : 'Regenerar'}</span>
                </button>
              </div>
              <span className={`text-[10px] font-mono font-bold ${description.length > 500 ? 'text-red-400' : description.length >= 450 ? 'text-amber-400' : 'text-slate-400'}`}>
                {description.length}/500 car.
              </span>
            </div>
            <textarea
              rows={3}
              maxLength={500}
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, 500))}
              placeholder="Ej: Producto en material resistente de alta calidad, ideal para uso diario con acabados de primera..."
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-400 transition-colors resize-none"
            />
            <p className="text-[10px] text-slate-400">Regla Stevens: Máximo 500 caracteres, máx. 2 adjetivos.</p>
          </div>

          {/* TRANSCRIPCIÓN VERBATIM DE IA */}
          {transcription && (
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-850 space-y-1">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Transcripción Completa del Audio:
              </span>
              <p className="text-xs text-slate-400 italic leading-relaxed">"{transcription}"</p>
            </div>
          )}

          {/* BOTONES DE ACCIÓN */}
          <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2.5 sm:gap-3">
            {onSkip && (
              <button
                type="button"
                onClick={onSkip}
                className="w-full sm:w-auto py-3 px-5 text-slate-400 hover:text-slate-200 text-xs font-semibold uppercase tracking-wider text-center cursor-pointer order-2 sm:order-1"
              >
                Omitir Paso
              </button>
            )}

            <button
              type="button"
              onClick={handleContinue}
              disabled={isProcessing}
              className="w-full sm:w-auto px-6 py-3.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs uppercase tracking-wider rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20 active:scale-95 transition-all disabled:opacity-50 cursor-pointer order-1 sm:order-2"
            >
              <span>Continuar a Revisión</span>
              <CheckCircle2 size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AudioRecorder;
