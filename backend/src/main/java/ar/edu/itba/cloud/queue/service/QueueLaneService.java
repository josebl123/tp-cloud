package ar.edu.itba.cloud.queue.service;

import ar.edu.itba.cloud.queue.exception.ConflictException;
import ar.edu.itba.cloud.queue.exception.ValidationException;
import ar.edu.itba.cloud.queue.persistence.entity.EntryStatus;
import ar.edu.itba.cloud.queue.persistence.entity.LaneCapacityMode;
import ar.edu.itba.cloud.queue.persistence.entity.QueueLane;
import ar.edu.itba.cloud.queue.persistence.entity.ServiceQueue;
import ar.edu.itba.cloud.queue.persistence.entity.QueueStatus;
import ar.edu.itba.cloud.queue.persistence.repository.QueueEntryRepository;
import ar.edu.itba.cloud.queue.persistence.repository.QueueLaneRepository;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class QueueLaneService {
    private final QueueLaneRepository lanes;
    private final QueueEntryRepository entries;
    public QueueLaneService(QueueLaneRepository lanes, QueueEntryRepository entries) { this.lanes = lanes; this.entries = entries; }

    public QueueLane defaultLane(ServiceQueue queue, Instant now) {
        return lanes.findByQueueIdAndName(queue.getId(), "1+")
                .orElseGet(() -> lanes.save(new QueueLane(queue, "1+", 1, null, 0,
                        LaneCapacityMode.GROUPS, null, BigDecimal.ONE, now)));
    }

    public QueueLane select(ServiceQueue queue, int partySize) {
        List<QueueLane> matches = lanes.findAllByQueueIdOrderByPriorityAscMinPartySizeAsc(queue.getId()).stream()
                .filter(lane -> lane.accepts(partySize))
                // Matching is independent from call priority: among nested ranges, the innermost
                // range is the most specific rule for a group size.
                .sorted(Comparator.comparingInt(QueueLane::getMinPartySize).reversed()
                        .thenComparingInt(QueueLaneService::upper))
                .toList();
        if (matches.isEmpty()) throw new ConflictException("NO_COMPATIBLE_LANE", "No active lane accepts a party of %d".formatted(partySize));
        return matches.getFirst();
    }

    public void ensureCapacity(QueueLane lane, int partySize) {
        if (lane.getMaxSize() == null) return;
        long used = entries.findAllByQueueIdAndLaneIdAndStatusIn(lane.getQueue().getId(), lane.getId(), EntryStatus.active())
                .stream().mapToLong(e -> lane.getCapacityMode() == LaneCapacityMode.PERSONS ? e.getPartySize() : 1).sum();
        long requested = lane.getCapacityMode() == LaneCapacityMode.PERSONS ? partySize : 1;
        if (used + requested > lane.getMaxSize()) throw new ConflictException("LANE_FULL", "Lane '%s' has reached its capacity".formatted(lane.getName()));
    }

    public boolean hasCapacity(QueueLane lane, int partySize) {
        try {
            ensureCapacity(lane, partySize);
            return true;
        } catch (ConflictException exception) {
            return false;
        }
    }

    public static void validate(QueueLane lane) {
        if (lane.getMinPartySize() < 1 || (lane.getMaxPartySize() != null && lane.getMaxPartySize() < lane.getMinPartySize()))
            throw new ValidationException("INVALID_LANE_RANGE", "Lane party-size range is invalid");
        if (lane.getMaxSize() != null && lane.getMaxSize() < 1)
            throw new ValidationException("INVALID_LANE_CAPACITY", "Lane capacity must be positive");
        if (lane.getPriority() < 0 || lane.getTimeFactor() == null || lane.getTimeFactor().signum() <= 0)
            throw new ValidationException("INVALID_LANE_CONFIGURATION", "Lane priority and time factor are invalid");
    }

    public List<QueueLane> list(ServiceQueue queue) {
        return lanes.findAllByQueueIdOrderByPriorityAscMinPartySizeAsc(queue.getId());
    }

    @Transactional
    public QueueLane create(ServiceQueue queue, ar.edu.itba.cloud.queue.service.command.QueueLaneCommand c, Instant now) {
        requireOperable(queue);
        QueueLane lane = new QueueLane(queue, c.name().trim(), c.minPartySize(), c.maxPartySize(), c.priority(),
                c.capacityMode() == null ? LaneCapacityMode.GROUPS : c.capacityMode(), c.maxSize(), c.timeFactor(), now);
        if (c.active() != null) lane.setActive(c.active());
        validate(lane);
        // Active ranges may be disjoint or nested. The historical 1+ lane remains an active
        // fallback: a more specific nested lane wins during matching.
        validateOverlap(queue, lane, null);
        return lanes.save(lane);
    }

    @Transactional
    public QueueLane update(QueueLane lane, ar.edu.itba.cloud.queue.service.command.QueueLaneCommand c) {
        requireOperable(lane.getQueue());
        lane.setName(c.name().trim()); lane.setMinPartySize(c.minPartySize()); lane.setMaxPartySize(c.maxPartySize());
        lane.setPriority(c.priority()); lane.setCapacityMode(c.capacityMode() == null ? LaneCapacityMode.GROUPS : c.capacityMode());
        lane.setMaxSize(c.maxSize()); lane.setTimeFactor(c.timeFactor() == null ? BigDecimal.ONE : c.timeFactor()); if (c.active() != null) lane.setActive(c.active());
        validate(lane);
        if (!lane.isActive() && activeCount(lane.getQueue(), lane.getId()) == 0) {
            throw new ConflictException("LAST_ACTIVE_LANE", "A queue must keep at least one active lane");
        }
        validateOverlap(lane.getQueue(), lane, lane.getId());
        return lanes.save(lane);
    }

    @Transactional
    public void delete(QueueLane lane) {
        requireOperable(lane.getQueue());
        if (lane.isActive() && activeCount(lane.getQueue(), lane.getId()) == 0) {
            throw new ConflictException("LAST_ACTIVE_LANE", "A queue must keep at least one active lane");
        }
        if (entries.countByLaneIdAndStatusIn(lane.getId(), EntryStatus.active()) > 0)
            throw new ConflictException("LANE_HAS_ACTIVE_ENTRIES", "A lane with active entries cannot be deleted");
        lanes.delete(lane);
    }

    private void validateOverlap(ServiceQueue queue, QueueLane candidate, java.util.UUID excluded) {
        for (QueueLane other : list(queue)) {
            if (excluded != null && excluded.equals(other.getId())) continue;
            if (!other.isActive() || !candidate.isActive() || !intersects(candidate, other)) continue;
            if (!contains(candidate, other) && !contains(other, candidate)) {
                throw new ValidationException("CROSSING_LANE_RANGES",
                        "Active lane ranges may be disjoint or nested, but cannot partially overlap");
            }
        }
    }
    private static int upper(QueueLane l) { return l.getMaxPartySize() == null ? Integer.MAX_VALUE : l.getMaxPartySize(); }

    private static boolean intersects(QueueLane left, QueueLane right) {
        return left.getMinPartySize() <= upper(right) && right.getMinPartySize() <= upper(left);
    }

    private static boolean contains(QueueLane outer, QueueLane inner) {
        return outer.getMinPartySize() <= inner.getMinPartySize() && upper(outer) >= upper(inner);
    }

    private long activeCount(ServiceQueue queue, java.util.UUID excluded) {
        return list(queue).stream().filter(QueueLane::isActive)
                .filter(lane -> !lane.getId().equals(excluded)).count();
    }

    private static void requireOperable(ServiceQueue queue) {
        if (queue.getArchivedAt() != null || queue.getStatus() == QueueStatus.CLOSED) {
            throw new ConflictException("QUEUE_ARCHIVED", "Lanes cannot be changed on a closed or archived queue");
        }
    }
}
