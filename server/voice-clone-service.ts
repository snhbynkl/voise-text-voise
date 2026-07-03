import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { RuntimeConfig } from './config';
import { errorMessage, JobStore, type JobProgress, type JobRecord } from './job-store';

export interface VoiceClonePayload {
  textPath: string;
  referencePath: string;
}

export interface VoiceCloneResult {
  fileName: string;
  outputUrl: string;
}

export class VoiceCloneQueue {
  private readonly queue: Array<JobRecord<VoiceCloneResult, VoiceClonePayload>> = [];
  private running = false;

  constructor(private readonly store: JobStore, private readonly config: RuntimeConfig) {}

  enqueue(job: JobRecord<VoiceCloneResult, VoiceClonePayload>): void {
    this.queue.push(job);
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length > 0) {
        const job = this.queue.shift();
        if (job) await this.run(job);
      }
    } finally {
      this.running = false;
    }
  }

  private async run(job: JobRecord<VoiceCloneResult, VoiceClonePayload>): Promise<void> {
    const fileName = 'cloned_turkish.wav';
    const outputPath = path.join(this.store.outputDir(job.jobId), fileName);
    try {
      await this.store.update(job.jobId, {
        status: 'running',
        error: undefined,
        progress: {
          stage: 'starting', current: 0, total: 0, percent: 0,
          message: 'Python ses klonlama işlemi başlatılıyor.',
        },
      });
      let progressUpdates = Promise.resolve();
      await runProcess(
        this.config.pythonExe,
        [
          this.config.voiceCloneScript,
          '--text-file', job.payload.textPath,
          '--speaker-wav', job.payload.referencePath,
          '--output-wav', outputPath,
        ],
        this.config.voiceCloneWorkdir,
        {
          ...process.env,
          VOICE_CLONE_MODULE: this.config.voiceCloneModule,
          VOICE_CLONE_WORKDIR: this.config.voiceCloneWorkdir,
          VOICE_CLONE_CHUNK_SIZE: String(this.config.voiceCloneChunkSize),
          VOICE_CLONE_CHUNK_PAUSE_MS: String(this.config.voiceCloneChunkPauseMs),
          VOICE_CLONE_SEED: String(this.config.voiceCloneSeed),
          PYTHONIOENCODING: 'utf-8',
          PYTHONUTF8: '1',
        },
        (progress) => {
          progressUpdates = progressUpdates.then(async () => {
            await this.store.update(job.jobId, { progress });
          });
        },
      );
      await progressUpdates;
      await fs.access(outputPath);
      const finalAdapterProgress = this.store.get(job.jobId)?.progress;
      const finalTotal = finalAdapterProgress?.total || 1;
      await this.store.update(job.jobId, {
        status: 'completed',
        progress: {
          stage: 'completed', current: finalTotal, total: finalTotal, percent: 100,
          message: 'WAV çıktısı hazır.',
        },
        result: {
          fileName,
          outputUrl: `/api/local-voice/output/${job.jobId}/${fileName}`,
        },
      });
      await fs.rm(this.store.uploadDir(job.jobId), { recursive: true, force: true });
    } catch (error) {
      await this.store.update(job.jobId, {
        status: 'failed',
        error: errorMessage(error),
      });
    }
  }
}

function runProcess(
  executable: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  onProgress: (progress: JobProgress) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env, windowsHide: true });
    let stdout = '';
    let stdoutBuffer = '';
    let stderr = '';
    const append = (current: string, data: Buffer): string =>
      `${current}${data.toString()}`.slice(-65_536);

    child.stdout.on('data', (data: Buffer) => {
      stdout = append(stdout, data);
      stdoutBuffer += data.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        const progress = parseProgress(line);
        if (progress) onProgress(progress);
      }
    });
    child.stderr.on('data', (data: Buffer) => { stderr = append(stderr, data); });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(
        `Python ses klonlama işlemi ${code ?? 'bilinmeyen'} koduyla sonlandı.\n${stderr || stdout}`.trim(),
      ));
    });
  });
}

const PROGRESS_PREFIX = 'VOICE_CLONE_EVENT=';

function parseProgress(line: string): JobProgress | null {
  if (!line.startsWith(PROGRESS_PREFIX)) return null;
  try {
    const value = JSON.parse(line.slice(PROGRESS_PREFIX.length)) as Partial<JobProgress>;
    if (
      typeof value.stage !== 'string'
      || typeof value.current !== 'number'
      || typeof value.total !== 'number'
      || typeof value.percent !== 'number'
      || typeof value.message !== 'string'
    ) return null;
    return {
      stage: value.stage,
      current: Math.max(0, Math.trunc(value.current)),
      total: Math.max(0, Math.trunc(value.total)),
      percent: Math.max(0, Math.min(100, Math.round(value.percent))),
      message: value.message.slice(0, 500),
    };
  } catch {
    return null;
  }
}
