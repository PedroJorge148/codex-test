CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='rh_runtime') THEN CREATE ROLE rh_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF; END $$;
CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, timezone text NOT NULL DEFAULT 'America/Fortaleza',
  schema_version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), subject text UNIQUE NOT NULL, name text NOT NULL, email text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE memberships (
  organization_id uuid NOT NULL REFERENCES organizations(id), user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK(role IN ('admin','user')), active boolean NOT NULL DEFAULT true,
  PRIMARY KEY(organization_id,user_id)
);
CREATE TABLE sessions (id text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), csrf text NOT NULL, expires_at timestamptz NOT NULL, last_operation_id uuid);
CREATE TABLE login_states (id text PRIMARY KEY, encrypted text NOT NULL, expires_at timestamptz NOT NULL);
CREATE TABLE invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), email text NOT NULL,
  role text NOT NULL CHECK(role IN ('admin','user')), token_hash text UNIQUE NOT NULL, expires_at timestamptz NOT NULL,
  accepted_at timestamptz, created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE jobs (
  organization_id uuid NOT NULL REFERENCES organizations(id), id uuid NOT NULL DEFAULT gen_random_uuid(), title text NOT NULL,
  version integer NOT NULL DEFAULT 1, deleted_at timestamptz, deleted_by uuid REFERENCES users(id), PRIMARY KEY(organization_id,id)
);
CREATE TABLE candidates (
  organization_id uuid NOT NULL REFERENCES organizations(id), id uuid NOT NULL DEFAULT gen_random_uuid(), name text NOT NULL, email text, phone text,
  version integer NOT NULL DEFAULT 1, deleted_at timestamptz, deleted_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(organization_id,id)
);
CREATE TABLE applications (
  organization_id uuid NOT NULL REFERENCES organizations(id), id uuid NOT NULL DEFAULT gen_random_uuid(), candidate_id uuid NOT NULL, job_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1, deleted_at timestamptz, deleted_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(organization_id,id), FOREIGN KEY(organization_id,candidate_id) REFERENCES candidates(organization_id,id), FOREIGN KEY(organization_id,job_id) REFERENCES jobs(organization_id,id)
);
CREATE TABLE fields (
  organization_id uuid NOT NULL REFERENCES organizations(id), id uuid NOT NULL, definition jsonb NOT NULL,
  PRIMARY KEY(organization_id,id), CHECK(definition->>'id'=id::text)
);
CREATE TABLE field_options (
  organization_id uuid NOT NULL, field_id uuid NOT NULL, id uuid NOT NULL, label text NOT NULL, archived boolean NOT NULL DEFAULT false,
  PRIMARY KEY(organization_id,field_id,id), FOREIGN KEY(organization_id,field_id) REFERENCES fields(organization_id,id)
);
CREATE TABLE field_values (
  organization_id uuid NOT NULL, application_id uuid NOT NULL, field_id uuid NOT NULL,
  text_value text, number_value double precision, date_value date, datetime_value timestamptz, boolean_value boolean, option_value uuid, user_value uuid,
  PRIMARY KEY(organization_id,application_id,field_id), FOREIGN KEY(organization_id,application_id) REFERENCES applications(organization_id,id),
  FOREIGN KEY(organization_id,field_id) REFERENCES fields(organization_id,id), FOREIGN KEY(organization_id,field_id,option_value) REFERENCES field_options(organization_id,field_id,id),
  FOREIGN KEY(organization_id,user_value) REFERENCES memberships(organization_id,user_id),
  CHECK(num_nonnulls(text_value,number_value,date_value,datetime_value,boolean_value,option_value,user_value)=1)
);
CREATE TABLE multi_values (
  organization_id uuid NOT NULL, application_id uuid NOT NULL, field_id uuid NOT NULL, option_id uuid NOT NULL,
  PRIMARY KEY(organization_id,application_id,field_id,option_id), FOREIGN KEY(organization_id,application_id) REFERENCES applications(organization_id,id),
  FOREIGN KEY(organization_id,field_id,option_id) REFERENCES field_options(organization_id,field_id,id)
);
CREATE FUNCTION check_field_value_type() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE kind text;
BEGIN
  SELECT definition->>'type' INTO kind FROM fields WHERE organization_id=NEW.organization_id AND id=NEW.field_id;
  IF TG_TABLE_NAME='multi_values' THEN
    IF kind<>'multiple' THEN RAISE EXCEPTION 'invalid value type' USING ERRCODE='23514'; END IF;
  ELSIF NOT (CASE
    WHEN kind IN ('text','longText','email','phone','url') THEN NEW.text_value IS NOT NULL
    WHEN kind='number' THEN NEW.number_value IS NOT NULL
    WHEN kind='date' THEN NEW.date_value IS NOT NULL
    WHEN kind='datetime' THEN NEW.datetime_value IS NOT NULL
    WHEN kind='boolean' THEN NEW.boolean_value IS NOT NULL
    WHEN kind='single' THEN NEW.option_value IS NOT NULL
    WHEN kind='user' THEN NEW.user_value IS NOT NULL ELSE false END) THEN
    RAISE EXCEPTION 'invalid value type' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER field_value_type BEFORE INSERT OR UPDATE ON field_values FOR EACH ROW EXECUTE FUNCTION check_field_value_type();
