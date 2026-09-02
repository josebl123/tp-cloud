-- Lanes are introduced separately so databases that already applied V1 retain Flyway's checksum.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE service_queue
    ADD COLUMN archived_at TIMESTAMPTZ,
    ADD COLUMN call_strategy VARCHAR(24) NOT NULL DEFAULT 'GLOBAL_AGE',
    ADD COLUMN round_robin_position INT NOT NULL DEFAULT 0,
    ADD CONSTRAINT ck_queue_archive_status CHECK (archived_at IS NULL OR status = 'CLOSED'),
    ADD CONSTRAINT ck_queue_call_strategy CHECK (call_strategy IN ('GLOBAL_AGE', 'LANE_PRIORITY', 'ROUND_ROBIN')),
    ADD CONSTRAINT ck_queue_round_robin CHECK (round_robin_position >= 0);

CREATE TABLE queue_lane (
    id UUID PRIMARY KEY,
    queue_id UUID NOT NULL REFERENCES service_queue(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    min_party_size INT NOT NULL DEFAULT 1,
    max_party_size INT,
    priority INT NOT NULL DEFAULT 0,
    capacity_mode VARCHAR(16) NOT NULL DEFAULT 'GROUPS',
    max_size INT,
    time_factor NUMERIC(8,3) NOT NULL DEFAULT 1.0,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT ck_lane_min CHECK (min_party_size >= 1),
    CONSTRAINT ck_lane_range CHECK (max_party_size IS NULL OR max_party_size >= min_party_size),
    CONSTRAINT ck_lane_priority CHECK (priority >= 0),
    CONSTRAINT ck_lane_mode CHECK (capacity_mode IN ('PERSONS', 'GROUPS')),
    CONSTRAINT ck_lane_capacity CHECK (max_size IS NULL OR max_size >= 1),
    CONSTRAINT ck_lane_factor CHECK (time_factor > 0),
    CONSTRAINT uq_lane_name UNIQUE (queue_id, name)
);

-- Every legacy queue starts in the same unsegmented lane.  Its capacity is deliberately unlimited:
-- service_queue.max_size remains the global limit expressed in active groups.
INSERT INTO queue_lane (id, queue_id, name, min_party_size, max_party_size, priority, capacity_mode, max_size, time_factor, active, created_at)
SELECT gen_random_uuid(), q.id, '1+', 1, NULL, 0, 'GROUPS', NULL, 1.0, TRUE, q.created_at
FROM service_queue q;

ALTER TABLE queue_entry ADD COLUMN lane_id UUID;
UPDATE queue_entry e
SET party_size = 1
WHERE party_size IS NULL;
UPDATE queue_entry e
SET lane_id = l.id
FROM queue_lane l
WHERE l.queue_id = e.queue_id AND l.name = '1+';
ALTER TABLE queue_entry
    ALTER COLUMN party_size SET NOT NULL,
    ALTER COLUMN lane_id SET NOT NULL,
    ADD CONSTRAINT fk_entry_lane FOREIGN KEY (lane_id) REFERENCES queue_lane(id);
ALTER TABLE queue_entry DROP CONSTRAINT ck_entry_party;
ALTER TABLE queue_entry ADD CONSTRAINT ck_entry_party CHECK (party_size >= 1);

CREATE INDEX ix_lane_queue_priority ON queue_lane(queue_id, active, priority, min_party_size);
CREATE INDEX ix_entry_lane_status_order ON queue_entry(lane_id, status, order_key);
