package ar.edu.itba.cloud.queue.service.model;

import ar.edu.itba.cloud.queue.persistence.entity.QueueStatus;
import java.util.UUID;

/** Minimal queue identity, embedded in customer-facing payloads. */
public record QueueSummary(UUID id, String name, String establishmentName, QueueStatus status) {
}
