package ar.edu.itba.cloud.queue.service;

import ar.edu.itba.cloud.queue.exception.NotFoundException;
import ar.edu.itba.cloud.queue.exception.ValidationException;
import ar.edu.itba.cloud.queue.persistence.entity.Establishment;
import ar.edu.itba.cloud.queue.persistence.entity.EntryStatus;
import ar.edu.itba.cloud.queue.persistence.entity.EventType;
import ar.edu.itba.cloud.queue.persistence.entity.QueueEntry;
import ar.edu.itba.cloud.queue.persistence.entity.QueueStatus;
import ar.edu.itba.cloud.queue.persistence.entity.ServiceQueue;
import ar.edu.itba.cloud.queue.persistence.repository.EstablishmentRepository;
import ar.edu.itba.cloud.queue.persistence.repository.QueueEntryRepository;
import ar.edu.itba.cloud.queue.persistence.repository.ServiceQueueRepository;
import ar.edu.itba.cloud.queue.service.command.CreateQueueCommand;
import ar.edu.itba.cloud.queue.service.command.UpdateQueueCommand;
import ar.edu.itba.cloud.queue.service.event.QueueChangedEvent;
import ar.edu.itba.cloud.queue.service.model.PublicQueueView;
import ar.edu.itba.cloud.queue.service.model.QueueBroadcast;
import ar.edu.itba.cloud.queue.service.model.QueueEventView;
import ar.edu.itba.cloud.queue.service.model.QueueSnapshot;
import ar.edu.itba.cloud.queue.service.model.QueueView;
import ar.edu.itba.cloud.queue.service.model.TicketView;
import ar.edu.itba.cloud.queue.persistence.entity.ActorType;
import java.time.Clock;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.context.ApplicationEventPublisher;
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

    /** A place in the line that is no longer waiting but has not been given up either. */
    private static final List<EntryStatus> IN_SERVICE = List.of(EntryStatus.CALLED, EntryStatus.SERVING);

    private final ServiceQueueRepository queueRepository;
    private final QueueEntryRepository entryRepository;
    private final EstablishmentRepository establishmentRepository;
    private final QueueEntryService entryService;
    private final GraceService graceService;
    private final EstimationService estimationService;
    private final QueueViewFactory viewFactory;
    private final AccessGuard accessGuard;
    private final EventRecorder eventRecorder;
    private final ApplicationEventPublisher publisher;
    private final Clock clock;

    public QueueService(ServiceQueueRepository queueRepository,
                        QueueEntryRepository entryRepository,
                        EstablishmentRepository establishmentRepository,
                        QueueEntryService entryService,
                        GraceService graceService,
                        EstimationService estimationService,
                        QueueViewFactory viewFactory,
                        AccessGuard accessGuard,
                        EventRecorder eventRecorder,
                        ApplicationEventPublisher publisher,
                        Clock clock) {
        this.queueRepository = queueRepository;
        this.entryRepository = entryRepository;
        this.establishmentRepository = establishmentRepository;
        this.entryService = entryService;
        this.graceService = graceService;
        this.estimationService = estimationService;
        this.viewFactory = viewFactory;
        this.accessGuard = accessGuard;
        this.eventRecorder = eventRecorder;
        this.publisher = publisher;
        this.clock = clock;
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

        eventRecorder.record(queue.getId(), null, EventType.QUEUE_CREATED, ActorType.STAFF, userId,
                "name=%s".formatted(queue.getName()));
        return viewFactory.queueView(queue);
    }

    @Transactional(readOnly = true)
    public List<QueueView> listForEstablishment(UUID userId, UUID establishmentId) {
        accessGuard.requireMember(userId, establishmentId);
        return queueRepository.findAllByEstablishmentIdOrderByNameAsc(establishmentId).stream()
                .map(viewFactory::queueView)
                .toList();
    }

    @Transactional(readOnly = true)
    public QueueView get(UUID userId, UUID queueId) {
        ServiceQueue queue = load(queueId);
        accessGuard.requireMember(userId, queue.getEstablishment().getId());
        return viewFactory.queueView(queue);
    }

    @Transactional
    public QueueView update(UUID userId, UUID queueId, UpdateQueueCommand command) {
        ServiceQueue queue = lock(queueId);
        accessGuard.requireOwner(userId, queue.getEstablishment().getId());

        applyUpdate(queue, command);
        validate(queue);
        queue.setUpdatedAt(clock.instant());
        queueRepository.save(queue);

        eventRecorder.record(queueId, null, EventType.QUEUE_UPDATED, ActorType.STAFF, userId, null);
        publisher.publishEvent(new QueueChangedEvent(queueId));
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
        publisher.publishEvent(new QueueChangedEvent(queueId));
        return viewFactory.queueView(queue);
    }

    @Transactional
    public void delete(UUID userId, UUID queueId) {
        ServiceQueue queue = lock(queueId);
        accessGuard.requireOwner(userId, queue.getEstablishment().getId());

        eventRecorder.record(queueId, null, EventType.QUEUE_DELETED, ActorType.STAFF, userId,
                "name=%s".formatted(queue.getName()));
        queueRepository.delete(queue);
    }

    /** The staff board. Expires overdue grace periods first so it always reflects the current line. */
    @Transactional
    public QueueSnapshot getSnapshot(UUID userId, UUID queueId) {
        ServiceQueue queue = load(queueId);
        // Authorise before expiring: a member of another establishment must not be able to drive
        // side effects on this queue on their way to a 403.
        accessGuard.requireMember(userId, queue.getEstablishment().getId());
        if (graceService.expireDueIfAny(queueId)) {
            publisher.publishEvent(new QueueChangedEvent(queueId));
        }
        return buildSnapshot(queue);
    }

    /**
     * Everything one change has to push, resolved in a single reading of the line.
     *
     * <p>Pure read: the change has already been applied and committed by the time this runs.
     *
     * <p>The board and every watching customer are derived from the same two lists, so a broadcast
     * costs a fixed handful of queries however many people are watching. Deriving them one by one
     * instead would re-read the whole waiting list once per watcher - quadratic in the length of the
     * line, on the one connection every instance shares.
     *
     * @param withBoard    whether any staff member is watching the panel
     * @param ticketTokens the customers currently watching their own ticket
     */
    @Transactional(readOnly = true)
    public QueueBroadcast readBroadcast(UUID queueId, boolean withBoard, Set<UUID> ticketTokens) {
        if (!withBoard && ticketTokens.isEmpty()) {
            return QueueBroadcast.empty();
        }

        ServiceQueue queue = load(queueId);
        List<QueueEntry> waiting = entryRepository
                .findAllByQueueIdAndStatusOrderByOrderKeyAscJoinedAtAsc(queueId, EntryStatus.WAITING);
        List<QueueEntry> inService = entryRepository
                .findAllByQueueIdAndStatusInOrderByOrderKeyAscJoinedAtAsc(queueId, IN_SERVICE);
        EstimationService.ServiceTimeEstimate estimate = estimationService.averageServiceTime(queue);

        QueueSnapshot board = withBoard ? viewFactory.snapshot(queue, waiting, inService, estimate) : null;
        return new QueueBroadcast(board, ticketViews(queue, waiting, inService, estimate, ticketTokens));
    }

    /**
     * One ticket view per token, all read off the lists already in hand.
     *
     * <p>A customer's position <em>is</em> their index in the waiting list, so the list is walked once
     * into a lookup table rather than searched once per ticket. Tokens still missing after that belong
     * to people who have already left the line - they are fetched together, in one query.
     */
    private Map<UUID, TicketView> ticketViews(ServiceQueue queue, List<QueueEntry> waiting,
                                              List<QueueEntry> inService,
                                              EstimationService.ServiceTimeEstimate estimate,
                                              Set<UUID> ticketTokens) {
        if (ticketTokens.isEmpty()) {
            return Map.of();
        }

        Map<UUID, QueueEntry> byToken = HashMap.newHashMap(waiting.size() + inService.size());
        Map<UUID, Integer> peopleAhead = HashMap.newHashMap(waiting.size());
        for (int index = 0; index < waiting.size(); index++) {
            QueueEntry entry = waiting.get(index);
            byToken.put(entry.getTicketToken(), entry);
            peopleAhead.put(entry.getTicketToken(), index);
        }
        for (QueueEntry entry : inService) {
            byToken.put(entry.getTicketToken(), entry);
        }

        Set<UUID> departed = new HashSet<>(ticketTokens);
        departed.removeAll(byToken.keySet());
        if (!departed.isEmpty()) {
            for (QueueEntry entry : entryRepository.findAllByTicketTokenIn(departed)) {
                byToken.put(entry.getTicketToken(), entry);
            }
        }

        Map<UUID, TicketView> views = HashMap.newHashMap(ticketTokens.size());
        for (UUID token : ticketTokens) {
            QueueEntry entry = byToken.get(token);
            // A token can disappear between subscribing and broadcasting; that stream is about to close.
            if (entry != null) {
                views.put(token, viewFactory.ticketView(queue, entry, peopleAhead.get(token),
                        inService.size(), estimate.duration()));
            }
        }
        return views;
    }

    /** What a customer sees right after scanning the QR. No authentication, no personal data. */
    @Transactional
    public PublicQueueView publicView(UUID queueId) {
        if (graceService.expireDueIfAny(queueId)) {
            publisher.publishEvent(new QueueChangedEvent(queueId));
        }
        ServiceQueue queue = load(queueId);
        int waiting = (int) entryRepository.countByQueueIdAndStatus(queueId, EntryStatus.WAITING);
        int inService = (int) entryRepository.countByQueueIdAndStatusIn(queueId, IN_SERVICE);
        return viewFactory.publicView(queue, waiting, inService);
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
                queue.getId(), IN_SERVICE);
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
        if (command.requirePartySize() != null) {
            queue.setRequirePartySize(command.requirePartySize());
        }
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
        if (command.requirePartySize() != null) {
            queue.setRequirePartySize(command.requirePartySize());
        }
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
