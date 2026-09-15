#!/bin/sh
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_password="$DATABASE_APP_PASSWORD" -v identity_password="$KEYCLOAK_DB_PASSWORD" <<'SQL'
CREATE ROLE rh_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE rh_app LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD :'app_password';
GRANT rh_runtime TO rh_app;
CREATE ROLE rh_identity LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD :'identity_password';
CREATE DATABASE keycloak OWNER rh_identity;
SQL
