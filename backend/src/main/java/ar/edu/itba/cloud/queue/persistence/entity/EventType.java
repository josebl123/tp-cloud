package ar.edu.itba.cloud.queue.persistence.entity;

/** Auditable facts recorded on the queue timeline. */
public enum EventType {
    QUEUE_CREATED,
    QUEUE_UPDATED,
    QUEUE_STATUS_CHANGED,
    QUEUE_DELETED,
    QUEUE_ARCHIVED,
    ENTRY_JOINED,
    ENTRY_CALLED,
    ENTRY_SERVING_STARTED,
    ENTRY_SERVED,
    ENTRY_LEFT,
    ENTRY_NO_SHOW,
    ENTRY_REQUEUED,
    NOTIFICATION_QUEUED,
    NOTIFICATION_SENT,
    NOTIFICATION_FAILED
}
