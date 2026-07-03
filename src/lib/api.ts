export type JobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface JobProgress {
  stage: string;
  current: number;
  total: number;
  percent: number;
  message: string;
}

export interface ProcessResult {
  originalTranscription: string;
  turkishTranslation: string;
}

export interface VoiceCloneResult {
  fileName: string;
  outputUrl: string;
}

interface JobCreated {
  jobId: string;
  status: JobStatus;
  statusUrl: string;
}

interface JobResponse<TResult> {
  jobId: string;
  status: JobStatus;
  error?: string;
  progress?: JobProgress;
  result?: TResult;
}

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body as T;
}

export async function createGeminiJob(media: File): Promise<JobCreated> {
  const form = new FormData();
  form.append('media', media);
  return jsonRequest<JobCreated>('/api/gemini/jobs', { method: 'POST', body: form });
}

export async function createVoiceCloneJob(
  text: string,
  referenceAudio: File,
): Promise<JobCreated> {
  const form = new FormData();
  form.append('text', text);
  form.append('referenceAudio', referenceAudio);
  return jsonRequest<JobCreated>('/api/local-voice/clone', { method: 'POST', body: form });
}

export async function waitForJob<TResult>(
  statusUrl: string,
  signal: AbortSignal,
  onUpdate?: (job: JobResponse<TResult>) => void,
): Promise<TResult> {
  while (true) {
    const job = await jsonRequest<JobResponse<TResult>>(statusUrl, { signal });
    onUpdate?.(job);
    if (job.status === 'completed' && job.result) return job.result;
    if (job.status === 'failed') throw new Error(job.error || 'Arka plan işi başarısız oldu.');
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        window.clearTimeout(timeout);
        reject(new DOMException('İşlem iptal edildi.', 'AbortError'));
      };
      const timeout = window.setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, 2_000);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}
