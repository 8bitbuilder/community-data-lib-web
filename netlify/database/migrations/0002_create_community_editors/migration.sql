-- Who may edit each library: Netlify Identity users, by (lowercased) email.
-- The registrant is added as the first editor; a library always keeps at least one.
CREATE TABLE community_editors (
  community_slug text NOT NULL REFERENCES communities (slug) ON DELETE CASCADE,
  email          text NOT NULL CHECK (email = lower(email) AND email LIKE '%_@_%'),
  added_by       text,
  added_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (community_slug, email)
);

CREATE INDEX community_editors_email ON community_editors (email);
