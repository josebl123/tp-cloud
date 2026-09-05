package ar.edu.itba.cloud.queue.service;

import ar.edu.itba.cloud.queue.exception.NotFoundException;
import ar.edu.itba.cloud.queue.exception.ConflictException;
import ar.edu.itba.cloud.queue.exception.ValidationException;
import ar.edu.itba.cloud.queue.realtime.RealtimeBus;
import ar.edu.itba.cloud.queue.persistence.entity.Establishment;
import ar.edu.itba.cloud.queue.persistence.entity.EntryStatus;
import ar.edu.itba.cloud.queue.persistence.entity.EventType;
import ar.edu.itba.cloud.queue.persistence.entity.QueueEntry;
import ar.edu.itba.cloud.queue.persistence.entity.QueueStatus;
import ar.edu.itba.cloud.queue.persistence.entity.ServiceQueue;
import ar.edu.itba.cloud.queue.persistence.entity.SupportedLocale;
import ar.edu.itba.cloud.queue.persistence.repository.EstablishmentRepository;
import ar.edu.itba.cloud.queue.persistence.repository.QueueEntryRepository;
import ar.edu.itba.cloud.queue.persistence.repository.ServiceQueueRepository;
import ar.edu.itba.cloud.queue.service.command.CreateQueueCommand;
import ar.edu.itba.cloud.queue.service.command.UpdateQueueCommand;
import ar.edu.itba.cloud.queue.service.model.PublicQueueView;
import ar.edu.itba.cloud.queue.service.model.QueueBroadcast;
import ar.edu.itba.cloud.queue.service.model.QueueEventView;
import ar.edu.itba.cloud.queue.service.model.QueueAvailabilityView;
import ar.edu.itba.cloud.queue.service.model.QueueLaneView;
import ar.edu.itba.cloud.queue.service.model.QueueSnapshot;
import ar.edu.itba.cloud.queue.service.model.QueueView;
import ar.edu.itba.cloud.queue.service.model.TicketView;
import ar.edu.itba.cloud.queue.persistence.entity.ActorType;
import java.time.Clock;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Queue configuration and the staff board.
 *
 * <p>Configuration is owner-only; reading and operating a queue is open to any member, because that is
 * the day-to-day job.
 */
@Service
public class QueueService {

    private static final int MAX_EVENTS = 100;

    private final ServiceQueueRepository queueRepository;
    private final QueueEntryRepository entryRepository;
    private final EstablishmentRepository establishmentRepository;
    private final QueueEntryService entryService;
    private final GraceService graceService;
    private final QueueViewFactory viewFactory;
    private final EstimationService estimationService;
    private final AccessGuard accessGuard;
    private final EventRecorder eventRecorder;
    private final RealtimeBus realtimeBus;
    private final Clock clock;
    private final QueueLaneService laneService;

    public QueueService(ServiceQueueRepository queueRepository,
                        QueueEntryRepository entryRepository,
                        EstablishmentRepository establishmentRepository,
                        QueueEntryService entryService,
                        GraceService graceService,
                        QueueViewFactory viewFactory,
                        EstimationService estimationService,
                        AccessGuard accessGuard,
                        EventRecorder eventRecorder,
                        RealtimeBus realtimeBus,
                        Clock clock,
                        QueueLaneService laneService) {
        this.queueRepository = queueRepository;
        this.entryRepository = entryRepository;
        this.establishmentRepository = establishmentRepository;
        this.entryService = entryService;
        this.graceService = graceService;
        this.viewFactory = viewFactory;
        this.estimationService = estimationService;
        this.accessGuard = accessGuard;
        this.eventRecorder = eventRecorder;
        this.realtimeBus = realtimeBus;
        this.clock = clock;
        this.laneService = laneService;
    }

    @Transactional
    public QueueView create(UUID userId, UUID establishmentId, CreateQueueCommand command) {
        accessGuard.requireOwner(userId, establishmentId);
        Establishment establishment = establishmentRepository.findById(establishmentId)
                .orElseThrow(() -> NotFoundException.establishment(establishmentId));

        ServiceQueue queue = new ServiceQueue(establishment, requireName(command.name()), clock.instant());
        applyCreate(queue, command);
        validate(queue);
        queueRepository.save(queue);
        laneService.defaultLane(queue, clock.instant());

        eventRecorder.record(queue.getId(), null, EventType.QUEUE_CREATED, ActorType.STAFF, userId,
                "name=%s".formatted(queue.getName()));
        return viewFactory.queueView(queue);
    }

