SELECT DISTINCT ON (m.id, pmcr."categoryId")
    m.id AS map_id,
    m."songName",
    m.characteristic,
    m.difficulty,
    m.hash,
    m.key,
    m.bpm,
    m."maxScore",
    m.nps,
    m.length,
    m."mapCreationDate",
    m."mapUploadDate",
    pm.id AS pooled_map_id,
    pm.description AS pooled_map_description,
    pm.public AS is_public,
    pm.retired AS is_retired,
    pm."analysisMetadata",
    pmc.id AS category_id,
    pmc.name AS category_name,
    pmcr."createdAt" AS rating_created_at,
    pmcr."updatedAt" AS rating_updated_at
FROM
    "PooledMapCategoryRating" pmcr
JOIN
    "PooledMap" pm ON pmcr."mapId" = pm.id  -- pmcr.mapId = PooledMap.id 
JOIN
    "Map" m ON pm."mapId" = m.id  -- PooledMap.mapId = Map.id
JOIN
    "PooledMapCategory" pmc ON pmcr."categoryId" = pmc.id
ORDER BY
    m.id, pmcr."categoryId", pmcr."updatedAt" DESC