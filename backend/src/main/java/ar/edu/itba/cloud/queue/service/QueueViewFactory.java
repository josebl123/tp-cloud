package ar.edu.itba.cloud.queue.service;

import ar.edu.itba.cloud.queue.config.AppProperties;
import ar.edu.itba.cloud.queue.persistence.entity.EntryStatus;
import ar.edu.itba.cloud.queue.persistence.entity.QueueEntry;
import ar.edu.itba.cloud.queue.persistence.entity.ServiceQueue;
import ar.edu.itba.cloud.queue.service.model.EntryView;
import ar.edu.itba.cloud.queue.service.model.PublicQueueView;
import ar.edu.itba.cloud.queue.service.model.QueueSnapshot;
import ar.edu.itba.cloud.queue.service.model.QueueSummary;
import ar.edu.itba.cloud.queue.service.model.QueueView;
import ar.edu.itba.cloud.queue.service.model.TicketView;
import java.time.Clock;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Component;

/**
 * Builds every read model from entities.
 *
 * <p>Position and ETA are derived here rather than stored, so they can never drift out of sync with
 * the line: the order of the WAITING list <em>is</em> the position.
 */
@Component
public class QueueViewFactory {

    private final AppProperties properties;
    private final EstimationService estimationService;
    private final Clock clock;

    public QueueViewFactory(AppProperties properties, EstimationService estimationService, Clock clock) {
        this.properties = properties;
        this.estimationService = estimationService;
        this.clock = clock;
    }

    public QueueView queueView(ServiceQueue queue) {
        return new QueueView(
                queue.getId(),
                queue.getEstablishment().getId(),
                queue.getEstablishment().getName(),
                queue.getName(),
                queue.getDescription(),
                queue.getStatus(),
                queue.getServiceStations(),
                queue.getDefaultServiceMinutes(),
                queue.getMaxSize(),
                queue.getGracePeriodSeconds(),
                queue.getNoShowPolicy(),
                queue.getMoveBackPositions(),
                queue.getNotifyAtPosition(),
                queue.getNotifyAtMinutes(),
                queue.isRequirePartySize(),
                properties.joinUrl(queue.getId()),
                queue.getCreatedAt(),
                queue.getUpdatedAt());
    }

    public QueueSummary summary(ServiceQueue queue) {
        return new QueueSummary(queue.getId(), queue.getName(),
                queue.getEstablishment().getName(), queue.getStatus());
    }

    /**
     * @param waiting   WAITING entries in service order
     * @param inService entries already called or being attended
     */
    public QueueSnapshot snapshot(ServiceQueue queue, List<QueueEntry> waiting, List<QueueEntry> inService) {
        return snapshot(queue, waiting, inService, estimationService.averageServiceTime(queue));
    }

    /**
     * Overload taking an estimate the caller has already measured.
     *
     * <p>Exists so a broadcast can measure the queue's average service time once and reuse it for the
     * staff board and for every watching customer, rather than re-running the same query per
     * subscriber.
     */
    public QueueSnapshot snapshot(ServiceQueue queue, List<QueueEntry> waiting, List<QueueEntry> inService,
                                  EstimationService.ServiceTimeEstimate estimate) {
        int inServiceCount = inService.size();

        List<EntryView> waitingViews = new ArrayList<>(waiting.size());
        for (int index = 0; index < waiting.size(); index++) {
            waitingViews.add(entryView(waiting.get(index), index, inServiceCount, queue, estimate.duration()));
        }

        List<EntryView> inServiceViews = inService.stream()
                .map(entry -> entryView(entry, null, inServiceCount, queue, estimate.duration()))
                .toList();

        int newEntryEta = EstimationService.toMinutes(
                estimationService.estimateWait(queue, waiting.size(), inServiceCount, estimate.duration()));

        return new QueueSnapshot(
                queueView(queue),
                waitingViews,
                inServiceViews,
                waiting.size(),
                inServiceCount,
                newEntryEta,
                EstimationService.toMinutes(estimate.duration()),
                estimate.usingDefault(),
                clock.instant());
    }

    /**
     * @param peopleAhead number of customers ahead, or null when the entry no longer waits
     */
    public EntryView entryView(QueueEntry entry, Integer peopleAhead, int inServiceCount,
                               ServiceQueue queue, Duration averageServiceTime) {
        Integer position = peopleAhead == null ? null : peopleAhead + 1;
        Integer eta = peopleAhead == null ? null : EstimationService.toMinutes(
                estimationService.estimateWait(queue, peopleAhead, inServiceCount, averageServiceTime));

        return new EntryView(
                entry.getId(),
                entry.getTicketToken(),
                entry.getTicketNumber(),
                entry.getCustomerName(),
                entry.getCustomerEmail(),
                entry.getCustomerPhone(),
                entry.getPartySize(),
                entry.getStatus(),
                position,
                peopleAhead,
                eta,
                entry.getNoShowCount(),
                entry.getJoinedAt(),
                entry.getCalledAt(),
                entry.getServingStartedAt(),
                entry.getFinishedAt(),
                entry.getGraceExpiresAt(),
                graceSecondsRemaining(entry));
    }

    public TicketView ticketView(QueueEntry entry, Integer peopleAhead, int inServiceCount,
                                 Duration averageServiceTime) {
        ServiceQueue queue = entry.getQueue();
        Integer position = peopleAhead == null ? null : peopleAhead + 1;
        Integer eta = peopleAhead == null ? null : EstimationService.toMinutes(
                estimationService.estimateWait(queue, peopleAhead, inServiceCount, averageServiceTime));

        return new TicketView(
                entry.getTicketToken(),
                entry.getTicketNumber(),
                entry.getCustomerName(),
                entry.getPartySize(),
                entry.getStatus(),
                position,
                peopleAhead,
                eta,
                entry.getNoShowCount(),
                entry.getJoinedAt(),
                entry.getCalledAt(),
                entry.getFinishedAt(),
                entry.getGraceExpiresAt(),
                graceSecondsRemaining(entry),
                summary(queue),
                properties.ticketUrl(entry.getTicketToken()));
    }

    public PublicQueueView publicView(ServiceQueue queue, int waitingCount, int inServiceCount) {
        EstimationService.ServiceTimeEstimate estimate = estimationService.averageServiceTime(queue);
        int eta = EstimationService.toMinutes(
                estimationService.estimateWait(queue, waitingCount, inServiceCount, estimate.duration()));
        boolean full = queue.getMaxSize() != null && waitingCount + inServiceCount >= queue.getMaxSize();

        return new PublicQueueView(
                queue.getId(),
                queue.getName(),
                queue.getDescription(),
                queue.getEstablishment().getName(),
                queue.getStatus(),
                queue.acceptsNewEntries() && !full,
                full,
                waitingCount,
                eta,
                queue.isRequirePartySize(),
                queue.getMaxSize());
    }

    private Long graceSecondsRemaining(QueueEntry entry) {
        if (entry.getStatus() != EntryStatus.CALLED || entry.getGraceExpiresAt() == null) {
            return null;
        }
        long seconds = Duration.between(clock.instant(), entry.getGraceExpiresAt()).toSeconds();
        return Math.max(0L, seconds);
    }
}
