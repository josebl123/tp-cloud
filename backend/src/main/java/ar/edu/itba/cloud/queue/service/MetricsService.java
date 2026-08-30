package ar.edu.itba.cloud.queue.service;

import ar.edu.itba.cloud.queue.exception.NotFoundException;
import ar.edu.itba.cloud.queue.persistence.entity.EntryStatus;
import ar.edu.itba.cloud.queue.persistence.entity.Establishment;
import ar.edu.itba.cloud.queue.persistence.entity.ServiceQueue;
import ar.edu.itba.cloud.queue.persistence.repository.EntryTimings;
import ar.edu.itba.cloud.queue.persistence.repository.EstablishmentRepository;
import ar.edu.itba.cloud.queue.persistence.repository.QueueEntryRepository;
import ar.edu.itba.cloud.queue.persistence.repository.ServiceQueueRepository;
import ar.edu.itba.cloud.queue.service.model.MetricsRange;
import ar.edu.itba.cloud.queue.service.model.MetricsView;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Functionality 4: the numbers the staff panel shows.
 *
 * <p>Ranges are anchored to the establishment's local calendar day rather than to UTC, so "today"
 * means what the staff standing behind the counter think it means.
 *
 * <p>Averages are computed in Java over a projection of timestamps instead of in SQL. For MVP volumes
 * that is a handful of rows per query and keeps the maths readable and unit-testable; the natural next
 * step at scale is a pre-aggregated daily rollup.
 */
@Service
public class MetricsService {

    private final QueueEntryRepository entryRepository;
    private final ServiceQueueRepository queueRepository;
    private final EstablishmentRepository establishmentRepository;
    private final AccessGuard accessGuard;
    private final Clock clock;

    public MetricsService(QueueEntryRepository entryRepository,
                          ServiceQueueRepository queueRepository,
                          EstablishmentRepository establishmentRepository,
                          AccessGuard accessGuard,
                          Clock clock) {
        this.entryRepository = entryRepository;
        this.queueRepository = queueRepository;
        this.establishmentRepository = establishmentRepository;
        this.accessGuard = accessGuard;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public MetricsView forQueue(UUID userId, UUID queueId, MetricsRange range) {
        ServiceQueue queue = queueRepository.findByIdWithEstablishment(queueId)
                .orElseThrow(() -> NotFoundException.queue(queueId));
        accessGuard.requireMember(userId, queue.getEstablishment().getId());

        Window window = windowFor(queue.getEstablishment(), range);
        List<EntryTimings> finished = entryRepository.findFinishedTimingsByQueue(
                queueId, window.from(), window.to());

        long waitingNow = entryRepository.countByQueueIdAndStatus(queueId, EntryStatus.WAITING);
        long inServiceNow = entryRepository.countByQueueIdAndStatusIn(queueId,
                List.of(EntryStatus.CALLED, EntryStatus.SERVING));

        return build(queueId, queue.getName(), range, window, finished, waitingNow, inServiceNow);
    }

    @Transactional(readOnly = true)
    public MetricsView forEstablishment(UUID userId, UUID establishmentId, MetricsRange range) {
        accessGuard.requireMember(userId, establishmentId);
        Establishment establishment = establishmentRepository.findById(establishmentId)
                .orElseThrow(() -> NotFoundException.establishment(establishmentId));

        Window window = windowFor(establishment, range);
        List<EntryTimings> finished = entryRepository.findFinishedTimingsByEstablishment(
                establishmentId, window.from(), window.to());

        long waitingNow = entryRepository.countByEstablishmentAndStatusIn(
                establishmentId, List.of(EntryStatus.WAITING));
        long inServiceNow = entryRepository.countByEstablishmentAndStatusIn(
                establishmentId, List.of(EntryStatus.CALLED, EntryStatus.SERVING));

        return build(null, establishment.getName(), range, window, finished, waitingNow, inServiceNow);
    }

    private MetricsView build(UUID queueId, String scopeName, MetricsRange range, Window window,
                              List<EntryTimings> finished, long waitingNow, long inServiceNow) {
        long served = finished.stream().filter(timing -> timing.status() == EntryStatus.SERVED).count();
        long noShow = finished.stream().filter(timing -> timing.status() == EntryStatus.NO_SHOW).count();
        long left = finished.stream().filter(timing -> timing.status() == EntryStatus.LEFT).count();
        long total = finished.size();

        Integer averageWait = averageMinutes(finished.stream()
                .filter(timing -> timing.status() == EntryStatus.SERVED)
                .map(EntryTimings::waitDuration)
                .filter(Objects::nonNull)
                .toList());

        Integer averageService = averageMinutes(finished.stream()
                .filter(timing -> timing.status() == EntryStatus.SERVED)
                .map(EntryTimings::serviceDuration)
                .filter(Objects::nonNull)
                .toList());

        return new MetricsView(queueId, scopeName, range, window.from(), window.to(),
                waitingNow, inServiceNow, served, noShow, left, total,
                averageWait, averageService,
                ratio(left, total), ratio(noShow, total));
    }

    /** The half-open interval [start of the first local day, start of tomorrow). */
    private Window windowFor(Establishment establishment, MetricsRange range) {
        ZoneId zone = zoneOf(establishment);
        LocalDate today = LocalDate.now(clock.withZone(zone));
        Instant to = today.plusDays(1).atStartOfDay(zone).toInstant();
        Instant from = today.minusDays(range.days() - 1L).atStartOfDay(zone).toInstant();
        return new Window(from, to);
    }

    private ZoneId zoneOf(Establishment establishment) {
        try {
            return ZoneId.of(establishment.getTimezone());
        } catch (Exception ex) {
            return ZoneId.of(Establishment.DEFAULT_TIMEZONE);
        }
    }

    private static Integer averageMinutes(List<Duration> durations) {
        if (durations.isEmpty()) {
            return null;
        }
        long totalSeconds = durations.stream()
                .filter(duration -> !duration.isNegative())
                .mapToLong(Duration::toSeconds)
                .sum();
        return EstimationService.toMinutes(Duration.ofSeconds(totalSeconds / durations.size()));
    }

    private static double ratio(long part, long total) {
        return total == 0 ? 0.0 : Math.round((double) part / total * 10_000d) / 10_000d;
    }

    private record Window(Instant from, Instant to) {
    }
}
