package ar.edu.itba.cloud.queue.persistence.entity;

/** Reason a customer is notified. At most one per (entry, type, notification cycle). */
public enum NotificationType {
    /** Sent on join; carries the personal ticket link. */
    TICKET_CREATED,
    /** The configured number of people ahead has been reached. */
    APPROACHING_POSITION,
    /** The configured estimated waiting minutes has been reached. */
    APPROACHING_TIME,
    /** The customer has been called. */
    YOUR_TURN,
    /** The grace period expired. */
    NO_SHOW,
    /** The queue was closed while the customer was waiting. */
    QUEUE_CLOSED
}
