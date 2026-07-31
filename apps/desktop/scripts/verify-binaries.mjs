import { access } from 'node:fs/promises';
import { join } from 'node:path';

const executable = process.platform === 'win32' ? '.exe' : '';
const required = ['mpv', 'ffmpeg', 'ffprobe'].map((name) =>
  join('resources', 'bin', name, `${name}${executable}`),
);

const missing = [];
for (const path of required) {
  try {
    await access(path);
  } catch {
    missing.push(path);
  }
}

if (missing.length > 0) {
  console.error(`Binários ausentes:\n${missing.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log('mpv, FFmpeg e FFprobe disponíveis.');
}

