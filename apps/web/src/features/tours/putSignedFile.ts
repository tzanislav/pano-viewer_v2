export function putSignedFile(url: string, file: File, mimeType: string,
  onProgress?: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', url);
    request.setRequestHeader('Content-Type', mimeType);
    request.upload.onprogress = event => {
      if (event.lengthComputable) onProgress?.(Math.round(event.loaded / event.total * 100));
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error(`Image transfer failed (${request.status}). Check storage CORS and try again.`));
    };
    request.onerror = () => reject(new Error('Image transfer failed. Check your connection and storage CORS.'));
    request.send(file);
  });
}
