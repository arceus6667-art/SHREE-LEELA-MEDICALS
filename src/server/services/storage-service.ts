import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { IStorageService } from '../interfaces/services.ts';

const uploadRoot = path.resolve(process.env.STORAGE_LOCAL_DIR || 'data/uploads');
const allowedExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.pdf']);
const folders = 'prescriptions|store|medicines|partners|invoices|pod';
const fileKeyPattern = new RegExp(`^(?:${folders})/[\\w.-]+\\.(?:jpe?g|png|webp|pdf|bin)$`, 'i');

type Upload = Parameters<IStorageService['saveFile']>[0];

function makeFileKey(params: Upload): string {
  const extension = path.extname(params.originalName).toLowerCase();
  return `${params.folder}/${crypto.randomUUID()}${allowedExtensions.has(extension) ? extension : '.bin'}`;
}

class LocalObjectStorageService implements IStorageService {
  async saveFile(params: Upload) {
    const fileKey = makeFileKey(params);
    const target = path.join(uploadRoot, fileKey);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(target, params.buffer, { flag: 'wx' });
    return { fileKey, publicUrl: `/uploads/${fileKey}` };
  }

  async readFile(fileKey: string): Promise<Buffer | null> {
    if (!fileKeyPattern.test(fileKey)) return null;
    try {
      return await fs.promises.readFile(path.join(uploadRoot, fileKey));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
}

class SupabaseObjectStorageService implements IStorageService {
  private readonly endpoint: URL;
  private readonly headers: Record<string, string>;

  constructor(url: string, private readonly bucket: string, key: string) {
    this.endpoint = new URL(url);
    if (this.endpoint.protocol !== 'https:' || !/^[\w-]+$/.test(bucket) || !key) {
      throw new Error('Set the HTTPS Supabase project URL, private bucket name, and server key.');
    }
    this.headers = key.startsWith('sb_secret_')
      ? { apikey: key }
      : { apikey: key, Authorization: `Bearer ${key}` };
  }

  private objectUrl(fileKey: string, authenticated = false): URL {
    const object = fileKey.split('/').map(encodeURIComponent).join('/');
    return new URL(`/storage/v1/object/${authenticated ? 'authenticated/' : ''}${this.bucket}/${object}`, this.endpoint);
  }

  async saveFile(params: Upload) {
    const fileKey = makeFileKey(params);
    const response = await fetch(this.objectUrl(fileKey), {
      method: 'POST',
      headers: { ...this.headers, 'Content-Type': params.mimeType, 'x-upsert': 'false' },
      body: new Uint8Array(params.buffer),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Storage upload failed (HTTP ${response.status}).`);
    return { fileKey, publicUrl: `/uploads/${fileKey}` };
  }

  async readFile(fileKey: string): Promise<Buffer | null> {
    if (!fileKeyPattern.test(fileKey)) return null;
    const response = await fetch(this.objectUrl(fileKey, true), {
      headers: this.headers,
      signal: AbortSignal.timeout(15000),
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Storage download failed (HTTP ${response.status}).`);
    return Buffer.from(await response.arrayBuffer());
  }
}

export const storageService: IStorageService = process.env.STORAGE_DRIVER === 'supabase'
  ? new SupabaseObjectStorageService(
      process.env.SUPABASE_URL || '',
      process.env.SUPABASE_STORAGE_BUCKET || '',
      process.env.SUPABASE_SECRET_KEY || ''
    )
  : new LocalObjectStorageService();