    @Transactional(readOnly = true)
    public List<QueueView> listForEstablishment(UUID userId, UUID establishmentId) {
        accessGuard.requireMember(userId, establishmentId);
        return queueRepository.findAllByEstablishmentIdAndArchivedAtIsNullOrderByNameAsc(establishmentId).stream()
                .map(viewFactory::queueView)
                .toList();
    }

    @Transactional(readOnly = true)
    public QueueView get(UUID userId, UUID queueId) {
        ServiceQueue queue = load(queueId);
        accessGuard.requireMember(userId, queue.getEstablishment().getId());
        if (queue.getArchivedAt() != null) throw new NotFoundException("QUEUE_ARCHIVED", "This queue is archived");
        return viewFactory.queueView(queue);
    }

    @Transactional
    public QueueView update(UUID userId, UUID queueId, UpdateQueueCommand command) {
        ServiceQueue queue = lock(queueId);
        accessGuard.requireOwner(userId, queue.getEstablishment().getId());
        if (queue.getArchivedAt() != null) throw new ConflictException("QUEUE_ARCHIVED", "This queue is archived");

        applyUpdate(queue, command);
        validate(queue);
        queue.setUpdatedAt(clock.instant());
        queueRepository.save(queue);

        eventRecorder.record(queueId, null, EventType.QUEUE_UPDATED, ActorType.STAFF, userId, null);
        realtimeBus.publish(queueId);
        return viewFactory.queueView(queue);
    }

    /**
     * Functionality 4: pause and resume.
     *
     * <p>PAUSED stops new customers from joining while staff keep working through the people already
     * in line. CLOSED additionally releases everyone still waiting and notifies them, so nobody is
     * left holding a place in a queue that stopped operating.
     */
    @Transactional
    public QueueView changeStatus(UUID userId, UUID queueId, QueueStatus status) {
        ServiceQueue queue = lock(queueId);
        accessGuard.requireMember(userId, queue.getEstablishment().getId());
        if (queue.getArchivedAt() != null) throw new ConflictException("QUEUE_ARCHIVED", "This queue is archived");

        QueueStatus previous = queue.getStatus();
        if (previous == status) {
            return viewFactory.queueView(queue);
        }

        graceService.expireDue(queue);
        queue.setStatus(status);
        queue.setUpdatedAt(clock.instant());

        if (status == QueueStatus.CLOSED) {
            entryService.releaseAllActive(queue, userId);
        }
        queueRepository.save(queue);

        eventRecorder.record(queueId, null, EventType.QUEUE_STATUS_CHANGED, ActorType.STAFF, userId,
                "from=%s to=%s".formatted(previous, status));
        realtimeBus.publish(queueId);
        return viewFactory.queueView(queue);
    }

    @Transactional
    public void delete(UUID userId, UUID queueId) {
        ServiceQueue queue = lock(queueId);
        accessGuard.requireOwner(userId, queue.getEstablishment().getId());

        graceService.expireDue(queue);
        queue.setStatus(QueueStatus.CLOSED);
        entryService.releaseAllActive(queue, userId);
        queue.setArchivedAt(clock.instant());
        queue.setUpdatedAt(clock.instant());
        queueRepository.save(queue);
        eventRecorder.record(queueId, null, EventType.QUEUE_ARCHIVED, ActorType.STAFF, userId,
                "name=%s".formatted(queue.getName()));
        realtimeBus.publish(queueId);
    }

    /** The staff board. Expires overdue grace periods first so it always reflects the current line. */
    @Transactional
    public QueueSnapshot getSnapshot(UUID userId, UUID queueId) {
        ServiceQueue queue = load(queueId);
        // Authorise before expiring: a member of another establishment must not be able to drive side
        // effects on this queue on their way to a 403.
        accessGuard.requireMember(userId, queue.getEstablishment().getId());
        if (queue.getArchivedAt() != null) {
            throw new NotFoundException("QUEUE_ARCHIVED", "This queue is archived");
        }
        if (graceService.expireDueIfAny(queueId)) {
            realtimeBus.publish(queueId);
        }
        return buildSnapshot(queue);
    }

