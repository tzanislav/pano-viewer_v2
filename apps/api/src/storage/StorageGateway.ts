export interface StoredObjectInfo {
  byteSize: number;
  mimeType: string;
}

export interface StorageGateway {
  signUpload(objectKey: string, mimeType: string, expiresIn: number): Promise<string>;
  head(objectKey: string): Promise<StoredObjectInfo | null>;
  read(objectKey: string): Promise<Buffer>;
  writeThumbnail(objectKey: string, bytes: Buffer): Promise<void>;
  signRead(objectKey: string, expiresIn: number): Promise<string>;
  delete(objectKey: string): Promise<void>;
}
