package ar.edu.itba.cloud.queue.service;

import ar.edu.itba.cloud.queue.config.AppProperties;
import ar.edu.itba.cloud.queue.persistence.entity.ServiceQueue;
import ar.edu.itba.cloud.queue.persistence.entity.QueueEntry;
import ar.edu.itba.cloud.queue.persistence.repository.EntryTimings;
import ar.edu.itba.cloud.queue.persistence.repository.QueueEntryRepository;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.HashMap;
import java.util.Objects;
import java.util.UUID;
import java.util.ArrayList;
import java.util.PriorityQueue;
import org.springframework.data.domain.PageRequest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * Turns queue configuration and recent history into the waiting time customers are shown.
 *
 * <p>The shared-station simulator is the product ETA source. The average duration comes from recent
 * completed services, falling back to the queue's configured default when there is no history.
 */
@Service
public class EstimationService {

    private final QueueEntryRepository entryRepository;
    private final AppProperties properties;
    private final QueueEntrySelector selector;

    @Autowired
    public EstimationService(QueueEntryRepository entryRepository, AppProperties properties, QueueEntrySelector selector) {
        this.entryRepository = entryRepository;
        this.properties = properties;
        this.selector = selector;
    }

    /** Kept for focused unit tests that do not exercise lane scheduling. */
    public EstimationService(QueueEntryRepository entryRepository, AppProperties properties) {
        this(entryRepository, properties, new QueueEntrySelector());
    }

    /** Mean duration of the most recent completed services on this queue. */
    public ServiceTimeEstimate averageServiceTime(ServiceQueue queue) {
        int sampleSize = Math.max(1, properties.estimation().serviceTimeSamples());
        List<EntryTimings> samples = entryRepository.findRecentServiceTimings(
                queue.getId(), PageRequest.of(0, sampleSize));

        List<Duration> durations = samples.stream()
                .map(EntryTimings::serviceDuration)
                .filter(Objects::nonNull)
                .filter(duration -> !duration.isNegative() && !duration.isZero())
                .toList();

        if (durations.isEmpty()) {
            return defaultEstimate(queue);
        }

        long averageSeconds = durations.stream().mapToLong(Duration::toSeconds).sum() / durations.size();
        if (averageSeconds <= 0) {
            return defaultEstimate(queue);
        }
        return new ServiceTimeEstimate(Duration.ofSeconds(averageSeconds), false, durations.size());
    }

    /**
     * Legacy linear helper retained for focused historical unit tests; product paths use {@link #estimate}.
     *
     * @param inService how many customers are already called or being attended, since they occupy the
     *                  service stations before anyone waiting gets their turn
     */
    public Duration estimateWait(ServiceQueue queue, int groupsAhead, int inService, Duration averageServiceTime) {
        int stations = Math.max(1, queue.getServiceStations());
        long queuedBefore = Math.max(0L, (long) groupsAhead + inService);
        long batches = Math.ceilDiv(queuedBefore, stations);
        return averageServiceTime.multipliedBy(batches);
    }

    /** Convenience overload that resolves the average service time itself. */
    public Duration estimateWait(ServiceQueue queue, int groupsAhead, int inService) {
        return estimateWait(queue, groupsAhead, inService, averageServiceTime(queue).duration());
    }

    public long countInService(UUID queueId) {
        return entryRepository.countByQueueIdAndStatusIn(queueId,
                List.of(ar.edu.itba.cloud.queue.persistence.entity.EntryStatus.CALLED,
                        ar.edu.itba.cloud.queue.persistence.entity.EntryStatus.SERVING));
    }

    /** Simulates shared stations without changing queue state. ETA is the target's service start. */
    public Simulation estimate(ServiceQueue queue, List<QueueEntry> waiting, List<QueueEntry> inService,
                               QueueEntry target, Duration averageServiceTime) {
        int laneAhead = 0;
        boolean found = false;
        for (QueueEntry entry : waiting) {
            if (entry == target || (target.getId() != null && target.getId().equals(entry.getId()))) { found = true; break; }
            if (sameLane(entry, target)) laneAhead++;
        }
        if (!found) throw new IllegalArgumentException("target must be waiting");

        PriorityQueue<Duration> stations = new PriorityQueue<>();
        for (int i = 0; i < Math.max(1, queue.getServiceStations()); i++) stations.add(Duration.ZERO);
        for (QueueEntry entry : inService) {
            Duration freeAt = stations.remove();
            stations.add(freeAt.plus(adjusted(averageServiceTime, entry)));
        }
        List<QueueEntry> remaining = new ArrayList<>(waiting);
        int cursor = queue.getRoundRobinPosition();
        int scheduledAhead = 0;
        while (!remaining.isEmpty()) {
            QueueEntrySelector.Selection selection = selector.select(queue, remaining, cursor);
            cursor = selection.nextRoundRobinPosition();
            QueueEntry entry = selection.entry();
            Duration start = stations.remove();
            if (entry == target || (target.getId() != null && target.getId().equals(entry.getId()))) {
                return new Simulation(laneAhead + 1, laneAhead, scheduledAhead, inService.size(), start);
            }
            stations.add(start.plus(adjusted(averageServiceTime, entry)));
            remaining.remove(entry);
            scheduledAhead++;
        }
        throw new IllegalStateException("target was not scheduled");
    }

