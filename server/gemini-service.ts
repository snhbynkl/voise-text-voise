import fs from 'node:fs/promises';
import path from 'node:path';
import { GoogleGenAI, createPartFromUri, createUserContent } from '@google/genai';
import type { RuntimeConfig } from './config';
import { errorMessage, JobStore, type JobRecord } from './job-store';

export interface GeminiResult {
  originalTranscription: string;
  turkishTranslation: string;
}

export interface GeminiPayload {
  mediaPath: string;
  mimeType: string;
}

const PROMPT = `Görev: Profesyonel Rusça-Türkçe lokalizasyonu.
1. Orijinal Rusça konuşmayı yüksek doğrulukla yazıya dök.
2. Metni doğal, akıcı ve seslendirmeye uygun Türkçeye çevir.
3. Çıktıyı yalnızca şu JSON yapısında ver:
{"originalTranscription":"...","turkishTranslation":"..."}`;

export class GeminiJobRunner {
  private readonly client: GoogleGenAI | null;

  constructor(private readonly store: JobStore, config: RuntimeConfig) {
    this.client = config.geminiApiKey
      ? new GoogleGenAI({ apiKey: config.geminiApiKey })
      : null;
  }

  start(job: JobRecord<GeminiResult, GeminiPayload>): void {
    void this.run(job);
  }

  private async run(job: JobRecord<GeminiResult, GeminiPayload>): Promise<void> {
    let remoteFileName: string | undefined;
    try {
      if (!this.client) throw new Error('GEMINI_API_KEY yapılandırılmamış.');
      await this.store.update(job.jobId, { status: 'running', error: undefined });

      let remoteFile = await this.client.files.upload({
        file: job.payload.mediaPath,
        config: { mimeType: job.payload.mimeType },
      });
      remoteFileName = remoteFile.name;

      for (let attempt = 0; remoteFile.state?.toString() !== 'ACTIVE'; attempt += 1) {
        if (remoteFile.state?.toString() === 'FAILED') {
          throw new Error('Gemini yüklenen medya dosyasını işleyemedi.');
        }
        if (attempt >= 200) throw new Error('Gemini dosya hazırlama zaman aşımına uğradı.');
        if (!remoteFile.name) throw new Error('Gemini dosya kimliği döndürmedi.');
        await new Promise((resolve) => setTimeout(resolve, 3_000));
        remoteFile = await this.client.files.get({ name: remoteFile.name });
      }

      if (!remoteFile.uri || !remoteFile.mimeType) {
        throw new Error('Gemini dosya URI veya MIME türü döndürmedi.');
      }

      const response = await this.client.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: createUserContent([
          createPartFromUri(remoteFile.uri, remoteFile.mimeType),
          PROMPT,
        ]),
        config: { responseMimeType: 'application/json' },
      });
      const parsed = JSON.parse(response.text || '{}') as Partial<GeminiResult>;
      if (
        typeof parsed.originalTranscription !== 'string'
        || typeof parsed.turkishTranslation !== 'string'
      ) {
        throw new Error('Gemini beklenen çeviri JSON kontratını döndürmedi.');
      }

      const result: GeminiResult = {
        originalTranscription: parsed.originalTranscription,
        turkishTranslation: parsed.turkishTranslation,
      };
      await Promise.all([
        fs.writeFile(
          path.join(this.store.outputDir(job.jobId), 'original_ru.txt'),
          result.originalTranscription,
          'utf8',
        ),
        fs.writeFile(
          path.join(this.store.outputDir(job.jobId), 'translation_tr.txt'),
          result.turkishTranslation,
          'utf8',
        ),
      ]);
      await this.store.update(job.jobId, { status: 'completed', result });
      await fs.rm(this.store.uploadDir(job.jobId), { recursive: true, force: true });
    } catch (error) {
      await this.store.update(job.jobId, {
        status: 'failed',
        error: errorMessage(error),
      });
    } finally {
      if (this.client && remoteFileName) {
        await this.client.files.delete({ name: remoteFileName }).catch(() => undefined);
      }
    }
  }
}
