-- Document.version: raised by every update; a save names the version it was edited from and
-- is refused if the document changed since. A plain ADD COLUMN (SQLite allows it with a
-- constant default), so existing rows keep their data and start at 0 without a table rebuild.
ALTER TABLE "Document" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