    /** Pure read, used to push the board to subscribers after a change has already been applied. */
    @Transactional(readOnly = true)
    public QueueSnapshot readSnapshot(UUID queueId) {
        return buildSnapshot(load(queueId));
    }

    /**
     * Assembles everything a single queue change has to push out.
     *
     * <p>The naive shape of this is one set of queries per subscriber, every one of them asking the
     * same questions about the same queue - so the database load grew with the number of people
     * watching rather than with the amount of work being done. Here the queue, its line and its
     * average service time are read <em>once</em>, and every customer's view is derived from that.
     *
     * <p>The second saving is subtler: anyone still in the line is already among the entries loaded
     * for the board, so their view costs no query at all. Only watchers whose entry has just left the
     * line need fetching, and those go in one batched statement.
     *
     * @param includeBoard whether any staff are connected; skips building a board nobody will see
     */
    @Transactional(readOnly = true)
    public QueueBroadcast readBroadcast(UUID queueId, Set<UUID> ticketTokens, boolean includeBoard) {
        ServiceQueue queue = load(queueId);
        List<QueueEntry> waiting = entryRepository
                .findAllByQueueIdAndStatusOrderByOrderKeyAscJoinedAtAsc(queueId, EntryStatus.WAITING);
        List<QueueEntry> inService = entryRepository.findAllByQueueIdAndStatusInOrderByOrderKeyAscJoinedAtAsc(
                queueId, List.of(EntryStatus.CALLED, EntryStatus.SERVING));
        EstimationService.ServiceTimeEstimate estimate = estimationService.averageServiceTime(queue);

        // Simulated once and shared: the board and every watching customer read the same schedule.
        Map<UUID, EstimationService.Simulation> simulations =
                estimationService.simulateAll(queue, waiting, inService, estimate.duration());

        QueueSnapshot snapshot = includeBoard
                ? viewFactory.snapshot(queue, waiting, inService, estimate, simulations)
                : null;

        if (ticketTokens.isEmpty()) {
            return new QueueBroadcast(snapshot, Map.of());
        }

        Map<UUID, QueueEntry> byToken = new HashMap<>();
        for (QueueEntry entry : waiting) {
            byToken.put(entry.getTicketToken(), entry);
        }
        for (QueueEntry entry : inService) {
            byToken.put(entry.getTicketToken(), entry);
        }

        List<UUID> notInLine = ticketTokens.stream().filter(token -> !byToken.containsKey(token)).toList();
        if (!notInLine.isEmpty()) {
            entryRepository.findAllByTicketTokenIn(notInLine)
                    .forEach(entry -> byToken.put(entry.getTicketToken(), entry));
        }

        Map<UUID, TicketView> tickets = new HashMap<>();
        for (UUID token : ticketTokens) {
            QueueEntry entry = byToken.get(token);
            if (entry == null) {
                // Removed since the subscription opened; that client falls back to polling.
                continue;
            }
            // Absent for anyone already called or being served: they no longer hold a place.
            tickets.put(token, viewFactory.ticketView(entry, simulations.get(entry.getId())));
        }
        return new QueueBroadcast(snapshot, tickets);
    }

    /** What a customer sees right after scanning the QR. No authentication, no personal data. */
    @Transactional
    public PublicQueueView publicView(UUID queueId) {
        ServiceQueue queue = load(queueId);
        if (queue.getArchivedAt() != null) {
            throw new NotFoundException("QUEUE_ARCHIVED", "This queue is archived");
        }
        if (graceService.expireDueIfAny(queueId)) {
            realtimeBus.publish(queueId);
        }
        int waiting = (int) entryRepository.countByQueueIdAndStatus(queueId, EntryStatus.WAITING);
        int inService = (int) entryRepository.countByQueueIdAndStatusIn(queueId,
                List.of(EntryStatus.CALLED, EntryStatus.SERVING));
        return viewFactory.publicView(queue, waiting, inService);
    }

