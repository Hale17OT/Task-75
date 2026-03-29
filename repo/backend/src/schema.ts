export const schemaStatements = `
CREATE TABLE IF NOT EXISTS users (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  username VARCHAR(100) NOT NULL UNIQUE,
  full_name VARCHAR(200) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  phone_encrypted TEXT NULL,
  phone_key_id VARCHAR(100) NULL,
  phone_last4 VARCHAR(4) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id BIGINT NOT NULL,
  role_name VARCHAR(32) NOT NULL,
  PRIMARY KEY (user_id, role_name),
  CONSTRAINT fk_user_roles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pin_credentials (
  user_id BIGINT PRIMARY KEY,
  pin_hash VARCHAR(255) NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pin_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sessions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  session_token VARCHAR(255) NOT NULL UNIQUE,
  session_secret VARCHAR(255) NOT NULL,
  session_secret_key_id VARCHAR(100) NOT NULL DEFAULT 'legacy',
  station_token VARCHAR(100) NOT NULL DEFAULT 'Unknown-Station',
  workstation_binding_hash VARCHAR(255) NULL,
  warm_locked_at DATETIME NULL,
  last_activity_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at DATETIME NULL,
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS failed_login_attempts (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  username VARCHAR(100) NOT NULL,
  ip_address VARCHAR(100) NOT NULL,
  was_successful TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bootstrap_guard (
  id TINYINT PRIMARY KEY,
  initialized_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS maintenance_mode (
  id TINYINT PRIMARY KEY,
  is_enabled TINYINT(1) NOT NULL DEFAULT 0,
  reason VARCHAR(255) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS encryption_keys (
  key_id VARCHAR(100) PRIMARY KEY,
  created_at DATETIME NOT NULL,
  rotated_at DATETIME NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS member_profiles (
  user_id BIGINT PRIMARY KEY,
  location_code VARCHAR(100) NOT NULL,
  notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_member_profile_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS coach_assignments (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  member_user_id BIGINT NOT NULL,
  coach_user_id BIGINT NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  assigned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_assignment_member FOREIGN KEY (member_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_assignment_coach FOREIGN KEY (coach_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS coach_location_assignments (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  coach_user_id BIGINT NOT NULL,
  location_code VARCHAR(100) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  assigned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_coach_location_active (coach_user_id, location_code, is_active),
  CONSTRAINT fk_coach_location_coach FOREIGN KEY (coach_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS consent_records (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  member_user_id BIGINT NOT NULL,
  consent_type VARCHAR(100) NOT NULL,
  consent_status VARCHAR(50) NOT NULL,
  recorded_by_user_id BIGINT NOT NULL,
  recorded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_consent_member FOREIGN KEY (member_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_consent_actor FOREIGN KEY (recorded_by_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS face_records (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  member_user_id BIGINT NOT NULL,
  status VARCHAR(50) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deactivated_at DATETIME NULL,
  CONSTRAINT fk_face_record_member FOREIGN KEY (member_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS face_record_versions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  face_record_id BIGINT NOT NULL,
  version_number INT NOT NULL,
  source_type VARCHAR(32) NOT NULL,
  center_image_path VARCHAR(255) NOT NULL,
  center_image_key_id VARCHAR(100) NOT NULL DEFAULT 'legacy',
  turn_image_path VARCHAR(255) NOT NULL,
  turn_image_key_id VARCHAR(100) NOT NULL DEFAULT 'legacy',
  average_hash TEXT NOT NULL,
  average_hash_key_id VARCHAR(100) NOT NULL DEFAULT 'legacy',
  blur_score DECIMAL(12, 4) NOT NULL,
  face_in_frame TINYINT(1) NOT NULL,
  center_landmarks_json JSON NOT NULL,
  turn_landmarks_json JSON NOT NULL,
  liveness_score DECIMAL(12, 4) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_face_version_record FOREIGN KEY (face_record_id) REFERENCES face_records(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS biometric_audit_log (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  member_user_id BIGINT NOT NULL,
  face_record_id BIGINT NULL,
  event_type VARCHAR(100) NOT NULL,
  details_json JSON NOT NULL,
  actor_user_id BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_bio_member FOREIGN KEY (member_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_bio_face_record FOREIGN KEY (face_record_id) REFERENCES face_records(id) ON DELETE SET NULL,
  CONSTRAINT fk_bio_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS content_posts (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  author_user_id BIGINT NOT NULL,
  kind VARCHAR(32) NOT NULL,
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  location_code VARCHAR(100) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_content_author FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS content_view_events (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  post_id BIGINT NOT NULL,
  viewer_user_id BIGINT NULL,
  station_token VARCHAR(100) NOT NULL,
  location_code VARCHAR(100) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_view_post FOREIGN KEY (post_id) REFERENCES content_posts(id) ON DELETE CASCADE,
  CONSTRAINT fk_viewer_user FOREIGN KEY (viewer_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS search_events (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  actor_user_id BIGINT NULL,
  search_term VARCHAR(255) NOT NULL,
  station_token VARCHAR(100) NOT NULL,
  location_code VARCHAR(100) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_search_user FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS dashboard_layouts (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL UNIQUE,
  layout_json JSON NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_dashboard_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS report_templates (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  layout_json JSON NOT NULL,
  created_by_user_id BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_report_template_user FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS report_schedules (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  template_id BIGINT NOT NULL,
  name VARCHAR(255) NOT NULL,
  cron_expression VARCHAR(100) NOT NULL,
  export_format VARCHAR(16) NOT NULL DEFAULT 'pdf',
  location_code VARCHAR(100) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by_user_id BIGINT NOT NULL,
  last_run_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_report_schedule_template FOREIGN KEY (template_id) REFERENCES report_templates(id) ON DELETE CASCADE,
  CONSTRAINT fk_report_schedule_user FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS report_subscriptions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  schedule_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_report_subscription (schedule_id, user_id),
  CONSTRAINT fk_report_subscription_schedule FOREIGN KEY (schedule_id) REFERENCES report_schedules(id) ON DELETE CASCADE,
  CONSTRAINT fk_report_subscription_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS report_exports (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  schedule_id BIGINT NULL,
  template_id BIGINT NOT NULL,
  export_format VARCHAR(16) NOT NULL,
  file_path VARCHAR(255) NULL,
  shared_file_path VARCHAR(255) NULL,
  status VARCHAR(32) NOT NULL,
  error_message TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_report_export_schedule FOREIGN KEY (schedule_id) REFERENCES report_schedules(id) ON DELETE SET NULL,
  CONSTRAINT fk_report_export_template FOREIGN KEY (template_id) REFERENCES report_templates(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS report_inbox_items (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  report_export_id BIGINT NOT NULL,
  title VARCHAR(255) NOT NULL,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_report_inbox_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_report_inbox_export FOREIGN KEY (report_export_id) REFERENCES report_exports(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS application_logs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  category VARCHAR(100) NOT NULL,
  level VARCHAR(16) NOT NULL,
  message TEXT NOT NULL,
  details_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS access_logs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NULL,
  ip_address VARCHAR(100) NOT NULL,
  method VARCHAR(16) NOT NULL,
  path VARCHAR(255) NOT NULL,
  status_code INT NOT NULL,
  duration_ms INT NOT NULL DEFAULT 0,
  station_token VARCHAR(100) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_access_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS anomaly_alerts (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  alert_type VARCHAR(100) NOT NULL,
  severity VARCHAR(16) NOT NULL,
  message TEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'open',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS backup_runs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  key_id VARCHAR(100) NOT NULL,
  file_path VARCHAR(255) NOT NULL,
  checksum VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL,
  error_message TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL
);

CREATE TABLE IF NOT EXISTS recovery_dry_runs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  backup_run_id BIGINT NOT NULL,
  target_instance VARCHAR(100) NOT NULL,
  status VARCHAR(32) NOT NULL,
  summary_json JSON NULL,
  error_message TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  CONSTRAINT fk_recovery_backup FOREIGN KEY (backup_run_id) REFERENCES backup_runs(id) ON DELETE CASCADE
);
`;

export const triggerStatements = [
  `DROP TRIGGER IF EXISTS biometric_audit_block_update`,
  `CREATE TRIGGER biometric_audit_block_update BEFORE UPDATE ON biometric_audit_log
   FOR EACH ROW
   SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'biometric_audit_log is immutable'`,
  `DROP TRIGGER IF EXISTS biometric_audit_block_delete`,
  `CREATE TRIGGER biometric_audit_block_delete BEFORE DELETE ON biometric_audit_log
   FOR EACH ROW
   SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'biometric_audit_log is immutable'`
];

export const migrationStatements: string[] = [];
