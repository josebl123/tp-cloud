package ar.edu.itba.cloud.queue.persistence.entity;

/** Lifecycle status of a queue. */
public enum QueueStatus {
    /** Accepting new customers and serving them. */
    OPEN,
    /** Temporarily not accepting new customers; staff may keep serving the current line. */
    PAUSED,
    /** Not accepting new customers and not operating. */
    CLOSED
}
