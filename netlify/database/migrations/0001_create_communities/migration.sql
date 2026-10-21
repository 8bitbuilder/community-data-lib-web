-- Community libraries: the public record behind each /communities/<slug>/ page.
-- State code and county name are not stored; the build and the librarian
-- function derive them from county_fips with src/data/geo-vocabulary.json,
-- which also decides whether a county_fips is valid (checked in application code).
CREATE TABLE communities (
  slug        text PRIMARY KEY CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 60),
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  place_name  text CHECK (length(place_name) <= 60),
  description text CHECK (length(description) <= 500),
  -- One library per county (5-digit Census county FIPS code).
  county_fips char(5) NOT NULL UNIQUE CHECK (county_fips ~ '^[0-9]{5}$'),
  created_by  text,
  -- NULL until a team member with the Identity role "admin" approves the library;
  -- only approved libraries are built into the site.
  approved_at timestamptz,
  approved_by text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
