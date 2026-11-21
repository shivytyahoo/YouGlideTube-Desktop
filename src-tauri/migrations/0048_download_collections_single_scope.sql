-- Download collections used to carry their owner's profile id (`<profileId>:<playlistId>`)
-- when a non-default profile made them. There is only one library now, so the prefix goes.
-- A collection whose stripped id collides with another row keeps one row (the bare one wins,
-- otherwise the oldest); downloads that pointed at a dropped row keep their files but lose
-- the collection link.

UPDATE downloads
SET collection_db_id = NULL
WHERE collection_db_id IN (
    SELECT id FROM download_collections
    WHERE instr(collection_id, ':') BETWEEN 2 AND 65
      AND substr(collection_id, 1, instr(collection_id, ':') - 1) NOT GLOB '*[^A-Za-z0-9-]*'
      AND EXISTS (
        SELECT 1 FROM download_collections AS other
        WHERE other.id <> download_collections.id
          AND substr(other.collection_id, instr(other.collection_id, ':') + 1)
              = substr(download_collections.collection_id, instr(download_collections.collection_id, ':') + 1)
          AND (instr(other.collection_id, ':') = 0 OR other.id < download_collections.id)
      )
);

DELETE FROM download_collections
WHERE instr(collection_id, ':') BETWEEN 2 AND 65
  AND substr(collection_id, 1, instr(collection_id, ':') - 1) NOT GLOB '*[^A-Za-z0-9-]*'
  AND EXISTS (
    SELECT 1 FROM download_collections AS other
    WHERE other.id <> download_collections.id
      AND substr(other.collection_id, instr(other.collection_id, ':') + 1)
          = substr(download_collections.collection_id, instr(download_collections.collection_id, ':') + 1)
      AND (instr(other.collection_id, ':') = 0 OR other.id < download_collections.id)
  );

UPDATE download_collections
SET collection_id = substr(collection_id, instr(collection_id, ':') + 1)
WHERE instr(collection_id, ':') BETWEEN 2 AND 65
  AND substr(collection_id, 1, instr(collection_id, ':') - 1) NOT GLOB '*[^A-Za-z0-9-]*';
