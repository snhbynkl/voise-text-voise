import { GoogleGenAI, Modality } from "@google/genai";

let aiInstance: GoogleGenAI | null = null;

function getAiClient(): GoogleGenAI {
  if (!aiInstance) {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not configured. Please add your API key to the project secrets.');
    }
    aiInstance = new GoogleGenAI({ apiKey });
  }
  return aiInstance;
}

export interface ProcessResult {
  originalTranscription: string;
  turkishTranslation: string;
}

async function waitForFileActive(name: string): Promise<void> {
  const ai = getAiClient();
  try {
    console.log(`Waiting for file to be active: ${name}`);
    let file = await ai.files.get({ name });
    
    // Polling loop (max ~10 minutes for very long 3-hour videos)
    let attempts = 0;
    while (file.state === 'PROCESSING' && attempts < 200) {
      console.log(`File state: PROCESSING (Attempt ${attempts + 1})`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
      file = await ai.files.get({ name });
      attempts++;
    }
    
    if (file.state === 'FAILED') {
      throw new Error("Dosya işleme hatası: Yapay zeka dosyayı analiz edemedi.");
    }
    
    if (file.state !== 'ACTIVE') {
      throw new Error(`Dosya aktifleşmedi. Mevcut durum: ${file.state}`);
    }
    
    console.log('File is now ACTIVE and ready for generation.');
  } catch (error: any) {
    console.error("waitForFileActive error:", error);
    throw error;
  }
}

export async function uploadToGemini(file: File): Promise<any> {
  const ai = getAiClient();
  console.log(`Uploading file to Gemini directly: ${file.name}`);
  
  const uploadResult = await ai.files.upload({
    file: file,
    config: {
      mimeType: file.type,
      displayName: file.name,
    }
  });
  
  return uploadResult;
}

export async function processAudio(fileUri: string, mimeType: string, fileName?: string): Promise<ProcessResult> {
  const ai = getAiClient();
  // If we have the resource name (e.g., files/abc123), we should wait for it to be active
  if (fileName) {
    await waitForFileActive(fileName);
  }

  const result = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: [
      {
        parts: [
          {
            fileData: {
              fileUri: fileUri,
              mimeType: mimeType,
            },
          },
          {
            text: `Görev: Profesyonel Rusça-Türkçe Lokalizasyonu.
            Adım 1 - Girdi İşleme: Sesi gürültüden arındır ve akustik analizi yap.
            Adım 2 - Transkripsiyon: Orijinal konuşmayı yüksek doğrulukla yazıya dök.
            Adım 3 - LLM Destekli Çeviri: Metni bir 'Eğitimci Personası' ile Türkçe'ye çevir. 
            Önemli: Çeviri kelimesi kelimesine olmamalı, bir Türk eğitmenin ağzından çıkacak kadar doğal, akıcı ve seslendirmeye uygun (akustik uyumlu) olmalıdır. 
            
            Çıktıyı kesinlikle şu JSON formatında ver:
            {
              "originalTranscription": "...",
              "turkishTranslation": "..."
            }`,
          },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
    },
  });

  return JSON.parse(result.text) as ProcessResult;
}

export async function generateTurkishSpeech(text: string): Promise<string> {
  const ai = getAiClient();
  const response = await ai.models.generateContent({
    model: "gemini-3.1-flash-tts-preview",
    contents: [{ parts: [{ text: `Bir profesyonel Türk eğitimci tonuyla, akıcı ve tane tane seslendir: ${text}` }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Kore' }, // 'Kore' is a good neutral/professional voice
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) throw new Error("Ses üretilemedi.");
  
  return base64Audio;
}
