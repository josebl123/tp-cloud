package ar.edu.itba.cloud.queue.service.model;

import ar.edu.itba.cloud.queue.persistence.entity.NotificationChannel;
import ar.edu.itba.cloud.queue.persistence.entity.NotificationStatus;
import ar.edu.itba.cloud.queue.persistence.entity.NotificationType;
import java.time.Instant;
import java.util.UUID;

public record NotificationView(
        UUID id,
        NotificationType type,
        NotificationChannel channel,
        NotificationStatus status,
        String destination,
        String subject,
        Instant createdAt,
        Instant sentAt) {
}
