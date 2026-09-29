import { apiConfig } from './config.js';
import { createTokenVerifier } from './auth/firebaseAdmin.js';
import { createApp } from './app.js';
import { log } from './logging.js';
import { openDatabase } from './repositories/database.js';
import { TourRepository } from './repositories/tourRepository.js';
import { TourService } from './services/tourService.js';
import { MediaRepository } from './repositories/mediaRepository.js';
import { MediaService } from './services/mediaService.js';
import { S3Storage } from './storage/S3Storage.js';
import { UnderlayRepository } from './repositories/underlayRepository.js';
import { UnderlayService } from './services/underlayService.js';

const config = apiConfig();
const database = openDatabase(config.databasePath);
const storage = new S3Storage(config.bucket, config.region, config.s3Endpoint, config.forcePathStyle);
const media = new MediaService(new MediaRepository(database), storage, config);
const underlays = new UnderlayService(new UnderlayRepository(database), storage, config);
const app = createApp(new TourService(new TourRepository(database)), media, underlays,
  createTokenVerifier(config.projectId), config.webOrigin);
const server = app.listen(config.port, () => {
  log('info', 'api.start', { port: config.port, outcome: 'success' });
  void media.cleanupRetired();
});

function shutdown() {
  server.close(() => {
    database.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