    /**
     * The same simulation as {@link #estimate}, run once for the whole line.
     *
     * <p>Scheduling already walks every waiting group in the order they will be served, so one pass can
     * answer for all of them. That is what keeps a broadcast cheap: pushing to a hundred watchers costs
     * one simulation, not a hundred. Deriving each view separately would put the length of the line back
     * into the cost of every push.
     *
     * @return one simulation per waiting entry, keyed by entry id. Entries that are called or being
     *         served are absent: they no longer hold a place in the line.
     */
    public Map<UUID, Simulation> simulateAll(ServiceQueue queue, List<QueueEntry> waiting,
                                             List<QueueEntry> inService, Duration averageServiceTime) {
        // Lane position follows the order key, which is how the line is presented, not the order the
        // call strategy happens to schedule. An entry with no lane is never "behind" anyone.
        Map<UUID, Integer> laneAheadByEntry = new HashMap<>();
        Map<UUID, Integer> seenPerLane = new HashMap<>();
        for (QueueEntry entry : waiting) {
            if (entry.getLane() == null) {
                laneAheadByEntry.put(entry.getId(), 0);
                continue;
            }
            UUID laneId = entry.getLane().getId();
            int ahead = seenPerLane.getOrDefault(laneId, 0);
            laneAheadByEntry.put(entry.getId(), ahead);
            seenPerLane.put(laneId, ahead + 1);
        }

        PriorityQueue<Duration> stations = new PriorityQueue<>();
        for (int i = 0; i < Math.max(1, queue.getServiceStations()); i++) {
            stations.add(Duration.ZERO);
        }
        for (QueueEntry entry : inService) {
            stations.add(stations.remove().plus(adjusted(averageServiceTime, entry)));
        }

        Map<UUID, Simulation> simulations = new HashMap<>();
        List<QueueEntry> remaining = new ArrayList<>(waiting);
        int cursor = queue.getRoundRobinPosition();
        int scheduledAhead = 0;
        while (!remaining.isEmpty()) {
            QueueEntrySelector.Selection selection = selector.select(queue, remaining, cursor);
            cursor = selection.nextRoundRobinPosition();
            QueueEntry entry = selection.entry();
            Duration start = stations.remove();
            int laneAhead = laneAheadByEntry.getOrDefault(entry.getId(), 0);
            simulations.put(entry.getId(),
                    new Simulation(laneAhead + 1, laneAhead, scheduledAhead, inService.size(), start));
            stations.add(start.plus(adjusted(averageServiceTime, entry)));
            remaining.remove(entry);
            scheduledAhead++;
        }
        return simulations;
    }

    private static boolean sameLane(QueueEntry left, QueueEntry right) {
        return left.getLane() != null && right.getLane() != null && left.getLane().getId().equals(right.getLane().getId());
    }

    private static Duration adjusted(Duration base, QueueEntry entry) {
        double factor = entry.getLane() == null ? 1D : entry.getLane().getTimeFactor().doubleValue();
        return Duration.ofMillis(Math.max(1L, Math.round(base.toMillis() * factor)));
    }

    public record Simulation(int lanePosition, int laneGroupsAhead, int globalWaitingGroupsAhead,
                             int groupsInService, Duration estimatedWait) { }

    /** Rounds a duration up to whole minutes, which is how waits are shown to customers. */
    public static int toMinutes(Duration duration) {
        if (duration == null || duration.isNegative() || duration.isZero()) {
            return 0;
        }
        return (int) Math.ceilDiv(duration.toSeconds(), 60L);
    }

    private ServiceTimeEstimate defaultEstimate(ServiceQueue queue) {
        return new ServiceTimeEstimate(Duration.ofMinutes(queue.getDefaultServiceMinutes()), true, 0);
    }

    /**
     * @param usingDefault true when there was no service history and the queue's configured default
     *                     was used instead
     */
    public record ServiceTimeEstimate(Duration duration, boolean usingDefault, int sampleCount) {
    }
}
