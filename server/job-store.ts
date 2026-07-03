import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed';
export type JobType = 'gemini' | 'voice-clone';

export interface JobRecord<TResult = unknown, TPayload = unknown> {
  jobId: string;
  type: JobType;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  error?: string;
  result?: TResult;
  payload?: TPayload;
}

export type PublicJob<TResult = unknown> = Omit<JobRecord<TResult>, 'payload'>;

export class JobStore {
  readonly uploadsDir: string;
  readonly outputsDir: string;
  private readonly jobs = new Map<string, JobRecord>();

  constructor(readonly dataDir: string) {
    this.uploadsDir = path.join(dataDir, 'uploads');
    this.outputsDir = path.join(dataDir, 'outputs');
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.uploadsDir, { recursive: true });
    await fs.mkdir(this.outputsDir, { recursive: true });

    for (const entry of await fs.readdir(this.outputsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const metadataPath = path.join(this.outputsDir, entry.name, 'job.json');
      try {
        const job = JSON.parse(await fs.readFile(metadataPath, 'utf8')) as JobRecord;
        if (job.jobId !== entry.name) continue;
        this.jobs.set(job.jobId, job);
        if (job.status === 'queued' || job.status === 'running') {
          await this.update(job.jobId, {
            status: 'failed',
            error: 'Sunucu yeniden başlatıldığı için yarım kalan iş durduruldu.',
          });
        }
      } catch {
        // Ignore unrelated or corrupt directories. They are never exposed as jobs.
      }
    }
  }

  async create<TResult = unknown, TPayload = unknown>(
    type: JobType,
    payload: TPayload,
  ): Promise<JobRecord<TResult, TPayload>> {
    const now = new Date().toISOString();
    const job: JobRecord<TResult, TPayload> = {
      jobId: randomUUID(),
      type,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
      payload,
    };
    await fs.mkdir(this.uploadDir(job.jobId), { recursive: true });
    await fs.mkdir(this.outputDir(job.jobId), { recursive: true });
    this.jobs.set(job.jobId, job);
    await this.persist(job);
    return job;
  }

  get<TResult = unknown, TPayload = unknown>(jobId: string): JobRecord<TResult, TPayload> | undefined {
    return this.jobs.get(jobId) as JobRecord<TResult, TPayload> | undefined;
  }

  public<TResult = unknown>(jobId: string): PublicJob<TResult> | undefined {
    const job = this.get<TResult>(jobId);
    if (!job) return undefined;
    const { payload: _payload, ...publicJob } = job;
    return publicJob;
  }

  async update<TResult = unknown, TPayload = unknown>(
    jobId: string,
    changes: Partial<Omit<JobRecord<TResult, TPayload>, 'jobId' | 'type' | 'createdAt'>>,
  ): Promise<JobRecord<TResult, TPayload>> {
    const current = this.get<TResult, TPayload>(jobId);
    if (!current) throw new Error(`Unknown job: ${jobId}`);
    const next = {
      ...current,
      ...changes,
      updatedAt: new Date().toISOString(),
    };
    this.jobs.set(jobId, next);
    await this.persist(next);
    return next;
  }

  uploadDir(jobId: string): string {
    return path.join(this.uploadsDir, jobId);
  }

  outputDir(jobId: string): string {
    return path.join(this.outputsDir, jobId);
  }

  private async persist(job: JobRecord): Promise<void> {
    const outputDir = this.outputDir(job.jobId);
    await fs.mkdir(outputDir, { recursive: true });
    const metadataPath = path.join(outputDir, 'job.json');
    const temporaryPath = `${metadataPath}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(job, null, 2)}\n`, 'utf8');
    await fs.rename(temporaryPath, metadataPath);
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
