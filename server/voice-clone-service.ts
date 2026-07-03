import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { RuntimeConfig } from './config';
import { errorMessage, JobStore, type JobRecord } from './job-store';

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
      await this.store.update(job.jobId, { status: 'running', error: undefined });
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
        },
      );
      await fs.access(outputPath);
      await this.store.update(job.jobId, {
        status: 'completed',
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
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env, windowsHide: true });
    let stdout = '';
    let stderr = '';
    const append = (current: string, data: Buffer): string =>
      `${current}${data.toString()}`.slice(-65_536);

    child.stdout.on('data', (data: Buffer) => { stdout = append(stdout, data); });
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
