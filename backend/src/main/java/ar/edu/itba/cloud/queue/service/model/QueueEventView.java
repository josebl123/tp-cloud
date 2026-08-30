package ar.edu.itba.cloud.queue.service.model;

import ar.edu.itba.cloud.queue.persistence.entity.ActorType;
import ar.edu.itba.cloud.queue.persistence.entity.EventType;
import java.time.Instant;
import java.util.UUID;

public record QueueEventView(
        UUID id,
        UUID queueId,
        UUID entryId,
        EventType type,
        ActorType actorType,
        UUID actorId,
        String detail,
        Instant occurredAt) {
}
