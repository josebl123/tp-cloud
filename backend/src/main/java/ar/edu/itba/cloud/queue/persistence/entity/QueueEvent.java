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
 * Append-only record of something that happened on a queue.
 *
 * <p>Deliberately holds raw ids rather than JPA associations: events are written on every state
 * change and never navigated from, so there is no reason to pay for the relationships.
 */
@Entity
@Table(name = "queue_event")
public class QueueEvent {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "queue_id", nullable = false, updatable = false)
    private UUID queueId;

    @Column(name = "entry_id", updatable = false)
    private UUID entryId;

    @Enumerated(EnumType.STRING)
    @Column(name = "type", nullable = false, length = 40, updatable = false)
    private EventType type;

    @Enumerated(EnumType.STRING)
    @Column(name = "actor_type", nullable = false, length = 16, updatable = false)
    private ActorType actorType;

    @Column(name = "actor_id", updatable = false)
    private UUID actorId;

    @Column(name = "detail", length = 500, updatable = false)
    private String detail;

    @Column(name = "occurred_at", nullable = false, updatable = false)
    private Instant occurredAt;

    protected QueueEvent() {
        // for JPA
    }

    public QueueEvent(UUID queueId, UUID entryId, EventType type, ActorType actorType,
                      UUID actorId, String detail, Instant occurredAt) {
        this.queueId = queueId;
        this.entryId = entryId;
        this.type = type;
        this.actorType = actorType;
        this.actorId = actorId;
        this.detail = detail;
        this.occurredAt = occurredAt;
    }

    public UUID getId() {
        return id;
    }

    public UUID getQueueId() {
        return queueId;
    }

    public UUID getEntryId() {
        return entryId;
    }

    public EventType getType() {
        return type;
    }

    public ActorType getActorType() {
        return actorType;
    }

    public UUID getActorId() {
        return actorId;
    }

    public String getDetail() {
        return detail;
    }

    public Instant getOccurredAt() {
        return occurredAt;
    }
}
