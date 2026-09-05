package ar.edu.itba.cloud.queue.service;

import ar.edu.itba.cloud.queue.persistence.entity.CallStrategy;
import ar.edu.itba.cloud.queue.persistence.entity.QueueEntry;
import ar.edu.itba.cloud.queue.persistence.entity.QueueLane;
import ar.edu.itba.cloud.queue.persistence.entity.ServiceQueue;
import java.util.Comparator;
import java.util.List;
import org.springframework.stereotype.Component;

/** Deterministic, side-effect-free choice of the next waiting group. */
@Component
public class QueueEntrySelector {
    private static final Comparator<QueueEntry> BY_AGE = Comparator.comparingLong(QueueEntry::getOrderKey)
            .thenComparing(QueueEntry::getJoinedAt);
    private static final Comparator<QueueLane> LANE_ORDER = Comparator.comparingInt(QueueLane::getPriority)
            .thenComparing(lane -> lane.getId() == null ? "" : lane.getId().toString());

    public Selection select(ServiceQueue queue, List<QueueEntry> waiting, int roundRobinPosition) {
        if (waiting.isEmpty()) throw new IllegalArgumentException("waiting must not be empty");
        if (queue.getCallStrategy() == CallStrategy.LANE_PRIORITY) {
            QueueEntry next = waiting.stream().min(Comparator
                    .comparingInt((QueueEntry e) -> e.getLane() == null ? Integer.MAX_VALUE : e.getLane().getPriority())
                    .thenComparing(BY_AGE)).orElseThrow();
            return new Selection(next, roundRobinPosition);
        }
        if (queue.getCallStrategy() == CallStrategy.ROUND_ROBIN) {
            List<QueueLane> lanes = waiting.stream().map(QueueEntry::getLane).filter(java.util.Objects::nonNull)
                    .distinct().sorted(LANE_ORDER).toList();
            if (!lanes.isEmpty()) {
                int start = Math.floorMod(roundRobinPosition, lanes.size());
                for (int offset = 0; offset < lanes.size(); offset++) {
                    int laneIndex = (start + offset) % lanes.size();
                    QueueLane lane = lanes.get(laneIndex);
                    QueueEntry next = waiting.stream().filter(e -> lane.getId().equals(e.getLane().getId()))
                            .min(BY_AGE).orElse(null);
                    if (next != null) return new Selection(next, (laneIndex + 1) % lanes.size());
                }
            }
        }
        return new Selection(waiting.stream().min(BY_AGE).orElseThrow(), roundRobinPosition);
    }

    public record Selection(QueueEntry entry, int nextRoundRobinPosition) { }
}
