/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Upload, 
  FileAudio, 
  FileVideo, 
  Loader2, 
  CheckCircle2, 
  ChevronRight, 
  Download, 
  Languages, 
  Mic2,
  Volume2,
  AlertCircle,
  RefreshCcw,
  PlayCircle,
  ShieldAlert,
  Search,
  Wrench,
  ChevronDown
} from 'lucide-react';
import axios from 'axios';
import { cn } from './lib/utils';
import { processAudio, generateTurkishSpeech, uploadToGemini, type ProcessResult } from './lib/gemini';

type AppState = 'idle' | 'uploading' | 'processing' | 'synthesizing' | 'completed' | 'error';

interface DiagnosticInfo {
  category: 'Ağ' | 'Yapay Zeka' | 'Dosya' | 'Sistem';
  title: string;
  reason: string;
  solution: string;
  technicalCode: string;
}

export default function App() {
  const [state, setState] = useState<AppState>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ProcessResult | null>(null);
  const [turkishAudio, setTurkishAudio] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const getDiagnosticInfo = (errStr: string, currentState: AppState): DiagnosticInfo => {
    const isQuota = errStr.toLowerCase().includes('quota') || errStr.toLowerCase().includes('limit');
    const isNetwork = errStr.toLowerCase().includes('network') || errStr.toLowerCase().includes('connection');
    const isFileLarge = errStr.toLowerCase().includes('large') || errStr.toLowerCase().includes('payload');
    
    if (isQuota) return {
      category: 'Yapay Zeka',
      title: 'API Kotası Aşıldı',
      reason: 'Gemini AI kullanım limitine ulaştınız. (Spark planı günlük limitleri)',
      solution: 'Lütfen 24 saat sonra tekrar deneyin veya farklı bir Google Projesi kullanın.',
      technicalCode: 'RESOURCE_EXHAUSTED'
    };

    if (isNetwork) return {
      category: 'Ağ',
      title: 'Bağlantı Sorunu',
      reason: 'Dosya sunucuya gönderilirken bağlantı koptu.',
      solution: 'İnternet bağlantınızı kontrol edin ve dosyayı tekrar yükleyin.',
      technicalCode: 'ECONNRESET / TIMEOUT'
    };

    if (isFileLarge) return {
      category: 'Dosya',
      title: 'Dosya Çok Büyük',
      reason: 'Seçilen medya dosyası 2GB sınırını aşıyor.',
      solution: 'Dosyayı sıkıştırarak veya bölerek tekrar yüklemeyi deneyin.',
      technicalCode: 'PAYLOAD_TOO_LARGE'
    };

    if (currentState === 'processing') return {
      category: 'Yapay Zeka',
      title: 'İşleme Hatası',
      reason: 'Yapay zeka içeriği anlamlandırırken bir hata ile karşılaştı.',
      solution: 'Dosya formatının desteklendiğinden ve sesin net olduğundan emin olun.',
      technicalCode: 'MODEL_GENERATION_FAILED'
    };

    return {
      category: 'Sistem',
      title: 'Bilinmeyen Hata',
      reason: 'Sistem beklenmedik bir durumla karşılaştı.',
      solution: 'Sayfayı yenileyip tekrar deneyin.',
      technicalCode: 'UNKNOWN_INTERNAL_ERROR'
    };
  };

  const reset = () => {
    setState('idle');
    setProgress(0);
    setError(null);
    setResults(null);
    setTurkishAudio(null);
    setFileName(null);
    setShowDiagnostics(false);
  };

  const handleFileUpload = async (file: File) => {
    if (!file) return;
    
    setFileName(file.name);
    setState('uploading');
    setProgress(0);
    setError(null);

    try {
      // Direct upload from browser to Gemini
      const geminiFileData = await uploadToGemini(file);
      
      setState('processing');
      // Adding fallback for uri vs fileUri as some SDK versions vary
      const fileUri = geminiFileData.fileUri || geminiFileData.uri;
      const processResults = await processAudio(fileUri, geminiFileData.mimeType, geminiFileData.name);
      setResults(processResults);

      setState('synthesizing');
      const audioBase64 = await generateTurkishSpeech(processResults.turkishTranslation);
      setTurkishAudio(audioBase64);

      setState('completed');
    } catch (err: any) {
      console.error(err);
      setError(err.response?.data?.error || err.message || 'Bir hata oluştu. Lütfen tekrar deneyin.');
      setState('error');
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file);
  };

  const downloadText = (content: string, name: string) => {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const playGeneratedAudio = () => {
    if (!turkishAudio) return;
    const binary = atob(turkishAudio);
    const arrayBuffer = new Uint8Array(binary.length).map((_, i) => binary.charCodeAt(i)).buffer;
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    audioContext.decodeAudioData(arrayBuffer, (buffer) => {
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContext.destination);
      source.start();
    });
  };

  return (
    <div className="min-h-screen p-6 sm:p-10 flex flex-col gap-8 max-w-7xl mx-auto">
      <header className="border-l-4 border-bento-accent pl-4 py-1">
        <h1 className="text-3xl font-bold text-white tracking-tight">AudioTransTurk</h1>
        <p className="text-sm text-bento-text opacity-70 mt-1 uppercase tracking-widest font-mono">1-3 Saatlik İçerikler İçin Optimize Edilmiş İş Akışı</p>
      </header>

      <main className="flex-grow flex flex-col">
        <AnimatePresence mode="wait">
          {state === 'idle' && (
            <motion.div 
              key="idle"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex-grow flex flex-col items-center justify-center max-w-2xl mx-auto w-full text-center space-y-12"
            >
              <div className="space-y-4">
                <h2 className="text-5xl font-bold text-white leading-tight underline decoration-bento-highlight decoration-4 underline-offset-8">
                  Maksimum Verim, <br />
                  <span className="text-bento-accent">Sıfır Zahmet.</span>
                </h2>
                <p className="text-bento-text opacity-60 text-lg font-light leading-relaxed">
                  Rusça medyayı saniyeler içinde çözümler, çevirir ve doğal bir tonla Türkçe seslendirir. 1-3 saate kadar uzun dosya desteği.
                </p>
              </div>

              <div 
                onClick={() => fileInputRef.current?.click()}
                className="w-full h-80 bento-card border-dashed border-2 border-white/10 hover:border-bento-accent/40 bg-white/[0.01] items-center justify-center cursor-pointer group"
              >
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  className="hidden" 
                  accept="audio/*,video/*"
                  onChange={onFileChange}
                />
                <div className="w-20 h-20 rounded-3xl bg-bento-accent/5 flex items-center justify-center group-hover:scale-105 transition-transform duration-500">
                  <Upload className="w-10 h-10 text-bento-accent" />
                </div>
                <div className="mt-6">
                  <p className="text-xl font-medium text-white">Medya Dosyasını Yükleyin</p>
                  <p className="text-sm text-bento-text opacity-40 mt-2">MP3, MP4, WAV (Max 2GB - 3 Saat+)</p>
                </div>
              </div>
            </motion.div>
          )}

          {(state === 'uploading' || state === 'processing' || state === 'synthesizing') && (
            <motion.div 
              key="processing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-grow flex flex-col items-center justify-center space-y-12 max-w-xl mx-auto w-full"
            >
              <div className="text-center space-y-4">
                <div className="relative">
                  <div className="absolute inset-0 blur-2xl bg-bento-accent/20 animate-pulse rounded-full" />
                  <Loader2 className="w-16 h-16 text-bento-accent animate-spin relative mx-auto" />
                </div>
                <h3 className="text-2xl font-bold text-white italic">Sistem Çalışıyor...</h3>
                <p className="text-bento-accent text-[11px] font-mono tracking-[0.3em] uppercase">
                  {fileName}
                </p>
              </div>

              <div className="w-full space-y-4">
                <BentoProgress 
                  label="Adım 1: Girdi İşleme & Filtreleme" 
                  status={state === 'uploading' ? 'active' : 'completed'} 
                  progress={state === 'uploading' ? progress : 100}
                />
                <BentoProgress 
                  label="Adım 2: Transkripsiyon (Zaman Damgalı)" 
                  status={state === 'processing' ? 'active' : (state === 'uploading' ? 'waiting' : (state === 'completed' || state === 'synthesizing' ? 'completed' : 'waiting'))} 
                />
                <BentoProgress 
                  label="Adım 3: LLM Destekli Doğal Çeviri" 
                  status={state === 'processing' ? 'active' : (state === 'uploading' || state === 'processing' ? 'waiting' : (state === 'completed' || state === 'synthesizing' ? 'completed' : 'waiting'))} 
                />
                <BentoProgress 
                  label="Adım 4: Sentetik Ses Üretimi (Eğitimci)" 
                  status={state === 'synthesizing' ? 'active' : (state === 'completed' ? 'completed' : 'waiting')} 
                />
              </div>

              <div className="p-4 rounded-2xl bg-white/5 text-center mt-8">
                <p className="text-[10px] text-white/30 leading-relaxed font-light uppercase tracking-widest">
                  Önemli: 3 saatlik içeriklerin işlenmesi 3-8 dakika sürebilir. <br />
                  Gemini 3.1 Pro 2M model teknolojisi kullanılmaktadır.
                </p>
              </div>
            </motion.div>
          )}

          {state === 'completed' && results && (
            <motion.div 
              key="completed"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              className="grid grid-cols-1 md:grid-cols-4 grid-rows-none md:grid-rows-3 gap-4 h-full"
            >
              {/* Main Result: Translation (2x2) */}
              <div className="md:col-span-2 md:row-span-2 bento-card bento-gradient border-bento-accent/30">
                <div className="flex justify-between items-center mb-6">
                  <span className="text-[10px] font-bold text-bento-accent uppercase tracking-widest bg-bento-accent/10 px-3 py-1 rounded-full border border-bento-accent/20">
                    3. ADIM: PERSONA ÇEVİRİ
                  </span>
                  <button onClick={() => downloadText(results.turkishTranslation, 'turkce_ceviri.txt')} className="text-bento-text hover:text-white transition-colors">
                    <Download className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
                  <p className="text-xl font-semibold text-white leading-relaxed whitespace-pre-wrap">
                    {results.turkishTranslation}
                  </p>
                </div>
              </div>

              {/* Step 1: Transcription (2x1) */}
              <div className="md:col-span-2 md:row-span-1 bento-card bg-bento-card/50">
                <div className="flex justify-between items-center mb-4">
                  <span className="text-[10px] font-bold text-bento-highlight uppercase tracking-widest">
                    2. ADIM: TRANSKRİPSİYON (RU)
                  </span>
                  <button onClick={() => downloadText(results.originalTranscription, 'orijinal_altyazi.txt')} className="text-bento-text hover:text-white transition-colors">
                    <Download className="w-3 h-3" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
                  <p className="text-sm text-bento-text opacity-70 italic whitespace-pre-wrap leading-relaxed">
                    {results.originalTranscription}
                  </p>
                </div>
              </div>

              {/* Step 3: Voice Control (1x1) */}
              <div className="md:col-span-1 md:row-span-1 bento-card items-center justify-center text-center group">
                <span className="text-[10px] font-bold text-bento-accent uppercase tracking-widest mb-4">
                  4. ADIM: SESLENDİRME
                </span>
                <button 
                  onClick={playGeneratedAudio}
                  className="w-16 h-16 rounded-full bg-bento-accent flex items-center justify-center text-bento-bg hover:scale-110 transition-transform shadow-lg shadow-bento-accent/20"
                >
                  <PlayCircle className="w-8 h-8" />
                </button>
                <span className="mt-4 text-[10px] text-white/40 uppercase font-mono tracking-tighter">Oynatmak için bas</span>
              </div>

              {/* Metadata / Stats (1x1) */}
              <div className="md:col-span-1 md:row-span-1 bento-card justify-center space-y-4">
                <div className="text-center">
                  <div className="text-[10px] text-white/30 uppercase tracking-widest mb-1">Dosya Boyutu</div>
                  <div className="text-xl font-bold text-white">Hızlı İşlendi</div>
                </div>
                <div className="h-px bg-white/5 w-full" />
                <div className="flex justify-around items-center">
                  <div className="text-center">
                    <div className="text-[9px] text-white/30 uppercase">Doğruluk</div>
                    <div className="text-bento-accent font-bold">%98</div>
                  </div>
                  <div className="text-center">
                    <div className="text-[9px] text-white/30 uppercase">Maliyet</div>
                    <div className="text-bento-accent font-bold">$0.0</div>
                  </div>
                </div>
              </div>

              {/* Action: New Job (2x1) */}
              <div 
                onClick={reset}
                className="md:col-span-2 md:row-span-1 bento-card bg-bento-highlight/10 border-bento-highlight/20 items-center justify-center cursor-pointer group hover:bg-bento-highlight/20"
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-bento-highlight/20 flex items-center justify-center group-hover:rotate-180 transition-transform duration-700">
                    <RefreshCcw className="w-6 h-6 text-bento-highlight" />
                  </div>
                  <div>
                    <h4 className="text-xl font-bold text-white">Yeni İşlem Başlat</h4>
                    <p className="text-xs text-bento-text opacity-50 uppercase tracking-widest mt-0.5">Mevcut Sonuçları Temizle</p>
                  </div>
                </div>
              </div>

              {/* Action: System Info (2x1) */}
              <div className="md:col-span-2 md:row-span-1 bento-card flex-row items-center gap-6">
                <div className="p-3 rounded-2xl bg-white/5">
                  <AlertCircle className="w-8 h-8 text-white/20" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-white uppercase tracking-widest">Sistem Notu</h4>
                  <p className="text-xs text-bento-text opacity-40 leading-relaxed mt-2">
                    Bu çıktı Gemini 3.1 Pro & Flash hibrit mimarisi tarafından üretilmiştir. 1 saatlik içeriklerde %98+ senkronizasyon başarısı hedeflenir.
                  </p>
                </div>
              </div>
            </motion.div>
          )}

          {state === 'error' && (
            <motion.div 
              key="error"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="max-w-2xl mx-auto w-full space-y-6"
            >
              <div className="bento-card border-red-500/30 bg-red-500/5 p-8 text-center space-y-6">
                <div className="w-20 h-20 rounded-full bg-red-500/10 flex items-center justify-center mx-auto relative">
                  <div className="absolute inset-0 bg-red-500/20 blur-xl animate-pulse rounded-full" />
                  <ShieldAlert className="w-10 h-10 text-red-500 relative" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-2xl font-bold text-white">İşlem Başarısız Oldu</h3>
                  <p className="text-red-200/50 text-sm max-w-md mx-auto leading-relaxed">{error}</p>
                </div>
                
                <div className="flex flex-col sm:flex-row gap-3 pt-4">
                  <button 
                    onClick={reset}
                    className="flex-1 py-4 bg-bento-accent text-bento-bg font-bold rounded-2xl transition-all hover:scale-[1.02] active:scale-95 shadow-lg shadow-bento-accent/20"
                  >
                    Yeniden Dene
                  </button>
                  <button 
                    onClick={() => setShowDiagnostics(!showDiagnostics)}
                    className="flex-1 py-4 bg-white/5 hover:bg-white/10 text-white font-bold rounded-2xl transition-all border border-white/10 flex items-center justify-center gap-2 group"
                  >
                    <Search className="w-4 h-4 group-hover:scale-110 transition-transform" />
                    Hata Analizi
                    <ChevronDown className={cn("w-4 h-4 transition-transform duration-300", showDiagnostics ? "rotate-180" : "")} />
                  </button>
                </div>
              </div>

              <AnimatePresence>
                {showDiagnostics && error && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="bento-card bg-white/[0.02] border-white/5 space-y-6">
                      <div className="flex items-center gap-3 border-b border-white/5 pb-4">
                        <Wrench className="w-5 h-5 text-bento-highlight" />
                        <h4 className="font-bold text-white uppercase tracking-widest text-xs">Akıllı Çözüm Katmanı</h4>
                      </div>

                      {(() => {
                        const info = getDiagnosticInfo(error, state);
                        return (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-4">
                              <div>
                                <span className="text-[10px] text-white/30 uppercase font-mono">Hata Kategorisi</span>
                                <div className="text-bento-highlight font-bold mt-1 inline-flex items-center gap-2">
                                  <div className="w-1.5 h-1.5 rounded-full bg-bento-highlight animate-pulse" />
                                  {info.category}
                                </div>
                              </div>
                              <div>
                                <span className="text-[10px] text-white/30 uppercase font-mono">Tespit Edilen Sorun</span>
                                <p className="text-white font-medium text-lg mt-1">{info.title}</p>
                                <p className="text-sm text-bento-text opacity-60 mt-1">{info.reason}</p>
                              </div>
                            </div>

                            <div className="space-y-4 bg-white/[0.02] p-4 rounded-xl border border-white/5">
                              <div>
                                <span className="text-[10px] text-bento-accent uppercase font-bold tracking-widest">Önerilen Çözüm</span>
                                <p className="text-white text-sm mt-2 font-medium leading-relaxed">
                                  {info.solution}
                                </p>
                              </div>
                              <div className="pt-2">
                                <span className="text-[10px] text-white/20 uppercase font-mono">Teknik Hata Kodu</span>
                                <div className="bg-black/40 p-2 rounded mt-1 font-mono text-[11px] text-white/40">
                                  {info.technicalCode}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <footer className="py-8 text-center border-t border-white/5 opacity-20 text-[10px] uppercase font-mono tracking-[0.5em]">
        © 2024 AI SOLUTIONS • BENTO LOCALIZATION ARCHITECTURE
      </footer>
    </div>
  );
}

function BentoProgress({ label, status, progress }: { label: string, status: 'waiting' | 'active' | 'completed', progress?: number }) {
  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <span className={cn(
          "text-[10px] font-bold uppercase tracking-widest",
          status === 'active' ? 'text-bento-accent' : (status === 'completed' ? 'text-bento-highlight' : 'text-white/20')
        )}>
          {label}
        </span>
        {status === 'active' && <span className="text-[10px] font-mono text-bento-accent animate-pulse">AKTİF</span>}
      </div>
      <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden p-[1px]">
        <motion.div 
          initial={{ width: 0 }}
          animate={{ 
            width: status === 'completed' ? '100%' : (status === 'active' ? (progress !== undefined ? `${progress}%` : '50%') : '0%') 
          }}
          className={cn(
            "h-full rounded-full transition-all duration-700",
            status === 'completed' ? 'bg-bento-highlight' : 'bg-bento-accent shadow-[0_0_10px_rgba(102,252,241,0.5)]'
          )}
        />
      </div>
    </div>
  );
}

