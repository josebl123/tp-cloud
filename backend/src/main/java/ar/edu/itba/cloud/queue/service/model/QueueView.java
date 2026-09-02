package ar.edu.itba.cloud.queue.service.model;

import ar.edu.itba.cloud.queue.persistence.entity.NoShowPolicy;
import ar.edu.itba.cloud.queue.persistence.entity.QueueStatus;
import ar.edu.itba.cloud.queue.persistence.entity.CallStrategy;
import java.time.Instant;
import java.util.UUID;

/** Full staff-facing view of a queue, configuration included. */
public record QueueView(
        UUID id,
        UUID establishmentId,
        String establishmentName,
        String name,
        String description,
        QueueStatus status,
        int serviceStations,
        int defaultServiceMinutes,
        Integer maxSize,
        int gracePeriodSeconds,
        NoShowPolicy noShowPolicy,
        int moveBackPositions,
        Integer notifyAtPosition,
        Integer notifyAtMinutes,
        /** URL encoded in this queue's QR code. */
        String joinUrl,
        Instant createdAt,
        Instant updatedAt,
        Instant archivedAt,
        java.util.List<QueueLaneView> lanes,
        CallStrategy callStrategy) {
}
