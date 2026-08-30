package ar.edu.itba.cloud.queue.persistence.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/**
 * A notification aimed at one customer.
 *
 * <p>The unique key {@code (entry_id, type, cycle)} is the de-duplication mechanism: it is what stops
 * a threshold alert from firing again on every queue movement.
 */
@Entity
@Table(name = "notification_record")
public class NotificationRecord {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "entry_id", nullable = false, updatable = false)
    private UUID entryId;

    @Enumerated(EnumType.STRING)
    @Column(name = "type", nullable = false, length = 32, updatable = false)
    private NotificationType type;

    @Column(name = "cycle", nullable = false, updatable = false)
    private int cycle;

    @Enumerated(EnumType.STRING)
    @Column(name = "channel", nullable = false, length = 16)
    private NotificationChannel channel;

    @Column(name = "destination", nullable = false, length = 255)
    private String destination;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 16)
    private NotificationStatus status = NotificationStatus.PENDING;

    @Column(name = "subject", nullable = false, length = 200)
    private String subject;

    @Column(name = "body", nullable = false, length = 2000)
    private String body;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "sent_at")
    private Instant sentAt;

    @Column(name = "failure_reason", length = 500)
    private String failureReason;

    protected NotificationRecord() {
        // for JPA
    }

    public NotificationRecord(UUID entryId, NotificationType type, int cycle, NotificationChannel channel,
                              String destination, String subject, String body, Instant createdAt) {
        this.entryId = entryId;
        this.type = type;
        this.cycle = cycle;
        this.channel = channel;
        this.destination = destination;
        this.subject = subject;
        this.body = body;
        this.createdAt = createdAt;
        this.status = NotificationStatus.PENDING;
    }

    public void markSent(Instant sentAt) {
        this.status = NotificationStatus.SENT;
        this.sentAt = sentAt;
        this.failureReason = null;
    }

    public void markFailed(String reason) {
        this.status = NotificationStatus.FAILED;
        this.failureReason = reason == null || reason.length() <= 500
                ? reason
                : reason.substring(0, 500);
    }

    public UUID getId() {
        return id;
    }

    public UUID getEntryId() {
        return entryId;
    }

    public NotificationType getType() {
        return type;
    }

    public int getCycle() {
        return cycle;
    }

    public NotificationChannel getChannel() {
        return channel;
    }

    public String getDestination() {
        return destination;
    }

    public NotificationStatus getStatus() {
        return status;
    }

    public String getSubject() {
        return subject;
    }

    public String getBody() {
        return body;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getSentAt() {
        return sentAt;
    }

    public String getFailureReason() {
        return failureReason;
    }
}
