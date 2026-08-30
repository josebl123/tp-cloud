package ar.edu.itba.cloud.queue.service.event;

import java.util.UUID;

/**
 * Published whenever anything about a queue's line changes.
 *
 * <p>One event per queue is enough: a single movement shifts every position behind it, so both the
 * staff board and every subscribed ticket have to be recomputed anyway.
 */
public record QueueChangedEvent(UUID queueId) {
}
