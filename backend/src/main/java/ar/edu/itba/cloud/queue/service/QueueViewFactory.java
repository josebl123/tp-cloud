package ar.edu.itba.cloud.queue.service;

import ar.edu.itba.cloud.queue.config.AppProperties;
import ar.edu.itba.cloud.queue.persistence.entity.EntryStatus;
import ar.edu.itba.cloud.queue.persistence.entity.QueueEntry;
import ar.edu.itba.cloud.queue.persistence.entity.ServiceQueue;
import ar.edu.itba.cloud.queue.persistence.repository.QueueLaneRepository;
import ar.edu.itba.cloud.queue.service.model.EntryView;
import ar.edu.itba.cloud.queue.service.model.PublicQueueView;
import ar.edu.itba.cloud.queue.service.model.QueueSnapshot;
import ar.edu.itba.cloud.queue.service.model.QueueSummary;
import ar.edu.itba.cloud.queue.service.model.QueueView;
import ar.edu.itba.cloud.queue.service.model.QueueLaneView;
import ar.edu.itba.cloud.queue.service.model.QueueLaneSnapshot;
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
    private final QueueLaneRepository laneRepository;

    public QueueViewFactory(AppProperties properties, EstimationService estimationService, Clock clock,
                            QueueLaneRepository laneRepository) {
        this.properties = properties;
        this.estimationService = estimationService;
        this.clock = clock;
        this.laneRepository = laneRepository;
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
                properties.joinUrl(queue.getId()),
                queue.getCreatedAt(),
                queue.getUpdatedAt(), queue.getArchivedAt(), laneRepository.findAllByQueueIdOrderByPriorityAscMinPartySizeAsc(queue.getId()).stream()
                        .map(l -> new QueueLaneView(l.getId(), l.getName(), l.getMinPartySize(), l.getMaxPartySize(), l.getPriority(),
                        l.getCapacityMode(), l.getMaxSize(), l.getTimeFactor(), l.isActive())).toList(), queue.getCallStrategy());
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
        // One simulation for the whole board. Running estimate() per row would replay the entire
        // schedule once for every person on the line, which is quadratic in its length.
        return snapshot(queue, waiting, inService, estimate,
                estimationService.simulateAll(queue, waiting, inService, estimate.duration()));
    }

    /**
     * Overload taking a simulation the caller has already run.
     *
     * <p>A broadcast builds the board and every watching customer's ticket from the same line. Letting
     * it hand the simulation in means the schedule is replayed once for the whole push, instead of once
     * for the board and again for the tickets.
     */
    public QueueSnapshot snapshot(ServiceQueue queue, List<QueueEntry> waiting, List<QueueEntry> inService,
                                  EstimationService.ServiceTimeEstimate estimate,
                                  java.util.Map<java.util.UUID, EstimationService.Simulation> simulations) {
        int inServiceCount = inService.size();
        List<EntryView> waitingViews = waiting.stream()
                .map(entry -> entryView(entry, simulations.get(entry.getId()), inServiceCount))
                .toList();

        List<EntryView> inServiceViews = inService.stream()
                .map(entry -> staticEntryView(entry, inServiceCount))
                .toList();

        return new QueueSnapshot(
                queueView(queue),
                waitingViews,
                inServiceViews,
                waiting.size(),
                inServiceCount,
                EstimationService.toMinutes(estimate.duration()),
                estimate.usingDefault(),
                clock.instant(), laneSnapshots(queue, waiting, inService, estimate, simulations));
    }

    public EntryView entryView(QueueEntry entry, EstimationService.Simulation simulation) {
        return entryView(entry, simulation, simulation.groupsInService());
    }

    private EntryView entryView(QueueEntry entry, EstimationService.Simulation simulation, int groupsInService) {
        Integer lanePosition = simulation == null ? null : simulation.lanePosition();
        Integer laneAhead = simulation == null ? null : simulation.laneGroupsAhead();
        Integer globalAhead = simulation == null ? null : simulation.globalWaitingGroupsAhead();
        Integer eta = simulation == null ? null : EstimationService.toMinutes(simulation.estimatedWait());

        return new EntryView(
                entry.getId(),
                entry.getTicketToken(),
                entry.getTicketNumber(),
                entry.getCustomerName(),
                entry.getCustomerEmail(),
                entry.getCustomerPhone(),
                entry.getPartySize(),
                entry.getStatus(),
                lanePosition,
                laneAhead,
                globalAhead,
                groupsInService,
                eta,
                entry.getNoShowCount(),
                entry.getJoinedAt(),
                entry.getCalledAt(),
                entry.getServingStartedAt(),
                entry.getFinishedAt(),
                entry.getGraceExpiresAt(),
                graceSecondsRemaining(entry), entry.getLane() == null ? null : entry.getLane().getId(),
                entry.getLane() == null ? null : entry.getLane().getName());
    }

    public EntryView staticEntryView(QueueEntry entry, int groupsInService) {
        return entryView(entry, null, groupsInService);
    }

    public TicketView ticketView(QueueEntry entry, EstimationService.Simulation simulation) {
        ServiceQueue queue = entry.getQueue();
        Integer lanePosition = simulation == null ? null : simulation.lanePosition();
        Integer laneAhead = simulation == null ? null : simulation.laneGroupsAhead();
        Integer globalAhead = simulation == null ? null : simulation.globalWaitingGroupsAhead();
        Integer eta = simulation == null ? null : EstimationService.toMinutes(simulation.estimatedWait());

        return new TicketView(
                entry.getTicketToken(),
                entry.getTicketNumber(),
                entry.getCustomerName(),
                entry.getPartySize(),
                entry.getStatus(),
                lanePosition,
                laneAhead,
                globalAhead,
                simulation == null ? 0 : simulation.groupsInService(),
                eta,
                entry.getNoShowCount(),
                entry.getJoinedAt(),
                entry.getCalledAt(),
                entry.getFinishedAt(),
                entry.getGraceExpiresAt(),
                graceSecondsRemaining(entry),
                summary(queue),
                properties.ticketUrl(entry.getTicketToken()),
                entry.getLane() == null ? null : entry.getLane().getId(),
                entry.getLane() == null ? null : entry.getLane().getName());
    }

    public PublicQueueView publicView(ServiceQueue queue, int waitingCount, int inServiceCount) {
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
                queue.getMaxSize(), laneRepository.findAllByQueueIdOrderByPriorityAscMinPartySizeAsc(queue.getId()).stream()
                        .filter(l -> l.isActive()).map(l -> new QueueLaneView(l.getId(), l.getName(), l.getMinPartySize(), l.getMaxPartySize(), l.getPriority(), l.getCapacityMode(), l.getMaxSize(), l.getTimeFactor(), l.isActive())).toList());
    }

    private Long graceSecondsRemaining(QueueEntry entry) {
        if (entry.getStatus() != EntryStatus.CALLED || entry.getGraceExpiresAt() == null) {
            return null;
        }
        long seconds = Duration.between(clock.instant(), entry.getGraceExpiresAt()).toSeconds();
        return Math.max(0L, seconds);
    }

    private static boolean sameLane(QueueEntry a, QueueEntry b) {
        return a.getLane() == null ? b.getLane() == null : a.getLane().getId().equals(b.getLane().getId());
    }

    private List<QueueLaneSnapshot> laneSnapshots(ServiceQueue queue, List<QueueEntry> waiting,
                                                   List<QueueEntry> inService, EstimationService.ServiceTimeEstimate base,
                                                   java.util.Map<java.util.UUID, EstimationService.Simulation> simulations) {
        return laneRepository.findAllByQueueIdOrderByPriorityAscMinPartySizeAsc(queue.getId()).stream().map(lane -> {
            var w = waiting.stream().filter(e -> lane.getId().equals(e.getLane().getId())).toList();
            var s = inService.stream().filter(e -> lane.getId().equals(e.getLane().getId())).toList();
            int used = java.util.stream.Stream.concat(w.stream(), s.stream()).mapToInt(e -> lane.getCapacityMode() == ar.edu.itba.cloud.queue.persistence.entity.LaneCapacityMode.PERSONS ? e.getPartySize() : 1).sum();
            List<EntryView> laneWaiting = new ArrayList<>(w.size());
            for (QueueEntry entry : w) {
                // The shared simulation again: replaying the schedule per row here would undo the
                // single pass the board just made, once per lane.
                laneWaiting.add(entryView(entry, simulations.get(entry.getId())));
            }
            return new QueueLaneSnapshot(new QueueLaneView(lane.getId(), lane.getName(), lane.getMinPartySize(), lane.getMaxPartySize(), lane.getPriority(), lane.getCapacityMode(), lane.getMaxSize(), lane.getTimeFactor(), lane.isActive()),
                    laneWaiting,
                    s.stream().map(e -> staticEntryView(e, s.size())).toList(), w.size(),
                    w.stream().mapToInt(QueueEntry::getPartySize).sum(), used, lane.getMaxSize());
        }).toList();
    }

}
