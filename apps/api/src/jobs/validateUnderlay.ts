import sharp, { type Metadata } from 'sharp';
import { AppError } from '../errors.js';

const formats: Record<string, string> = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

export async function validateUnderlay(bytes: Buffer, mimeType: string): Promise<{ width: number; height: number }> {
  let metadata: Metadata;
  try { metadata = await sharp(bytes, { limitInputPixels: 100_000_000 }).metadata(); }
  catch { throw new AppError(422, 'INVALID_IMAGE', 'The underlay is not a supported image'); }
  const { width, height, format } = metadata;
  if (!width || !height || !format || formats[format] !== mimeType) {
    throw new AppError(422, 'INVALID_IMAGE', 'The underlay format does not match its file type');
  }
  if (width < 100 || height < 100 || width * height > 100_000_000) {
    throw new AppError(422, 'INVALID_UNDERLAY', 'Use a raster image at least 100 pixels wide and tall');
  }
  return { width, height };
}
