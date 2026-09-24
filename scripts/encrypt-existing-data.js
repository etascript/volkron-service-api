import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../src/config.js';
import { decryptRecord, encryptRecord } from '../src/backups.js';

async function jsonlFiles(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map((entry) => path.join(dir, entry.name));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function encryptFile(filePath) {
  const raw = await readFile(filePath, 'utf8');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return { filePath, count: 0 };

  const records = lines.map((line) => decryptRecord(line));
  const encrypted = records.map((record) => JSON.stringify(encryptRecord(record))).join('\n') + '\n';
  const backupPath = `${filePath}.bak-${Date.now()}`;

  await copyFile(filePath, backupPath);
  await writeFile(filePath, encrypted, 'utf8');

  return { filePath, backupPath, count: records.length };
}

const statusDir = path.dirname(config.statusEventsFile);
await mkdir(config.backupDir, { recursive: true });
await mkdir(statusDir, { recursive: true });

const files = [
  ...(await jsonlFiles(config.backupDir)),
  config.statusEventsFile,
];

for (const filePath of files) {
  try {
    const result = await encryptFile(filePath);
    if (result.count) {
      console.log(`encrypted ${result.count} lines: ${result.filePath}`);
      console.log(`backup: ${result.backupPath}`);
    }
  } catch (error) {
    if (error.code === 'ENOENT') continue;
    throw error;
  }
}
