import type Database from 'better-sqlite3';

const firstSchema = `
CREATE TABLE tours (
  id TEXT PRIMARY KEY,
  owner_uid TEXT NOT NULL,
  title TEXT NOT NULL,
  entry_scene_id TEXT,
  default_north_yaw_deg REAL NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (id, owner_uid)
);
CREATE INDEX tours_owner_uid_idx ON tours(owner_uid);

CREATE TABLE media_assets (
  id TEXT PRIMARY KEY,
  tour_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('panorama', 'plan')),
  object_key TEXT NOT NULL UNIQUE,
  thumbnail_key TEXT,
  mime_type TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  byte_size INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('uploading', 'processing', 'ready', 'error')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (id, tour_id),
  FOREIGN KEY (tour_id) REFERENCES tours(id) ON DELETE CASCADE
);

CREATE TABLE pages (
  id TEXT PRIMARY KEY,
  tour_id TEXT NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  north_angle_deg REAL NOT NULL DEFAULT 0,
  plan_asset_id TEXT,
  plan_x REAL NOT NULL DEFAULT 0,
  plan_y REAL NOT NULL DEFAULT 0,
  plan_scale REAL NOT NULL DEFAULT 1,
  plan_rotation_deg REAL NOT NULL DEFAULT 0,
  UNIQUE (id, tour_id),
  FOREIGN KEY (tour_id) REFERENCES tours(id) ON DELETE CASCADE,
  FOREIGN KEY (plan_asset_id, tour_id) REFERENCES media_assets(id, tour_id)
);
CREATE INDEX pages_tour_order_idx ON pages(tour_id, sort_order);

CREATE TABLE scenes (
  id TEXT PRIMARY KEY,
  tour_id TEXT NOT NULL,
  panorama_asset_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  north_yaw_override_deg REAL,
  UNIQUE (id, tour_id),
  FOREIGN KEY (tour_id) REFERENCES tours(id) ON DELETE CASCADE,
  FOREIGN KEY (panorama_asset_id, tour_id) REFERENCES media_assets(id, tour_id)
);

CREATE TABLE placements (
  id TEXT PRIMARY KEY,
  tour_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  scene_id TEXT NOT NULL UNIQUE,
  x REAL NOT NULL CHECK (x >= 0 AND x <= 1000),
  y REAL NOT NULL CHECK (y >= 0 AND y <= 1000),
  UNIQUE (id, tour_id),
  FOREIGN KEY (tour_id) REFERENCES tours(id) ON DELETE CASCADE,
  FOREIGN KEY (page_id, tour_id) REFERENCES pages(id, tour_id) ON DELETE CASCADE,
  FOREIGN KEY (scene_id, tour_id) REFERENCES scenes(id, tour_id) ON DELETE CASCADE
);

CREATE TABLE plan_connections (
  id TEXT PRIMARY KEY,
  tour_id TEXT NOT NULL,
  placement_a_id TEXT NOT NULL,
  placement_b_id TEXT NOT NULL,
  CHECK (placement_a_id < placement_b_id),
  UNIQUE (tour_id, placement_a_id, placement_b_id),
  UNIQUE (id, tour_id),
  FOREIGN KEY (tour_id) REFERENCES tours(id) ON DELETE CASCADE,
  FOREIGN KEY (placement_a_id, tour_id) REFERENCES placements(id, tour_id) ON DELETE CASCADE,
  FOREIGN KEY (placement_b_id, tour_id) REFERENCES placements(id, tour_id) ON DELETE CASCADE
);

CREATE TABLE navigation_links (
  id TEXT PRIMARY KEY,
  tour_id TEXT NOT NULL,
  source_scene_id TEXT NOT NULL,
  target_scene_id TEXT NOT NULL,
  plan_connection_id TEXT,
  position_mode TEXT NOT NULL CHECK (position_mode IN ('auto', 'manual')),
  manual_yaw_deg REAL,
  manual_pitch_deg REAL,
  CHECK (source_scene_id <> target_scene_id),
  CHECK ((position_mode = 'auto' AND plan_connection_id IS NOT NULL AND manual_yaw_deg IS NULL AND manual_pitch_deg IS NULL)
     OR (position_mode = 'manual' AND manual_yaw_deg IS NOT NULL AND manual_pitch_deg BETWEEN -90 AND 90)),
  UNIQUE (tour_id, source_scene_id, target_scene_id),
  FOREIGN KEY (tour_id) REFERENCES tours(id) ON DELETE CASCADE,
  FOREIGN KEY (source_scene_id, tour_id) REFERENCES scenes(id, tour_id) ON DELETE CASCADE,
  FOREIGN KEY (target_scene_id, tour_id) REFERENCES scenes(id, tour_id) ON DELETE CASCADE,
  FOREIGN KEY (plan_connection_id, tour_id) REFERENCES plan_connections(id, tour_id) ON DELETE CASCADE
);
`;

const uploadSchema = `
ALTER TABLE media_assets ADD COLUMN original_filename TEXT;
ALTER TABLE media_assets ADD COLUMN filename_key TEXT;
ALTER TABLE media_assets ADD COLUMN error_code TEXT;
ALTER TABLE media_assets ADD COLUMN replaces_scene_id TEXT;
ALTER TABLE media_assets ADD COLUMN retired_at TEXT;
CREATE INDEX media_assets_filename_idx ON media_assets(tour_id, filename_key, status);
CREATE INDEX media_assets_retired_idx ON media_assets(retired_at);
`;

export function runMigrations(db: Database.Database): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const version = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number | null };
  if (version.version !== null && version.version > 2) throw new Error('Database schema is newer than this app');
  if (version.version === null) {
    db.transaction(() => {
      db.exec(firstSchema);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)').run(new Date().toISOString());
    })();
  }
  if (version.version === null || version.version === 1) {
    db.transaction(() => {
      db.exec(uploadSchema);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (2, ?)').run(new Date().toISOString());
    })();
  }
}
