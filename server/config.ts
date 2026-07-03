import fs from 'node:fs';
import path from 'node:path';

function resolveFromRoot(value: string | undefined, fallback: string): string {
  return path.resolve(process.cwd(), value?.trim() || fallback);
}

export interface RuntimeConfig {
  dataDir: string;
  geminiApiKey: string;
  port: number;
  pythonExe: string;
  voiceCloneModule: string;
  voiceCloneScript: string;
  voiceCloneWorkdir: string;
}

export function loadRuntimeConfig(): RuntimeConfig {
  const workdir = resolveFromRoot(process.env.VOICE_CLONE_WORKDIR, '.');
  const configuredModule = process.env.VOICE_CLONE_MODULE?.trim();
  const port = Number.parseInt(process.env.PORT || '3000', 10);

  return {
    dataDir: resolveFromRoot(process.env.DATA_DIR, 'data'),
    geminiApiKey: (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim(),
    port: Number.isInteger(port) && port > 0 && port <= 65_535 ? port : 3000,
    pythonExe: process.env.VOICE_CLONE_PYTHON_EXE?.trim() || 'python',
    voiceCloneModule: configuredModule
      ? path.resolve(configuredModule)
      : path.join(workdir, 'clone_voice.py'),
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