    /** Quotes the exact group size a customer entered without reserving a place. */
    @Transactional
    public QueueAvailabilityView availability(UUID queueId, int partySize) {
        if (partySize < 1) {
            throw new ValidationException("INVALID_PARTY_SIZE", "partySize must be at least 1");
        }
        ServiceQueue queue = lock(queueId);
        if (queue.getArchivedAt() != null) {
            throw new NotFoundException("QUEUE_ARCHIVED", "This queue is archived");
        }
        graceService.expireDue(queue);
        List<QueueEntry> waiting = entryRepository
                .findAllByQueueIdAndStatusOrderByOrderKeyAscJoinedAtAsc(queueId, EntryStatus.WAITING);
        long active = entryRepository.countByQueueIdAndStatusIn(queueId, EntryStatus.active());
        try {
            var lane = laneService.select(queue, partySize);
            boolean queueFull = queue.getMaxSize() != null && active >= queue.getMaxSize();
            boolean laneFull = !laneService.hasCapacity(lane, partySize);
            List<QueueEntry> inService = entryRepository.findAllByQueueIdAndStatusInOrderByOrderKeyAscJoinedAtAsc(queueId,
                    List.of(EntryStatus.CALLED, EntryStatus.SERVING));
            // Never persisted and never notified, so its language is irrelevant.
            QueueEntry candidate = new QueueEntry(queue, lane, UUID.randomUUID(), 0, Long.MAX_VALUE,
                    "quote", null, null, partySize, SupportedLocale.DEFAULT, java.time.Instant.EPOCH);
            List<QueueEntry> simulatedWaiting = new java.util.ArrayList<>(waiting);
            simulatedWaiting.add(candidate);
            EstimationService.Simulation simulation = estimationService.estimate(queue, simulatedWaiting, inService,
                    candidate, estimationService.averageServiceTime(queue).duration());
            QueueLaneView laneView = new QueueLaneView(lane.getId(), lane.getName(), lane.getMinPartySize(),
                    lane.getMaxPartySize(), lane.getPriority(), lane.getCapacityMode(), lane.getMaxSize(),
                    lane.getTimeFactor(), lane.isActive());
            boolean available = queue.acceptsNewEntries() && !queueFull && !laneFull;
            return new QueueAvailabilityView(laneView, true, available, queueFull, laneFull,
                    simulation.lanePosition(), simulation.laneGroupsAhead(), simulation.globalWaitingGroupsAhead(),
                    simulation.groupsInService(), EstimationService.toMinutes(simulation.estimatedWait()));
        } catch (ConflictException exception) {
            if (!"NO_COMPATIBLE_LANE".equals(exception.getCode())) {
                throw exception;
            }
            int inService = (int) entryRepository.countByQueueIdAndStatusIn(queueId,
                    List.of(EntryStatus.CALLED, EntryStatus.SERVING));
            return new QueueAvailabilityView(null, false, false, false, false, null, null, waiting.size(), inService, null);
        }
    }

    @Transactional(readOnly = true)
    public List<QueueEventView> events(UUID userId, UUID queueId, int limit) {
        ServiceQueue queue = load(queueId);
        accessGuard.requireMember(userId, queue.getEstablishment().getId());
        return eventRecorder.recentForQueue(queueId, Math.clamp(limit, 1, MAX_EVENTS));
    }

    /** Resolves the URL a queue's QR code should encode. Public: the URL is meant to be handed out. */
    @Transactional(readOnly = true)
    public String joinUrl(UUID queueId) {
        return viewFactory.queueView(load(queueId)).joinUrl();
    }

    private QueueSnapshot buildSnapshot(ServiceQueue queue) {
        List<QueueEntry> waiting = entryRepository
                .findAllByQueueIdAndStatusOrderByOrderKeyAscJoinedAtAsc(queue.getId(), EntryStatus.WAITING);
        List<QueueEntry> inService = entryRepository.findAllByQueueIdAndStatusInOrderByOrderKeyAscJoinedAtAsc(
                queue.getId(), List.of(EntryStatus.CALLED, EntryStatus.SERVING));
        return viewFactory.snapshot(queue, waiting, inService);
    }

