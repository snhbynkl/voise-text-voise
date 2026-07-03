import { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileAudio,
  FileVideo,
  Loader2,
  Mic2,
  RefreshCcw,
  Upload,
} from 'lucide-react';
import {
  createGeminiJob,
  createVoiceCloneJob,
  waitForJob,
  type ProcessResult,
  type VoiceCloneResult,
} from './lib/api';
import { cn } from './lib/utils';

type AppState = 'idle' | 'translating' | 'cloning' | 'completed' | 'error';

export default function App() {
  const [state, setState] = useState<AppState>('idle');
  const [referenceAudio, setReferenceAudio] = useState<File | null>(null);
  const [media, setMedia] = useState<File | null>(null);
  const [results, setResults] = useState<ProcessResult | null>(null);
  const [voiceResult, setVoiceResult] = useState<VoiceCloneResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState('idle');
    setReferenceAudio(null);
    setMedia(null);
    setResults(null);
    setVoiceResult(null);
    setError(null);
  };

  const start = async () => {
    if (!referenceAudio || !media) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setResults(null);
    setVoiceResult(null);

    try {
      setState('translating');
      const translationJob = await createGeminiJob(media);
      const translation = await waitForJob<ProcessResult>(
        translationJob.statusUrl,
        controller.signal,
      );
      setResults(translation);

      setState('cloning');
      const cloneJob = await createVoiceCloneJob(
        translation.turkishTranslation,
        referenceAudio,
      );
      const clonedVoice = await waitForJob<VoiceCloneResult>(
        cloneJob.statusUrl,
        controller.signal,
      );
      setVoiceResult(clonedVoice);
      setState('completed');
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      setError(caught instanceof Error ? caught.message : 'Beklenmeyen bir hata oluştu.');
      setState('error');
    } finally {
      abortRef.current = null;
    }
  };

  return (
    <div className="min-h-screen p-6 sm:p-10 flex flex-col gap-8 max-w-7xl mx-auto">
      <header className="border-l-4 border-bento-accent pl-4 py-1">
        <h1 className="text-3xl font-bold text-white tracking-tight">AudioTransTurk</h1>
        <p className="text-sm text-bento-text opacity-70 mt-1 uppercase tracking-widest font-mono">
          Gemini çeviri + yerel ses klonlama
        </p>
      </header>

      <main className="flex-grow flex flex-col">
        <AnimatePresence mode="wait">
          {state === 'idle' && (
            <motion.section
              key="idle"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="max-w-4xl mx-auto w-full space-y-8"
            >
              <div className="text-center space-y-3">
                <h2 className="text-4xl sm:text-5xl font-bold text-white">
                  Rusça medyayı kendi sesinizle <span className="text-bento-accent">Türkçeleştirin.</span>
                </h2>
                <p className="text-bento-text opacity-60">
                  Önce temiz bir referans ses, ardından işlenecek Rusça medya seçin.
                </p>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <FilePicker
                  step="1"
                  title="Referans Sesi Yükleyin"
                  detail="30–90 saniye, tek konuşmacı"
                  accept="audio/*"
                  file={referenceAudio}
                  icon={Mic2}
                  onChange={setReferenceAudio}
                />
                <FilePicker
                  step="2"
                  title="Rusça Medyayı Yükleyin"
                  detail="İlk test için 30 saniye–2 dakika"
                  accept="audio/*,video/*"
                  file={media}
                  icon={FileVideo}
                  disabled={!referenceAudio}
                  onChange={setMedia}
                />
              </div>

              <button
                type="button"
                disabled={!referenceAudio || !media}
                onClick={start}
                className="w-full py-4 rounded-2xl bg-bento-accent text-bento-bg font-bold disabled:opacity-30 disabled:cursor-not-allowed hover:scale-[1.01] transition-transform"
              >
                İşlemi Başlat
              </button>
            </motion.section>
          )}

          {(state === 'translating' || state === 'cloning') && (
            <motion.section
              key="processing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-grow flex flex-col items-center justify-center max-w-xl mx-auto w-full space-y-10"
            >
              <Loader2 className="w-16 h-16 text-bento-accent animate-spin" />
              <div className="text-center">
                <h2 className="text-2xl font-bold text-white">
                  {state === 'translating' ? 'Medya çözümleniyor ve çevriliyor' : 'Yerel ses klonlanıyor'}
                </h2>
                <p className="text-white/40 mt-2">Bu sayfayı işlem tamamlanana kadar açık tutun.</p>
              </div>
              <div className="w-full space-y-4">
                <Progress label="Gemini transkripsiyon ve çeviri" status={state === 'translating' ? 'active' : 'completed'} />
                <Progress label="Python XTTS ses klonlama" status={state === 'cloning' ? 'active' : 'waiting'} />
              </div>
            </motion.section>
          )}

          {state === 'completed' && results && voiceResult && (
            <motion.section
              key="completed"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              className="grid md:grid-cols-2 gap-4"
            >
              <TextResult title="Rusça transkripsiyon" text={results.originalTranscription} fileName="orijinal_ru.txt" />
              <TextResult title="Türkçe çeviri" text={results.turkishTranslation} fileName="turkce_ceviri.txt" />
              <div className="md:col-span-2 bento-card space-y-5">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="text-bento-accent" />
                  <h3 className="font-bold text-white">Klonlanmış Türkçe Ses</h3>
                </div>
                <audio className="w-full" controls src={voiceResult.outputUrl} />
                <a
                  href={voiceResult.outputUrl}
                  download={voiceResult.fileName}
                  className="inline-flex items-center gap-2 text-bento-accent hover:text-white transition-colors"
                >
                  <Download className="w-4 h-4" /> WAV dosyasını indir
                </a>
              </div>
              <button type="button" onClick={reset} className="md:col-span-2 bento-card flex-row items-center justify-center gap-3 cursor-pointer">
                <RefreshCcw className="w-5 h-5 text-bento-highlight" />
                <span className="font-bold text-white">Yeni İşlem Başlat</span>
              </button>
            </motion.section>
          )}

          {state === 'error' && (
            <motion.section key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-2xl mx-auto w-full bento-card border-red-500/30 text-center space-y-5">
              <AlertCircle className="w-14 h-14 text-red-400 mx-auto" />
              <h2 className="text-2xl font-bold text-white">İşlem Başarısız</h2>
              <p className="text-red-200/70 whitespace-pre-wrap">{error}</p>
              <button type="button" onClick={reset} className="w-full py-4 rounded-2xl bg-bento-accent text-bento-bg font-bold">Yeniden Dene</button>
            </motion.section>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

interface FilePickerProps {
  step: string;
  title: string;
  detail: string;
  accept: string;
  file: File | null;
  icon: typeof FileAudio;
  disabled?: boolean;
  onChange: (file: File | null) => void;
}

function FilePicker({ step, title, detail, accept, file, icon: Icon, disabled, onChange }: FilePickerProps) {
  return (
    <label className={cn('bento-card min-h-64 items-center justify-center text-center cursor-pointer border-dashed border-2', disabled && 'opacity-30 cursor-not-allowed')}>
      <input
        className="hidden"
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={(event) => onChange(event.target.files?.[0] || null)}
      />
      <span className="text-[10px] font-mono text-bento-accent uppercase tracking-widest">Adım {step}</span>
      {file ? <CheckCircle2 className="w-12 h-12 text-bento-accent" /> : <Upload className="w-12 h-12 text-white/40" />}
      <div>
        <p className="font-bold text-white">{title}</p>
        <p className="text-xs text-white/40 mt-2">{file?.name || detail}</p>
      </div>
    </label>
  );
}

function Progress({ label, status }: { label: string; status: 'waiting' | 'active' | 'completed' }) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-xs uppercase tracking-widest">
        <span className={status === 'waiting' ? 'text-white/20' : 'text-bento-accent'}>{label}</span>
        <span className="text-white/30">{status === 'active' ? 'Aktif' : status === 'completed' ? 'Tamamlandı' : 'Bekliyor'}</span>
      </div>
      <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
        <div className={cn('h-full bg-bento-accent transition-all', status === 'completed' ? 'w-full' : status === 'active' ? 'w-1/2 animate-pulse' : 'w-0')} />
      </div>
    </div>
  );
}

function TextResult({ title, text, fileName }: { title: string; text: string; fileName: string }) {
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="bento-card h-96">
      <div className="flex justify-between items-center">
        <h3 className="font-bold text-bento-accent uppercase tracking-widest text-xs">{title}</h3>
        <button type="button" onClick={download}><Download className="w-4 h-4 text-white/50" /></button>
      </div>
      <p className="overflow-y-auto whitespace-pre-wrap text-white/80 leading-relaxed">{text}</p>
    </div>
  );
}
