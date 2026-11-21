-- A clip download saves only part of a video: the range in milliseconds, so
-- the library can show it even when the file was renamed after saving.
ALTER TABLE downloads ADD COLUMN clip_start_ms INTEGER;
ALTER TABLE downloads ADD COLUMN clip_end_ms INTEGER;