    private void applyCreate(ServiceQueue queue, CreateQueueCommand command) {
        queue.setDescription(trimToNull(command.description()));
        if (command.serviceStations() != null) {
            queue.setServiceStations(command.serviceStations());
        }
        if (command.defaultServiceMinutes() != null) {
            queue.setDefaultServiceMinutes(command.defaultServiceMinutes());
        }
        queue.setMaxSize(command.maxSize());
        if (command.gracePeriodSeconds() != null) {
            queue.setGracePeriodSeconds(command.gracePeriodSeconds());
        }
        if (command.noShowPolicy() != null) {
            queue.setNoShowPolicy(command.noShowPolicy());
        }
        if (command.moveBackPositions() != null) {
            queue.setMoveBackPositions(command.moveBackPositions());
        }
        queue.setNotifyAtPosition(command.notifyAtPosition());
        queue.setNotifyAtMinutes(command.notifyAtMinutes());
        if (command.callStrategy() != null) queue.setCallStrategy(command.callStrategy());
    }

    private void applyUpdate(ServiceQueue queue, UpdateQueueCommand command) {
        if (command.name() != null) {
            queue.setName(requireName(command.name()));
        }
        if (command.description() != null) {
            queue.setDescription(trimToNull(command.description()));
        }
        if (command.serviceStations() != null) {
            queue.setServiceStations(command.serviceStations());
        }
        if (command.defaultServiceMinutes() != null) {
            queue.setDefaultServiceMinutes(command.defaultServiceMinutes());
        }
        if (command.clearMaxSize()) {
            queue.setMaxSize(null);
        } else if (command.maxSize() != null) {
            queue.setMaxSize(command.maxSize());
        }
        if (command.gracePeriodSeconds() != null) {
            queue.setGracePeriodSeconds(command.gracePeriodSeconds());
        }
        if (command.noShowPolicy() != null) {
            queue.setNoShowPolicy(command.noShowPolicy());
        }
        if (command.moveBackPositions() != null) {
            queue.setMoveBackPositions(command.moveBackPositions());
        }
        if (command.clearNotifyAtPosition()) {
            queue.setNotifyAtPosition(null);
        } else if (command.notifyAtPosition() != null) {
            queue.setNotifyAtPosition(command.notifyAtPosition());
        }
        if (command.clearNotifyAtMinutes()) {
            queue.setNotifyAtMinutes(null);
        } else if (command.notifyAtMinutes() != null) {
            queue.setNotifyAtMinutes(command.notifyAtMinutes());
        }
        if (command.callStrategy() != null) queue.setCallStrategy(command.callStrategy());
    }

    /** Mirrors the database check constraints, so a bad value fails as a 400 rather than a 500. */
    private void validate(ServiceQueue queue) {
        if (queue.getServiceStations() < 1) {
            throw new ValidationException("INVALID_SERVICE_STATIONS", "serviceStations must be at least 1");
        }
        if (queue.getDefaultServiceMinutes() < 1) {
            throw new ValidationException("INVALID_SERVICE_TIME", "defaultServiceMinutes must be at least 1");
        }
        if (queue.getMaxSize() != null && queue.getMaxSize() < 1) {
            throw new ValidationException("INVALID_MAX_SIZE", "maxSize must be at least 1 when present");
        }
        if (queue.getGracePeriodSeconds() < 0) {
            throw new ValidationException("INVALID_GRACE_PERIOD", "gracePeriodSeconds cannot be negative");
        }
        if (queue.getMoveBackPositions() < 1) {
            throw new ValidationException("INVALID_MOVE_BACK", "moveBackPositions must be at least 1");
        }
        if (queue.getNotifyAtPosition() != null && queue.getNotifyAtPosition() < 1) {
            throw new ValidationException("INVALID_NOTIFY_POSITION", "notifyAtPosition must be at least 1");
        }
        if (queue.getNotifyAtMinutes() != null && queue.getNotifyAtMinutes() < 1) {
            throw new ValidationException("INVALID_NOTIFY_MINUTES", "notifyAtMinutes must be at least 1");
        }
    }

    private ServiceQueue load(UUID queueId) {
        return queueRepository.findByIdWithEstablishment(queueId)
                .orElseThrow(() -> NotFoundException.queue(queueId));
    }

    private ServiceQueue lock(UUID queueId) {
        return queueRepository.findByIdForUpdate(queueId).orElseThrow(() -> NotFoundException.queue(queueId));
    }

    private static String requireName(String name) {
        String trimmed = name == null ? null : name.trim();
        if (trimmed == null || trimmed.isEmpty()) {
            throw new ValidationException("QUEUE_NAME_REQUIRED", "A queue name is required");
        }
        return trimmed;
    }

    private static String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
