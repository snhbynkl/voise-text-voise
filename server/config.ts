import fs from 'node:fs';
import path from 'node:path';

function resolveFromRoot(value: string | undefined, fallback: string): string {
  return path.resolve(process.cwd(), value?.trim() || fallback);
}

function resolveExecutable(value: string | undefined, fallback: string): string {
  const executable = value?.trim() || fallback;
  return path.isAbsolute(executable) || /[\\/]/.test(executable)
    ? path.resolve(process.cwd(), executable)
    : executable;
}

export interface RuntimeConfig {
  dataDir: string;
  geminiApiKey: string;
  port: number;
  pythonExe: string;
  voiceCloneModule: string;
  voiceCloneChunkPauseMs: number;
  voiceCloneChunkSize: number;
  voiceCloneDevice: string;
  voiceCloneModel: string;
  voiceCloneSeed: number;
  voiceCloneScript: string;
  voiceCloneWorkdir: string;
}

function boundedInt(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

export function loadRuntimeConfig(): RuntimeConfig {
  const workdir = resolveFromRoot(process.env.VOICE_CLONE_WORKDIR, 'python/voice_clone');
  const configuredModule = process.env.VOICE_CLONE_MODULE?.trim();
  const port = Number.parseInt(process.env.PORT || '3000', 10);
  const defaultPython = process.platform === 'win32'
    ? '.venv/Scripts/python.exe'
    : '.venv/bin/python';
  const configuredDevice = process.env.VOICE_CLONE_DEVICE?.trim().toLowerCase();

  return {
    dataDir: resolveFromRoot(process.env.DATA_DIR, 'data'),
    geminiApiKey: (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim(),
    port: Number.isInteger(port) && port > 0 && port <= 65_535 ? port : 3000,
    pythonExe: resolveExecutable(process.env.VOICE_CLONE_PYTHON_EXE, defaultPython),
    voiceCloneModule: configuredModule
      ? path.resolve(configuredModule)
      : path.join(workdir, 'clone_voice.py'),
    voiceCloneChunkPauseMs: boundedInt(process.env.VOICE_CLONE_CHUNK_PAUSE_MS, 180, 0, 2_000),
    voiceCloneChunkSize: boundedInt(process.env.VOICE_CLONE_CHUNK_SIZE, 220, 80, 2_000),
    voiceCloneDevice: configuredDevice && ['auto', 'cpu', 'cuda'].includes(configuredDevice)
      ? configuredDevice
      : 'auto',
    voiceCloneModel: process.env.VOICE_CLONE_MODEL?.trim()
      || 'tts_models/multilingual/multi-dataset/xtts_v2',
    voiceCloneSeed: boundedInt(process.env.VOICE_CLONE_SEED, 0, 0, 2_147_483_647),
    voiceCloneScript: resolveFromRoot(
      process.env.VOICE_CLONE_SCRIPT,
      'scripts/run_clone_voice_module.py',
    ),
    voiceCloneWorkdir: workdir,
  };
}

export function fileExists(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}
