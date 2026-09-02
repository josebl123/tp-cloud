package ar.edu.itba.cloud.queue.persistence.entity;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "queue_lane")
public class QueueLane {
    @Id @GeneratedValue(strategy = GenerationType.UUID) private UUID id;
    @ManyToOne(fetch = FetchType.LAZY, optional = false) @JoinColumn(name = "queue_id", nullable = false)
    private ServiceQueue queue;
    @Column(nullable = false, length = 120) private String name;
    @Column(name = "min_party_size", nullable = false) private int minPartySize = 1;
    @Column(name = "max_party_size") private Integer maxPartySize;
    @Column(nullable = false) private int priority;
    @Enumerated(EnumType.STRING) @Column(name = "capacity_mode", nullable = false, length = 16)
    private LaneCapacityMode capacityMode = LaneCapacityMode.GROUPS;
    @Column(name = "max_size") private Integer maxSize;
    @Column(name = "time_factor", nullable = false, precision = 8, scale = 3) private BigDecimal timeFactor = BigDecimal.ONE;
    @Column(nullable = false) private boolean active = true;
    @Column(name = "created_at", nullable = false, updatable = false) private Instant createdAt;

    protected QueueLane() { }
    public QueueLane(ServiceQueue queue, String name, int minPartySize, Integer maxPartySize, int priority,
                     LaneCapacityMode capacityMode, Integer maxSize, BigDecimal timeFactor, Instant createdAt) {
        this.queue = queue; this.name = name; this.minPartySize = minPartySize; this.maxPartySize = maxPartySize;
        this.priority = priority; this.capacityMode = capacityMode; this.maxSize = maxSize;
        this.timeFactor = timeFactor == null ? BigDecimal.ONE : timeFactor; this.createdAt = createdAt;
    }
    public UUID getId() { return id; } public ServiceQueue getQueue() { return queue; }
    public String getName() { return name; } public void setName(String v) { name = v; }
    public int getMinPartySize() { return minPartySize; } public void setMinPartySize(int v) { minPartySize = v; }
    public Integer getMaxPartySize() { return maxPartySize; } public void setMaxPartySize(Integer v) { maxPartySize = v; }
    public int getPriority() { return priority; } public void setPriority(int v) { priority = v; }
    public LaneCapacityMode getCapacityMode() { return capacityMode; } public void setCapacityMode(LaneCapacityMode v) { capacityMode = v; }
    public Integer getMaxSize() { return maxSize; } public void setMaxSize(Integer v) { maxSize = v; }
    public BigDecimal getTimeFactor() { return timeFactor; } public void setTimeFactor(BigDecimal v) { timeFactor = v; }
    public boolean isActive() { return active; } public void setActive(boolean v) { active = v; }
    public boolean accepts(int partySize) { return active && partySize >= minPartySize && (maxPartySize == null || partySize <= maxPartySize); }
}
