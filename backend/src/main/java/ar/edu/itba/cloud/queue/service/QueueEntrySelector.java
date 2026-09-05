package ar.edu.itba.cloud.queue.service;

import ar.edu.itba.cloud.queue.persistence.entity.CallStrategy;
import ar.edu.itba.cloud.queue.persistence.entity.QueueEntry;
import ar.edu.itba.cloud.queue.persistence.entity.QueueLane;
import ar.edu.itba.cloud.queue.persistence.entity.ServiceQueue;
import java.util.Comparator;
import java.util.List;
import org.springframework.stereotype.Component;

/**
 * Deterministic, side-effect-free choice of the next waiting group.
 *
 * <p>Both the real call and the ETA simulation go through here, so the time a customer is quoted is
 * produced by the same rules that will actually serve them.
 *
 * <p><strong>Round robin rotates over the queue's lanes, not over the busy ones.</strong> The cursor is
 * an index, and it is persisted between calls, so it only means anything if the list it indexes is
 * stable. Indexing the lanes that happen to have somebody waiting made the cursor change meaning every
 * time a lane emptied or filled: with lanes A, B and C, serving A then B leaves the cursor at 2 - "C
 * next" - but once A empties the list is two long, the cursor folds back to 0, and B is served again
 * while C is skipped. The lane most often empty is the one the rotation exists to protect, so that is
 * exactly the wrong lane to cheat. Taking the full rotation makes the cursor mean the same thing on
 * every call.
 */
@Component
public class QueueEntrySelector {
    private static final Comparator<QueueEntry> BY_AGE = Comparator.comparingLong(QueueEntry::getOrderKey)
            .thenComparing(QueueEntry::getJoinedAt);
    private static final Comparator<QueueLane> LANE_ORDER = Comparator.comparingInt(QueueLane::getPriority)
            .thenComparing(lane -> lane.getId() == null ? "" : lane.getId().toString());

    /** The lanes a round robin rotates over: every active lane of the queue, in a stable order. */
    public List<QueueLane> rotation(List<QueueLane> lanes) {
        return lanes.stream().filter(QueueLane::isActive).sorted(LANE_ORDER).toList();
    }

    /**
     * @param rotation every active lane of the queue, from {@link #rotation}. Only ROUND_ROBIN reads it;
     *                 when it is empty the choice falls back to the oldest group waiting.
     */
    public Selection select(ServiceQueue queue, List<QueueLane> rotation, List<QueueEntry> waiting,
                            int roundRobinPosition) {
        if (waiting.isEmpty()) throw new IllegalArgumentException("waiting must not be empty");
        if (queue.getCallStrategy() == CallStrategy.LANE_PRIORITY) {
            QueueEntry next = waiting.stream().min(Comparator
                    .comparingInt((QueueEntry e) -> e.getLane() == null ? Integer.MAX_VALUE : e.getLane().getPriority())
                    .thenComparing(BY_AGE)).orElseThrow();
            return new Selection(next, roundRobinPosition);
        }
        if (queue.getCallStrategy() == CallStrategy.ROUND_ROBIN) {
            List<QueueLane> lanes = rotation;
            if (!lanes.isEmpty()) {
                int start = Math.floorMod(roundRobinPosition, lanes.size());
                for (int offset = 0; offset < lanes.size(); offset++) {
                    int laneIndex = (start + offset) % lanes.size();
                    QueueLane lane = lanes.get(laneIndex);
                    QueueEntry next = waiting.stream()
                            .filter(e -> e.getLane() != null && lane.getId().equals(e.getLane().getId()))
                            .min(BY_AGE).orElse(null);
                    if (next != null) return new Selection(next, (laneIndex + 1) % lanes.size());
                }
            }
        }
        return new Selection(waiting.stream().min(BY_AGE).orElseThrow(), roundRobinPosition);
    }

    public record Selection(QueueEntry entry, int nextRoundRobinPosition) { }
}
