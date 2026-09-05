package ar.edu.itba.cloud.queue.service.model;

import ar.edu.itba.cloud.queue.persistence.entity.QueueStatus;
import java.util.UUID;

/** What a customer sees after scanning the QR, before deciding to join. */
public record PublicQueueView(
        UUID id,
        String name,
        String description,
        String establishmentName,
        QueueStatus status,
        boolean acceptingEntries,
        boolean full,
        int waitingCount,
        Integer maxSize,
        java.util.List<QueueLaneView> lanes) {
}
