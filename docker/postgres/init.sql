-- Runs once as superuser when the container volume is first created.
-- Extensions require superuser; the application role is deliberately NOT a superuser
-- so FORCE ROW LEVEL SECURITY on escrow tables applies to it.
CREATE ROLE thirtydates_app LOGIN PASSWORD 'thirtydates_app';
CREATE DATABASE thirtydates OWNER thirtydates_app;
\connect thirtydates
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS vector;
GRANT ALL ON SCHEMA public TO thirtydates_app;
