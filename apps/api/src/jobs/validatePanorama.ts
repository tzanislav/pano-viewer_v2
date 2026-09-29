import sharp, { type Metadata } from 'sharp';
import { AppError } from '../errors.js';

const formats: Record<string, string> = {
  jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp'
};

export async function validatePanorama(bytes: Buffer, claimedMimeType: string): Promise<{
  width: number; height: number; thumbnail: Buffer;
}> {
  let metadata: Metadata;
  try {
    metadata = await sharp(bytes, { limitInputPixels: 100_000_000 }).metadata();
  } catch {
    throw new AppError(422, 'INVALID_IMAGE', 'The file is not a supported image');
  }
  const { width, height, format } = metadata;
  if (!width || !height || !format || formats[format] !== claimedMimeType) {
    throw new AppError(422, 'INVALID_IMAGE', 'The image format does not match the uploaded file type');
  }
  if (width < 1024 || height < 512 || width * height > 100_000_000 || width / height < 1.8 || width / height > 2.2) {
    throw new AppError(422, 'INVALID_PANORAMA', 'Use a 2:1 equirectangular photo of at least 1024 × 512 pixels');
  }
  try {
    const thumbnail = await sharp(bytes, { limitInputPixels: 100_000_000 })
      .resize(400, 200, { fit: 'cover' }).jpeg({ quality: 78 }).toBuffer();
    return { width, height, thumbnail };
  } catch {
    throw new AppError(422, 'INVALID_IMAGE', 'Could not process this image');
  }
}
