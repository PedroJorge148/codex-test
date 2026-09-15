ALTER TABLE imports DROP CONSTRAINT imports_status_check;
ALTER TABLE imports ADD CONSTRAINT imports_status_check CHECK(status IN ('uploaded','validation_queued','validating','ready','queued','running','completed','stale','failed'));
ALTER TABLE import_rows ADD COLUMN identity_key text;
CREATE INDEX import_identity ON import_rows(organization_id,import_id,identity_key);
CREATE INDEX candidate_deleted_retention ON candidates(organization_id,deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX applications_deleted_retention ON applications(organization_id,deleted_at,candidate_id) WHERE deleted_at IS NOT NULL;
