import React, { useState, useRef } from 'react';
import { Mic, Square, Sparkles, Upload, Volume2, RefreshCw, CheckCircle2, AlertCircle, Loader2, Play, Pause } from 'lucide-react';
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
}

const AudioRecorder: React.FC<AudioRecorderProps> = ({
  onAudioProcessed,
  onSkip,
  initialTitle = '',
  initialDescription = '',
  initialTranscription = ''
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

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const startRecording = async () => {
    try {
      setError(null);
      audioChunksRef.current = [];
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
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

        // Stop audio tracks
        stream.getTracks().forEach(track => track.stop());
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
      const result = await geminiService.processAudio(base64AudioData, mime);
      setTitle(result.title);
      setDescription(result.description);
      setTranscription(result.transcription);
    } catch (err: any) {
      console.error("Error processing audio:", err);
      setError(err.message || "Error al procesar el audio con IA. Puedes escribir los datos manualmente.");
    } finally {
      setIsProcessing(false);
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
    onAudioProcessed({
      audioBase64: audioBase64 || '',
      transcription,
      title,
      description
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
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl relative overflow-hidden">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-3 bg-amber-500/10 text-amber-400 rounded-2xl border border-amber-500/20">
            <Mic size={24} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white tracking-wide">Paso 3: Audio y Detalles del Producto</h2>
            <p className="text-xs text-slate-400">Graba una nota de voz corta describiendo el producto. La IA transcribirá el audio y creará la ficha técnica automáticamente.</p>
          </div>
        </div>

        {/* CONTROLES DE GRABACIÓN DE AUDIO */}
        <div className="mt-6 flex flex-col items-center justify-center p-6 bg-slate-950/80 rounded-2xl border border-slate-800/80 space-y-4">
          
          {isRecording ? (
            <div className="flex flex-col items-center gap-4 animate-fade-in">
              <div className="relative flex items-center justify-center">
                <span className="absolute w-24 h-24 bg-red-500/20 rounded-full animate-ping" />
                <button
                  onClick={stopRecording}
                  className="w-20 h-20 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center shadow-lg shadow-red-500/30 transition-transform active:scale-95 z-10"
                  title="Detener grabación"
                >
                  <Square size={28} />
                </button>
              </div>

              <div className="flex items-center gap-2 text-red-400 font-mono text-xl font-bold">
                <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
                {formatTime(recordingTime)}
              </div>
              <p className="text-xs text-slate-400">Grabando... Habla de las características básicas del producto.</p>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row items-center gap-4 w-full max-w-md">
              <button
                onClick={startRecording}
                disabled={isProcessing}
                className="flex-1 w-full py-4 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-2xl flex items-center justify-center gap-3 transition-all active:scale-95 shadow-lg shadow-amber-500/20 disabled:opacity-50"
              >
                <Mic size={20} />
                <span>Grabar Nota de Voz</span>
              </button>

              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isProcessing}
                className="flex-1 w-full py-4 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 font-semibold rounded-2xl flex items-center justify-center gap-3 transition-all active:scale-95 disabled:opacity-50"
              >
                <Upload size={20} className="text-amber-400" />
                <span>Subir Audio</span>
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

              <button
                onClick={startRecording}
                className="text-xs text-slate-400 hover:text-amber-400 flex items-center gap-1"
              >
                <RefreshCw size={12} /> Regrabar
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ESTADO DE PROCESAMIENTO CON IA GEMINI */}
      {isProcessing && (
        <div className="bg-slate-900/90 border border-amber-500/30 rounded-2xl p-6 text-center space-y-3 shadow-xl backdrop-blur-md">
          <Loader2 size={36} className="text-amber-400 animate-spin mx-auto" />
          <p className="text-sm font-bold text-amber-400 uppercase tracking-wider">Transcripción y Análisis IA en Proceso</p>
          <p className="text-xs text-slate-400">Gemini está analizando el audio para generar el título y la descripción del producto...</p>
        </div>
      )}

      {/* MENSAJE DE ERROR */}
      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-2xl text-red-400 text-xs flex items-center gap-3">
          <AlertCircle size={18} className="shrink-0" />
          <span>{error}</span>
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
            <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block">
              Título del Producto
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ej: Camisa Casual de Algodón Hombre Talla M Azul"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-400 transition-colors"
            />
          </div>

          {/* CAMPO DE DESCRIPCIÓN DETALLADA */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block">
              Descripción Detallada
            </label>
            <textarea
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ej: Producto elaborado en material sintético resistente, ideal para uso diario. Incluye acabados de alta calidad..."
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-400 transition-colors resize-none"
            />
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

          {/* BOTÓN CONTINUAR */}
          <div className="pt-2 flex items-center justify-end gap-3">
            {onSkip && (
              <button
                type="button"
                onClick={onSkip}
                className="px-5 py-3 text-slate-400 hover:text-slate-200 text-xs font-semibold uppercase tracking-wider"
              >
                Omitir Paso
              </button>
            )}

            <button
              type="button"
              onClick={handleContinue}
              disabled={isProcessing}
              className="px-6 py-3.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs uppercase tracking-wider rounded-xl flex items-center gap-2 shadow-lg shadow-amber-500/20 active:scale-95 transition-all disabled:opacity-50"
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
