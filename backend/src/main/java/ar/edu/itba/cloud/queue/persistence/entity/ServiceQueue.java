package ar.edu.itba.cloud.queue.persistence.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/**
 * A single line customers wait in. One queue maps to exactly one QR code.
 *
 * <p>The {@code nextTicketNumber} and {@code nextOrderKey} counters are allocated while the row is
 * held under a pessimistic write lock, which is what keeps concurrent joins from colliding.
 */
@Entity
@Table(name = "service_queue")
public class ServiceQueue {

    /** Spacing between consecutive order keys, so entries can be re-inserted between neighbours. */
    public static final long ORDER_KEY_GAP = 1000L;

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "establishment_id", nullable = false, updatable = false)
    private Establishment establishment;

    @Column(name = "name", nullable = false, length = 120)
    private String name;

    @Column(name = "description", length = 500)
    private String description;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 16)
    private QueueStatus status = QueueStatus.OPEN;

    /** How many customers can be served in parallel (cashiers, tables, desks). */
    @Column(name = "service_stations", nullable = false)
    private int serviceStations = 1;

    /** Used for the ETA until there is enough real service history. */
    @Column(name = "default_service_minutes", nullable = false)
    private int defaultServiceMinutes = 5;

    /** Maximum number of people holding a place; {@code null} means unlimited. */
    @Column(name = "max_size")
    private Integer maxSize;

    @Column(name = "grace_period_seconds", nullable = false)
    private int gracePeriodSeconds = 120;

    @Enumerated(EnumType.STRING)
    @Column(name = "no_show_policy", nullable = false, length = 24)
    private NoShowPolicy noShowPolicy = NoShowPolicy.MOVE_TO_END;

    /** Only meaningful when {@link #noShowPolicy} is {@link NoShowPolicy#MOVE_BACK}. */
    @Column(name = "move_back_positions", nullable = false)
    private int moveBackPositions = 3;

    /** Notify when this many people (or fewer) are ahead; {@code null} disables it. */
    @Column(name = "notify_at_position")
    private Integer notifyAtPosition;

    /** Notify when the ETA drops to this many minutes or fewer; {@code null} disables it. */
    @Column(name = "notify_at_minutes")
    private Integer notifyAtMinutes;

    @Column(name = "require_party_size", nullable = false)
    private boolean requirePartySize = false;

    @Enumerated(EnumType.STRING)
    @Column(name = "call_strategy", nullable = false, length = 24)
    private CallStrategy callStrategy = CallStrategy.GLOBAL_AGE;

    @Column(name = "round_robin_position", nullable = false)
    private int roundRobinPosition;

    @Column(name = "next_ticket_number", nullable = false)
    private long nextTicketNumber = 1L;

    @Column(name = "next_order_key", nullable = false)
    private long nextOrderKey = ORDER_KEY_GAP;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Column(name = "archived_at")
    private Instant archivedAt;

    protected ServiceQueue() {
        // for JPA
    }

    public ServiceQueue(Establishment establishment, String name, Instant now) {
        this.establishment = establishment;
        this.name = name;
        this.createdAt = now;
        this.updatedAt = now;
    }

    /** Reserves the next customer-facing ticket number for this queue. */
    public long allocateTicketNumber() {
        return nextTicketNumber++;
    }

    /** Reserves an order key that sorts after every key handed out so far. */
    public long allocateOrderKey() {
        long allocated = nextOrderKey;
        nextOrderKey += ORDER_KEY_GAP;
        return allocated;
    }

    /** Keeps the counter ahead of a key written directly (used when re-normalising the line). */
    public void ensureOrderKeyAbove(long key) {
        if (nextOrderKey <= key) {
            nextOrderKey = key + ORDER_KEY_GAP;
        }
    }

    public boolean acceptsNewEntries() {
        return status == QueueStatus.OPEN && archivedAt == null;
    }

    public UUID getId() {
        return id;
    }

    public Establishment getEstablishment() {
        return establishment;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public QueueStatus getStatus() {
        return status;
    }

    public void setStatus(QueueStatus status) {
        this.status = status;
    }

    public int getServiceStations() {
        return serviceStations;
    }

    public void setServiceStations(int serviceStations) {
        this.serviceStations = serviceStations;
    }

    public int getDefaultServiceMinutes() {
        return defaultServiceMinutes;
    }

    public void setDefaultServiceMinutes(int defaultServiceMinutes) {
        this.defaultServiceMinutes = defaultServiceMinutes;
    }

    public Integer getMaxSize() {
        return maxSize;
    }

    public void setMaxSize(Integer maxSize) {
        this.maxSize = maxSize;
    }

    public int getGracePeriodSeconds() {
        return gracePeriodSeconds;
    }

    public void setGracePeriodSeconds(int gracePeriodSeconds) {
        this.gracePeriodSeconds = gracePeriodSeconds;
    }

    public NoShowPolicy getNoShowPolicy() {
        return noShowPolicy;
    }

    public void setNoShowPolicy(NoShowPolicy noShowPolicy) {
        this.noShowPolicy = noShowPolicy;
    }

    public int getMoveBackPositions() {
        return moveBackPositions;
    }

    public void setMoveBackPositions(int moveBackPositions) {
        this.moveBackPositions = moveBackPositions;
    }

    public Integer getNotifyAtPosition() {
        return notifyAtPosition;
    }

    public void setNotifyAtPosition(Integer notifyAtPosition) {
        this.notifyAtPosition = notifyAtPosition;
    }

    public Integer getNotifyAtMinutes() {
        return notifyAtMinutes;
    }

    public void setNotifyAtMinutes(Integer notifyAtMinutes) {
        this.notifyAtMinutes = notifyAtMinutes;
    }

    public boolean isRequirePartySize() {
        return requirePartySize;
    }

    public void setRequirePartySize(boolean requirePartySize) {
        this.requirePartySize = requirePartySize;
    }

    public CallStrategy getCallStrategy() { return callStrategy; }
    public void setCallStrategy(CallStrategy value) { callStrategy = value; }
    public int getRoundRobinPosition() { return roundRobinPosition; }
    public void setRoundRobinPosition(int value) { roundRobinPosition = value; }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
    public Instant getArchivedAt() { return archivedAt; }
    public void setArchivedAt(Instant archivedAt) { this.archivedAt = archivedAt; }

    public void setUpdatedAt(Instant updatedAt) {
        this.updatedAt = updatedAt;
    }
}
