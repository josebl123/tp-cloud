package ar.edu.itba.cloud.queue.persistence.entity;

/** Delivery channel for a notification. */
public enum NotificationChannel {
    EMAIL,
    SMS,
    /** Fallback used when no real transport is configured for the destination. */
    LOG
}
