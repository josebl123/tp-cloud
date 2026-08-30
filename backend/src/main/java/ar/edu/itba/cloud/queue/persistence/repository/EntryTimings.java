package ar.edu.itba.cloud.queue.persistence.repository;

import ar.edu.itba.cloud.queue.persistence.entity.EntryStatus;
import java.time.Duration;
import java.time.Instant;

/**
 * Slim projection of the timestamps metrics and ETA estimation need, so those code paths never load
 * whole entries.
 */
public record EntryTimings(
        EntryStatus status,
        Instant joinedAt,
        Instant calledAt,
        Instant servingStartedAt,
        Instant finishedAt) {

    /** Time between joining and being called, i.e. what the customer actually waited. */
    public Duration waitDuration() {
        return calledAt == null ? null : Duration.between(joinedAt, calledAt);
    }

    /** Time the staff spent attending the customer. */
    public Duration serviceDuration() {
        return servingStartedAt == null || finishedAt == null
                ? null
                : Duration.between(servingStartedAt, finishedAt);
    }
}
