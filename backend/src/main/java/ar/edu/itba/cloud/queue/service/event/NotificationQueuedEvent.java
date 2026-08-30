package ar.edu.itba.cloud.queue.service.event;

import java.util.UUID;

/**
 * Published when a notification row has been persisted. Delivery is deferred until the transaction
 * commits, so nothing is ever sent about a change that later rolls back.
 */
public record NotificationQueuedEvent(UUID notificationId) {
}
