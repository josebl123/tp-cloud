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
 * One customer's place in a queue.
 *
 * <p>{@code ticketToken} is the only credential a customer ever holds: it is opaque, unguessable and
 * travels in the personal link sent to their contact channel.
 */
@Entity
@Table(name = "queue_entry")
public class QueueEntry {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "queue_id", nullable = false, updatable = false)
    private ServiceQueue queue;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "lane_id", nullable = false, updatable = false)
    private QueueLane lane;

    @Column(name = "ticket_token", nullable = false, unique = true, updatable = false)
    private UUID ticketToken;

    /** Customer-facing number, unique and increasing within the queue. */
    @Column(name = "ticket_number", nullable = false, updatable = false)
    private long ticketNumber;

    @Column(name = "customer_name", nullable = false, length = 120)
    private String customerName;

    @Column(name = "customer_email", length = 255)
    private String customerEmail;

    @Column(name = "customer_phone", length = 40)
    private String customerPhone;

    @Column(name = "party_size", nullable = false)
    private Integer partySize;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 16)
    private EntryStatus status = EntryStatus.WAITING;

    /** Sort key inside the queue. Lower comes first. */
    @Column(name = "order_key", nullable = false)
    private long orderKey;

    /**
     * Incremented every time the entry goes back to WAITING after being called, so the
     * per-notification-type uniqueness does not suppress a legitimate second "your turn".
     */
    @Column(name = "notification_cycle", nullable = false)
    private int notificationCycle = 0;

    @Column(name = "no_show_count", nullable = false)
    private int noShowCount = 0;

    @Column(name = "joined_at", nullable = false, updatable = false)
    private Instant joinedAt;

    @Column(name = "called_at")
    private Instant calledAt;

    @Column(name = "serving_started_at")
    private Instant servingStartedAt;

    /** When the entry reached a terminal status (SERVED, LEFT or NO_SHOW). */
    @Column(name = "finished_at")
    private Instant finishedAt;

    /** Deadline for the customer to show up after being called; null unless CALLED. */
    @Column(name = "grace_expires_at")
    private Instant graceExpiresAt;

    protected QueueEntry() {
        // for JPA
    }

    public QueueEntry(ServiceQueue queue, UUID ticketToken, long ticketNumber, long orderKey,
                      String customerName, String customerEmail, String customerPhone,
                      Integer partySize, Instant joinedAt) {
        this(queue, null, ticketToken, ticketNumber, orderKey, customerName, customerEmail, customerPhone, partySize, joinedAt);
    }

    public QueueEntry(ServiceQueue queue, QueueLane lane, UUID ticketToken, long ticketNumber, long orderKey,
                      String customerName, String customerEmail, String customerPhone,
                      Integer partySize, Instant joinedAt) {
        this.queue = queue;
        this.lane = lane;
        this.ticketToken = ticketToken;
        this.ticketNumber = ticketNumber;
        this.orderKey = orderKey;
        this.customerName = customerName;
        this.customerEmail = customerEmail;
        this.customerPhone = customerPhone;
        this.partySize = partySize;
        this.joinedAt = joinedAt;
        this.status = EntryStatus.WAITING;
    }

    public void nextNotificationCycle() {
        this.notificationCycle++;
    }

    public void incrementNoShowCount() {
        this.noShowCount++;
    }

    public UUID getId() {
        return id;
    }

    public ServiceQueue getQueue() {
        return queue;
    }

    public QueueLane getLane() { return lane; }

    public UUID getTicketToken() {
        return ticketToken;
    }

    public long getTicketNumber() {
        return ticketNumber;
    }

    public String getCustomerName() {
        return customerName;
    }

    public String getCustomerEmail() {
        return customerEmail;
    }

    public String getCustomerPhone() {
        return customerPhone;
    }

    public Integer getPartySize() {
        return partySize;
    }

    public EntryStatus getStatus() {
        return status;
    }

    public void setStatus(EntryStatus status) {
        this.status = status;
    }

    public long getOrderKey() {
        return orderKey;
    }

    public void setOrderKey(long orderKey) {
        this.orderKey = orderKey;
    }

    public int getNotificationCycle() {
        return notificationCycle;
    }

    public int getNoShowCount() {
        return noShowCount;
    }

    public Instant getJoinedAt() {
        return joinedAt;
    }

    public Instant getCalledAt() {
        return calledAt;
    }

    public void setCalledAt(Instant calledAt) {
        this.calledAt = calledAt;
    }

    public Instant getServingStartedAt() {
        return servingStartedAt;
    }

    public void setServingStartedAt(Instant servingStartedAt) {
        this.servingStartedAt = servingStartedAt;
    }

    public Instant getFinishedAt() {
        return finishedAt;
    }

    public void setFinishedAt(Instant finishedAt) {
        this.finishedAt = finishedAt;
    }

    public Instant getGraceExpiresAt() {
        return graceExpiresAt;
    }

    public void setGraceExpiresAt(Instant graceExpiresAt) {
        this.graceExpiresAt = graceExpiresAt;
    }
}
