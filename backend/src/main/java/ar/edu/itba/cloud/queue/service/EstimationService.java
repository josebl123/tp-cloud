package ar.edu.itba.cloud.queue.service;

import ar.edu.itba.cloud.queue.config.AppProperties;
import ar.edu.itba.cloud.queue.persistence.entity.ServiceQueue;
import ar.edu.itba.cloud.queue.persistence.repository.EntryTimings;
import ar.edu.itba.cloud.queue.persistence.repository.QueueEntryRepository;
import java.time.Duration;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;

/**
 * Turns queue configuration and recent history into the waiting time customers are shown.
 *
 * <p>The model is deliberately simple and explainable:
 * <pre>
 *   wait = ceil((peopleAhead + peopleBeingAttended) / serviceStations) x averageServiceTime
 * </pre>
 * where {@code averageServiceTime} is the mean of the last N completed services, falling back to the
 * queue's configured default until there is any history at all.
 */
@Service
public class EstimationService {

    private final QueueEntryRepository entryRepository;
    private final AppProperties properties;

    public EstimationService(QueueEntryRepository entryRepository, AppProperties properties) {
        this.entryRepository = entryRepository;
        this.properties = properties;
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
     * Waiting time for a customer with {@code peopleAhead} customers still queued in front of them.
     *
     * @param inService how many customers are already called or being attended, since they occupy the
     *                  service stations before anyone waiting gets their turn
     */
    public Duration estimateWait(ServiceQueue queue, int peopleAhead, int inService, Duration averageServiceTime) {
        int stations = Math.max(1, queue.getServiceStations());
        long queuedBefore = Math.max(0L, (long) peopleAhead + inService);
        long batches = Math.ceilDiv(queuedBefore, stations);
        return averageServiceTime.multipliedBy(batches);
    }

    /** Convenience overload that resolves the average service time itself. */
    public Duration estimateWait(ServiceQueue queue, int peopleAhead, int inService) {
        return estimateWait(queue, peopleAhead, inService, averageServiceTime(queue).duration());
    }

    public long countInService(UUID queueId) {
        return entryRepository.countByQueueIdAndStatusIn(queueId,
                List.of(ar.edu.itba.cloud.queue.persistence.entity.EntryStatus.CALLED,
                        ar.edu.itba.cloud.queue.persistence.entity.EntryStatus.SERVING));
    }

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
