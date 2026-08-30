package ar.edu.itba.cloud.queue.service.command;

import ar.edu.itba.cloud.queue.persistence.entity.NoShowPolicy;

/**
 * Partial update. A null field means "leave unchanged", which is why {@code maxSize},
 * {@code notifyAtPosition} and {@code notifyAtMinutes} carry explicit clear flags - those three are
 * meaningfully nullable in the domain.
 */
public record UpdateQueueCommand(
        String name,
        String description,
        Integer serviceStations,
        Integer defaultServiceMinutes,
        Integer maxSize,
        boolean clearMaxSize,
        Integer gracePeriodSeconds,
        NoShowPolicy noShowPolicy,
        Integer moveBackPositions,
        Integer notifyAtPosition,
        boolean clearNotifyAtPosition,
        Integer notifyAtMinutes,
        boolean clearNotifyAtMinutes,
        Boolean requirePartySize) {
}
