import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Express, RequestHandler } from 'express';
import express from 'express';
import multer from 'multer';
import type { RuntimeConfig } from './config';
import { fileExists } from './config';
import { GeminiJobRunner, type GeminiResult } from './gemini-service';
import { JobStore } from './job-store';
import {
  VoiceCloneQueue,
  type VoiceClonePayload,
  type VoiceCloneResult,
} from './voice-clone-service';

const MEDIA_EXTENSIONS = new Set([
  '.mp3', '.mp4', '.mpeg', '.mpg', '.wav', '.ogg', '.flac', '.m4a', '.webm', '.mov', '.avi',
]);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.webm']);

function diskUpload(
  store: JobStore,
  fieldName: string,
  maxBytes: number,
  allowedExtensions: Set<string>,
  allowedMimePrefix: RegExp,
): RequestHandler {
  const upload = multer({
    storage: multer.diskStorage({
      destination: store.uploadsDir,
      filename: (_request, file, callback) => {
        callback(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`);
      },
    }),
    limits: { fileSize: maxBytes, fieldSize: 10 * 1024 * 1024, files: 1 },
    fileFilter: (_request, file, callback) => {
      const extensionAllowed = allowedExtensions.has(path.extname(file.originalname).toLowerCase());
      const mimeAllowed = allowedMimePrefix.test(file.mimetype);
      callback(null, extensionAllowed && mimeAllowed);
    },
  });
  return upload.single(fieldName);
}

export async function registerApi(app: Express, config: RuntimeConfig): Promise<void> {
  const store = new JobStore(config.dataDir);
  await store.initialize();
  const gemini = new GeminiJobRunner(store, config);
  const voiceQueue = new VoiceCloneQueue(store, config);
  const geminiUpload = diskUpload(
    store,
    'media',
    2 * 1024 ** 3,
    MEDIA_EXTENSIONS,
    /^(audio|video)\//,
  );
  const voiceUpload = diskUpload(
    store,
    'referenceAudio',
    100 * 1024 ** 2,
    AUDIO_EXTENSIONS,
    /^audio\//,
  );

  app.get('/api/health', (_request, response) => {
    const ffmpegAvailable = spawnSync('ffmpeg', ['-version'], {
      windowsHide: true,
      stdio: 'ignore',
    }).status === 0;
    const pythonAvailable = spawnSync(config.pythonExe, ['--version'], {
      windowsHide: true,
      stdio: 'ignore',
    }).status === 0;
    response.json({
      status: 'ok',
      geminiConfigured: Boolean(config.geminiApiKey),
      voiceClone: {
        scriptConfigured: fileExists(config.voiceCloneScript),
        scriptPath: config.voiceCloneScript,
        pythonExe: config.pythonExe,
        pythonAvailable,
        workdir: config.voiceCloneWorkdir,
        modulePath: config.voiceCloneModule,
        moduleConfigured: fileExists(config.voiceCloneModule),
        ffmpegAvailable,
        longForm: {
          chunkSize: config.voiceCloneChunkSize,
          pauseMs: config.voiceCloneChunkPauseMs,
          seed: config.voiceCloneSeed,
          device: config.voiceCloneDevice,
          model: config.voiceCloneModel,
        },
        coquiTermsAccepted: process.env.COQUI_TOS_AGREED?.trim() === '1',
      },
    });
  });

  app.post('/api/gemini/jobs', geminiUpload, async (request, response, next) => {
    let createdJobId: string | undefined;
    try {
      if (!request.file) {
        response.status(400).json({ error: 'Desteklenen bir ses veya video dosyası gereklidir.' });
        return;
      }
      const job = await store.create<GeminiResult, { mediaPath: string; mimeType: string }>(
        'gemini',
        { mediaPath: '', mimeType: request.file.mimetype },
      );
      createdJobId = job.jobId;
      const mediaPath = path.join(store.uploadDir(job.jobId), path.basename(request.file.path));
      await fs.rename(request.file.path, mediaPath);
      const updatedJob = await store.update<GeminiResult, { mediaPath: string; mimeType: string }>(
        job.jobId,
        { payload: { mediaPath, mimeType: request.file.mimetype } },
      );
      gemini.start(updatedJob);
      response.status(202).json({
        jobId: job.jobId,
        status: job.status,
        statusUrl: `/api/gemini/jobs/${job.jobId}`,
      });
    } catch (error) {
      if (request.file) await fs.rm(request.file.path, { force: true }).catch(() => undefined);
      if (createdJobId) {
        await store.update(createdJobId, {
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        }).catch(() => undefined);
      }
      next(error);
    }
  });

  app.get('/api/gemini/jobs/:jobId', (request, response) => {
    const job = store.public<GeminiResult>(request.params.jobId);
    if (!job || job.type !== 'gemini') {
      response.status(404).json({ error: 'Gemini işi bulunamadı.' });
      return;
    }
    response.json(job);
  });

  app.post('/api/local-voice/clone', voiceUpload, async (request, response, next) => {
    let createdJobId: string | undefined;
    try {
      const text = typeof request.body.text === 'string' ? request.body.text.trim() : '';
      if (!request.file || !text) {
        if (request.file) await fs.rm(request.file.path, { force: true });
        response.status(400).json({ error: 'text ve desteklenen referenceAudio alanları gereklidir.' });
        return;
      }
      const job = await store.create<VoiceCloneResult, VoiceClonePayload>(
        'voice-clone',
        { textPath: '', referencePath: '' },
      );
      createdJobId = job.jobId;
      const referencePath = path.join(store.uploadDir(job.jobId), path.basename(request.file.path));
      const textPath = path.join(store.outputDir(job.jobId), 'input_tr.txt');
      await fs.rename(request.file.path, referencePath);
      await fs.writeFile(textPath, text, 'utf8');
      const updatedJob = await store.update<VoiceCloneResult, VoiceClonePayload>(job.jobId, {
        payload: { textPath, referencePath },
      });
      voiceQueue.enqueue(updatedJob);
      response.status(202).json({
        jobId: job.jobId,
        status: job.status,
        statusUrl: `/api/local-voice/jobs/${job.jobId}`,
      });
    } catch (error) {
      if (request.file) await fs.rm(request.file.path, { force: true }).catch(() => undefined);
      if (createdJobId) {
        await store.update(createdJobId, {
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        }).catch(() => undefined);
      }
      next(error);
    }
  });

  app.get('/api/local-voice/jobs/:jobId', (request, response) => {
    const job = store.public<VoiceCloneResult>(request.params.jobId);
    if (!job || job.type !== 'voice-clone') {
      response.status(404).json({ error: 'Ses klonlama işi bulunamadı.' });
      return;
    }
    response.json(job);
  });

  app.get('/api/local-voice/output/:jobId/:fileName', (request, response) => {
    const job = store.public<VoiceCloneResult>(request.params.jobId);
    if (
      !job
      || job.type !== 'voice-clone'
      || job.status !== 'completed'
      || job.result?.fileName !== request.params.fileName
    ) {
      response.status(404).json({ error: 'Ses çıktısı bulunamadı.' });
      return;
    }
    const outputPath = path.join(store.outputDir(job.jobId), job.result.fileName);
    response.type('audio/wav').sendFile(outputPath);
  });

  app.use('/api', express.json(), (_request, response) => {
    response.status(404).json({ error: 'API endpoint bulunamadı.' });
  });
}