CREATE TRIGGER multi_value_type BEFORE INSERT OR UPDATE ON multi_values FOR EACH ROW EXECUTE FUNCTION check_field_value_type();
CREATE TABLE external_ids (
  organization_id uuid NOT NULL, source text NOT NULL, entity_type text NOT NULL CHECK(entity_type IN ('candidate','application','job')), external_id text NOT NULL,
  candidate_id uuid, application_id uuid, job_id uuid,
  PRIMARY KEY(organization_id,source,entity_type,external_id),
  FOREIGN KEY(organization_id,candidate_id) REFERENCES candidates(organization_id,id), FOREIGN KEY(organization_id,application_id) REFERENCES applications(organization_id,id), FOREIGN KEY(organization_id,job_id) REFERENCES jobs(organization_id,id),
  CHECK((entity_type='candidate' AND candidate_id IS NOT NULL AND application_id IS NULL AND job_id IS NULL) OR (entity_type='application' AND application_id IS NOT NULL AND candidate_id IS NULL AND job_id IS NULL) OR (entity_type='job' AND job_id IS NOT NULL AND candidate_id IS NULL AND application_id IS NULL))
);
CREATE TABLE operations (
  organization_id uuid NOT NULL REFERENCES organizations(id), id uuid NOT NULL, actor_id uuid NOT NULL REFERENCES users(id), session_id text NOT NULL,
  action text NOT NULL, source text NOT NULL, correlation_id uuid NOT NULL, request_hash text NOT NULL, result jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(organization_id,id)
);
CREATE TABLE audit_events (
  organization_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), operation_id uuid NOT NULL, entity text NOT NULL, entity_id uuid NOT NULL,
  field text NOT NULL, payload text, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(organization_id,id),
  FOREIGN KEY(organization_id,operation_id) REFERENCES operations(organization_id,id)
);
CREATE TABLE outbox (
  organization_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), operation_id uuid NOT NULL, published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(organization_id,id), FOREIGN KEY(organization_id,operation_id) REFERENCES operations(organization_id,id)
);
CREATE TABLE imports (
  organization_id uuid NOT NULL REFERENCES organizations(id), id uuid NOT NULL DEFAULT gen_random_uuid(), actor_id uuid NOT NULL REFERENCES users(id),
  status text NOT NULL CHECK(status IN ('uploaded','ready','queued','running','completed','stale','failed')), format text NOT NULL, filename text NOT NULL,
  encrypted_file text, config jsonb, schema_version integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz, expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',
  PRIMARY KEY(organization_id,id)
);
CREATE TABLE import_rows (
  organization_id uuid NOT NULL, import_id uuid NOT NULL, row_number integer NOT NULL, status text NOT NULL, encrypted_data text, error text,
  operation_id uuid NOT NULL DEFAULT gen_random_uuid(), application_id uuid, PRIMARY KEY(organization_id,import_id,row_number),
  FOREIGN KEY(organization_id,import_id) REFERENCES imports(organization_id,id)
);
CREATE TABLE erasure_ledger (organization_id uuid NOT NULL REFERENCES organizations(id), candidate_id uuid NOT NULL, erased_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(organization_id,candidate_id));
CREATE INDEX applications_active_page ON applications(organization_id,created_at DESC,id) WHERE deleted_at IS NULL;
CREATE INDEX applications_job ON applications(organization_id,job_id,id) WHERE deleted_at IS NULL;
CREATE INDEX applications_candidate ON applications(organization_id,candidate_id);
CREATE INDEX candidate_email ON candidates(organization_id,lower(email));
CREATE INDEX candidate_phone ON candidates(organization_id,phone);
CREATE INDEX field_text ON field_values(organization_id,field_id,text_value,application_id);
CREATE INDEX field_number ON field_values(organization_id,field_id,number_value,application_id);
CREATE INDEX field_date ON field_values(organization_id,field_id,date_value,application_id);
CREATE INDEX field_datetime ON field_values(organization_id,field_id,datetime_value,application_id);
CREATE INDEX field_boolean ON field_values(organization_id,field_id,boolean_value,application_id);
CREATE INDEX field_option ON field_values(organization_id,field_id,option_value,application_id);
CREATE INDEX field_user ON field_values(organization_id,field_id,user_value,application_id);
CREATE INDEX multi_option ON multi_values(organization_id,field_id,option_id,application_id);
CREATE INDEX audit_entity ON audit_events(organization_id,entity_id,created_at DESC);
CREATE INDEX audit_operation ON audit_events(organization_id,operation_id);
CREATE INDEX operations_time ON operations(organization_id,created_at DESC);
CREATE INDEX outbox_pending ON outbox(created_at) WHERE published_at IS NULL;
CREATE INDEX imports_pending ON imports(status,created_at);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['jobs','candidates','applications','fields','field_options','field_values','multi_values','external_ids','operations','audit_events','outbox','imports','import_rows','erasure_ledger'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (organization_id = nullif(current_setting(''app.organization_id'',true),'''')::uuid) WITH CHECK (organization_id = nullif(current_setting(''app.organization_id'',true),'''')::uuid)',t);
  END LOOP;
END $$;
GRANT USAGE ON SCHEMA public TO rh_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO rh_runtime;
REVOKE UPDATE,DELETE ON audit_events FROM rh_runtime;
REVOKE DELETE ON operations FROM rh_runtime;
CREATE FUNCTION redact_audit(target uuid, cutoff timestamptz DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF nullif(current_setting('app.organization_id',true),'') IS NULL THEN RAISE EXCEPTION 'tenant required'; END IF;
  UPDATE audit_events SET payload=NULL WHERE organization_id=current_setting('app.organization_id')::uuid AND ((target IS NOT NULL AND entity_id=target) OR (cutoff IS NOT NULL AND created_at<cutoff));
END $$;
REVOKE ALL ON FUNCTION redact_audit(uuid,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION redact_audit(uuid,timestamptz) TO rh_runtime;
