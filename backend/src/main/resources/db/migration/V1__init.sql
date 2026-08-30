-- Q (Queue) - initial schema
-- All timestamps are stored in UTC (TIMESTAMPTZ). Presentation timezone lives on the establishment.

CREATE TABLE user_account (
    id            UUID         PRIMARY KEY,
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    display_name  VARCHAR(120) NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL
);

CREATE TABLE establishment (
    id         UUID         PRIMARY KEY,
    name       VARCHAR(120) NOT NULL,
    timezone   VARCHAR(64)  NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
    created_at TIMESTAMPTZ  NOT NULL
);

CREATE TABLE membership (
    id               UUID        PRIMARY KEY,
    user_id          UUID        NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
    establishment_id UUID        NOT NULL REFERENCES establishment(id) ON DELETE CASCADE,
    role             VARCHAR(16) NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL,
    CONSTRAINT uq_membership_user_establishment UNIQUE (user_id, establishment_id),
    CONSTRAINT ck_membership_role CHECK (role IN ('OWNER', 'STAFF'))
);
CREATE INDEX ix_membership_user ON membership (user_id);
CREATE INDEX ix_membership_establishment ON membership (establishment_id);

-- One queue == one service == one QR code.
CREATE TABLE service_queue (
    id                      UUID         PRIMARY KEY,
    establishment_id        UUID         NOT NULL REFERENCES establishment(id) ON DELETE CASCADE,
    name                    VARCHAR(120) NOT NULL,
    description             VARCHAR(500),
    status                  VARCHAR(16)  NOT NULL DEFAULT 'OPEN',
    service_stations        INT          NOT NULL DEFAULT 1,
    default_service_minutes INT          NOT NULL DEFAULT 5,
    max_size                INT,
    grace_period_seconds    INT          NOT NULL DEFAULT 120,
    no_show_policy          VARCHAR(24)  NOT NULL DEFAULT 'MOVE_TO_END',
    move_back_positions     INT          NOT NULL DEFAULT 3,
    notify_at_position      INT,
    notify_at_minutes       INT,
    require_party_size      BOOLEAN      NOT NULL DEFAULT FALSE,
    next_ticket_number      BIGINT       NOT NULL DEFAULT 1,
    next_order_key          BIGINT       NOT NULL DEFAULT 1000,
    created_at              TIMESTAMPTZ  NOT NULL,
    updated_at              TIMESTAMPTZ  NOT NULL,
    CONSTRAINT ck_queue_status         CHECK (status IN ('OPEN', 'PAUSED', 'CLOSED')),
    CONSTRAINT ck_queue_policy         CHECK (no_show_policy IN ('KEEP_POSITION', 'MOVE_BACK', 'MOVE_TO_END', 'REMOVE')),
    CONSTRAINT ck_queue_stations       CHECK (service_stations >= 1),
    CONSTRAINT ck_queue_default_time   CHECK (default_service_minutes >= 1),
    CONSTRAINT ck_queue_max_size       CHECK (max_size IS NULL OR max_size >= 1),
    CONSTRAINT ck_queue_grace          CHECK (grace_period_seconds >= 0),
    CONSTRAINT ck_queue_move_back      CHECK (move_back_positions >= 1),
    CONSTRAINT ck_queue_notify_pos     CHECK (notify_at_position IS NULL OR notify_at_position >= 1),
    CONSTRAINT ck_queue_notify_min     CHECK (notify_at_minutes IS NULL OR notify_at_minutes >= 1)
);
CREATE INDEX ix_queue_establishment ON service_queue (establishment_id);

CREATE TABLE queue_entry (
    id                 UUID         PRIMARY KEY,
    queue_id           UUID         NOT NULL REFERENCES service_queue(id) ON DELETE CASCADE,
    ticket_token       UUID         NOT NULL UNIQUE,
    ticket_number      BIGINT       NOT NULL,
    customer_name      VARCHAR(120) NOT NULL,
    customer_email     VARCHAR(255),
    customer_phone     VARCHAR(40),
    party_size         INT,
    status             VARCHAR(16)  NOT NULL,
    order_key          BIGINT       NOT NULL,
    notification_cycle INT          NOT NULL DEFAULT 0,
    no_show_count      INT          NOT NULL DEFAULT 0,
    joined_at          TIMESTAMPTZ  NOT NULL,
    called_at          TIMESTAMPTZ,
    serving_started_at TIMESTAMPTZ,
    finished_at        TIMESTAMPTZ,
    grace_expires_at   TIMESTAMPTZ,
    CONSTRAINT uq_entry_ticket_number UNIQUE (queue_id, ticket_number),
    CONSTRAINT ck_entry_status   CHECK (status IN ('WAITING', 'CALLED', 'SERVING', 'SERVED', 'LEFT', 'NO_SHOW')),
    CONSTRAINT ck_entry_contact  CHECK (customer_email IS NOT NULL OR customer_phone IS NOT NULL),
    CONSTRAINT ck_entry_party    CHECK (party_size IS NULL OR party_size >= 1)
);
CREATE INDEX ix_entry_queue_status_order ON queue_entry (queue_id, status, order_key);
CREATE INDEX ix_entry_grace ON queue_entry (status, grace_expires_at);
CREATE INDEX ix_entry_queue_finished ON queue_entry (queue_id, finished_at);

-- Append-only audit trail; also the source for historical metrics.
CREATE TABLE queue_event (
    id          UUID         PRIMARY KEY,
    queue_id    UUID         NOT NULL REFERENCES service_queue(id) ON DELETE CASCADE,
    entry_id    UUID         REFERENCES queue_entry(id) ON DELETE CASCADE,
    type        VARCHAR(40)  NOT NULL,
    actor_type  VARCHAR(16)  NOT NULL,
    actor_id    UUID,
    detail      VARCHAR(500),
    occurred_at TIMESTAMPTZ  NOT NULL,
    CONSTRAINT ck_event_actor CHECK (actor_type IN ('CUSTOMER', 'STAFF', 'SYSTEM'))
);
CREATE INDEX ix_event_queue_time ON queue_event (queue_id, occurred_at DESC);
CREATE INDEX ix_event_entry ON queue_event (entry_id);

CREATE TABLE notification_record (
    id             UUID          PRIMARY KEY,
    entry_id       UUID          NOT NULL REFERENCES queue_entry(id) ON DELETE CASCADE,
    type           VARCHAR(32)   NOT NULL,
    cycle          INT           NOT NULL DEFAULT 0,
    channel        VARCHAR(16)   NOT NULL,
    destination    VARCHAR(255)  NOT NULL,
    status         VARCHAR(16)   NOT NULL,
    subject        VARCHAR(200)  NOT NULL,
    body           VARCHAR(2000) NOT NULL,
    created_at     TIMESTAMPTZ   NOT NULL,
    sent_at        TIMESTAMPTZ,
    failure_reason VARCHAR(500),
    CONSTRAINT uq_notification_once UNIQUE (entry_id, type, cycle),
    CONSTRAINT ck_notification_type    CHECK (type IN ('TICKET_CREATED', 'APPROACHING_POSITION', 'APPROACHING_TIME', 'YOUR_TURN', 'NO_SHOW', 'QUEUE_CLOSED')),
    CONSTRAINT ck_notification_channel CHECK (channel IN ('EMAIL', 'SMS', 'LOG')),
    CONSTRAINT ck_notification_status  CHECK (status IN ('PENDING', 'SENT', 'FAILED'))
);
CREATE INDEX ix_notification_entry ON notification_record (entry_id);
