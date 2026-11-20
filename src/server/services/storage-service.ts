import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { IStorageService } from '../interfaces/services.ts';

const UPLOAD_ROOT = path.resolve(process.cwd(), 'data', 'uploads');

export class LocalObjectStorageService implements IStorageService {
  constructor() {
    fs.mkdirSync(path.join(UPLOAD_ROOT, 'prescriptions'), { recursive: true });
    fs.mkdirSync(path.join(UPLOAD_ROOT, 'store'), { recursive: true });
    fs.mkdirSync(path.join(UPLOAD_ROOT, 'medicines'), { recursive: true });
    fs.mkdirSync(path.join(UPLOAD_ROOT, 'partners'), { recursive: true });
    fs.mkdirSync(path.join(UPLOAD_ROOT, 'invoices'), { recursive: true });
    fs.mkdirSync(path.join(UPLOAD_ROOT, 'pod'), { recursive: true });
  }

  async saveFile(params: {
    folder: 'prescriptions' | 'store' | 'medicines' | 'partners' | 'invoices' | 'pod';
    originalName: string;
    mimeType: string;
    buffer: Buffer;
  }): Promise<{ fileKey: string; publicUrl: string }> {
    const ext = path.extname(params.originalName || '').toLowerCase().replace(/[^.a-z0-9]/g, '') || '.bin';
    const allowedExts = ['.jpg', '.jpeg', '.png', '.webp', '.pdf', '.svg'];
    const safeExt = allowedExts.includes(ext) ? ext : '.bin';
    const uniqueName = `${Date.now()}_${crypto.randomUUID()}${safeExt}`;
    const fileKey = `${params.folder}/${uniqueName}`;
    const targetPath = path.join(UPLOAD_ROOT, params.folder, uniqueName);
    await fs.promises.writeFile(targetPath, params.buffer);
    return {
      fileKey,
      publicUrl: `/uploads/${fileKey}`,
    };
  }

  getAbsolutePath(fileKey: string): string | null {
    const normalized = path.normalize(fileKey).replace(/^(\.\.[/\\])+/, '');
    const fullPath = path.join(UPLOAD_ROOT, normalized);
    if (!fullPath.startsWith(UPLOAD_ROOT)) {
      return null;
    }
    if (!fs.existsSync(fullPath)) {
      return null;
    }
    return fullPath;
  }
}

export const storageService = new LocalObjectStorageService();
