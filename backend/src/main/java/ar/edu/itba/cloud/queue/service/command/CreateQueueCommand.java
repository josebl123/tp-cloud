package ar.edu.itba.cloud.queue.service.command;

import ar.edu.itba.cloud.queue.persistence.entity.NoShowPolicy;
import ar.edu.itba.cloud.queue.persistence.entity.CallStrategy;

/** Every field except {@code name} is optional; nulls fall back to the queue defaults. */
public record CreateQueueCommand(
        String name,
        String description,
        Integer serviceStations,
        Integer defaultServiceMinutes,
        Integer maxSize,
        Integer gracePeriodSeconds,
        NoShowPolicy noShowPolicy,
        Integer moveBackPositions,
        Integer notifyAtPosition,
        Integer notifyAtMinutes,
        CallStrategy callStrategy) { }
