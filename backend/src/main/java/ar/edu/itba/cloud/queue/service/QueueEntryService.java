package ar.edu.itba.cloud.queue.service;

import ar.edu.itba.cloud.queue.exception.ConflictException;
import ar.edu.itba.cloud.queue.exception.NotFoundException;
import ar.edu.itba.cloud.queue.exception.ValidationException;
import ar.edu.itba.cloud.queue.realtime.RealtimeBus;
import ar.edu.itba.cloud.queue.persistence.entity.ActorType;
import ar.edu.itba.cloud.queue.persistence.entity.EntryStatus;
import ar.edu.itba.cloud.queue.persistence.entity.EventType;
import ar.edu.itba.cloud.queue.persistence.entity.QueueEntry;
import ar.edu.itba.cloud.queue.persistence.entity.QueueStatus;
import ar.edu.itba.cloud.queue.persistence.entity.ServiceQueue;
import ar.edu.itba.cloud.queue.persistence.repository.QueueEntryRepository;
import ar.edu.itba.cloud.queue.persistence.repository.ServiceQueueRepository;
import ar.edu.itba.cloud.queue.service.command.JoinCommand;
import ar.edu.itba.cloud.queue.service.model.EntryView;
import ar.edu.itba.cloud.queue.service.model.NotificationView;
import ar.edu.itba.cloud.queue.service.model.QueueEventView;
import ar.edu.itba.cloud.queue.service.model.TicketView;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Every movement of a customer through a queue.
 *
 * <p><strong>Concurrency.</strong> Each public method starts by taking a pessimistic write lock on the
 * queue row. That single lock is what makes the whole thing safe: two staff members pressing "call
 * next" at the same moment serialise instead of calling the same person twice, and simultaneous joins
 * cannot be handed the same ticket number.
 *
 * <p><strong>Ordering.</strong> Positions are never stored. The WAITING list sorted by order key is
 * the line, so a position can never disagree with reality.
 */
@Service
public class QueueEntryService {

    private final ServiceQueueRepository queueRepository;
    private final QueueEntryRepository entryRepository;
    private final QueueOrdering ordering;
    private final EstimationService estimationService;
    private final NotificationService notificationService;
    private final EventRecorder eventRecorder;
    private final GraceService graceService;
    private final QueueViewFactory viewFactory;
    private final AccessGuard accessGuard;
    private final RealtimeBus realtimeBus;
    private final QueueLaneService laneService;
    private final Clock clock;
    private final QueueEntrySelector selector;

    public QueueEntryService(ServiceQueueRepository queueRepository,
                             QueueEntryRepository entryRepository,
                             QueueOrdering ordering,
                             EstimationService estimationService,
                             NotificationService notificationService,
                             EventRecorder eventRecorder,
                             GraceService graceService,
                             QueueViewFactory viewFactory,
                             AccessGuard accessGuard,
                             RealtimeBus realtimeBus,
                             QueueLaneService laneService,
                             Clock clock,
                             QueueEntrySelector selector) {
        this.queueRepository = queueRepository;
        this.entryRepository = entryRepository;
        this.ordering = ordering;
        this.estimationService = estimationService;
        this.notificationService = notificationService;
        this.eventRecorder = eventRecorder;
        this.graceService = graceService;
        this.viewFactory = viewFactory;
        this.accessGuard = accessGuard;
        this.realtimeBus = realtimeBus;
        this.laneService = laneService;
        this.clock = clock;
        this.selector = selector;
    }

    // ---------------------------------------------------------------- customer

    /** Functionality 1: a customer scans the QR and takes a place in the line. */
    @Transactional
    public TicketView join(UUID queueId, JoinCommand command) {
        ServiceQueue queue = lockQueue(queueId);
        graceService.expireDue(queue);

        String name = requireText(command.name(), "CUSTOMER_NAME_REQUIRED", "A name is required");
        String email = normalizeEmail(command.email());
        String phone = normalizePhone(command.phone());
        if (email == null && phone == null) {
            throw new ValidationException("CONTACT_REQUIRED",
                    "An email address or a phone number is required so we can send you your ticket link");
        }
        if (!queue.acceptsNewEntries()) {
            throw new ConflictException("QUEUE_NOT_ACCEPTING",
                    "This queue is %s and is not taking new customers".formatted(
                            queue.getStatus().name().toLowerCase(Locale.ROOT)));
        }
        // A queue at a pharmacy or a bank has no notion of a party, and rejecting those joins would
        // narrow the product to restaurants. One person is the honest default, and it lands in the
        // legacy 1+ lane, so lane selection stays well defined either way.
        int partySize = command.partySize() == null ? 1 : command.partySize();
        var lane = laneService.select(queue, partySize);
        laneService.ensureCapacity(lane, partySize);

        long active = entryRepository.countByQueueIdAndStatusIn(queueId, EntryStatus.active());
        if (queue.getMaxSize() != null && active + 1 > queue.getMaxSize()) {
            throw new ConflictException("QUEUE_FULL", "This queue has reached its maximum size");
        }

        QueueEntry entry = new QueueEntry(queue, lane, UUID.randomUUID(), queue.allocateTicketNumber(),
                ordering.keyForEnd(queue), name, email, phone, partySize,
                command.locale(), clock.instant());
        entryRepository.save(entry);
        queueRepository.save(queue);

        eventRecorder.record(queueId, entry.getId(), EventType.ENTRY_JOINED, ActorType.CUSTOMER, null,
                "ticketNumber=%d".formatted(entry.getTicketNumber()));

        Context context = context(queue);
        EstimationService.Simulation simulation = estimationService.estimate(queue, context.waiting(), context.inService(), entry, context.averageService());
        int estimatedMinutes = EstimationService.toMinutes(simulation.estimatedWait());

        // The message that carries the personal follow-up link, which is how customers get back in.
        notificationService.ticketCreated(entry, simulation);

        afterChange(queue, context);
        return viewFactory.ticketView(entry, simulation);
    }

    /** Functionality 5: the customer gives up their place, freeing the line for everyone behind. */
    @Transactional
    public TicketView leave(UUID ticketToken) {
        UUID queueId = entryRepository.findQueueIdByTicketToken(ticketToken)
                .orElseThrow(NotFoundException::ticket);
        ServiceQueue queue = lockQueue(queueId);
        graceService.expireDue(queue);

        QueueEntry entry = entryRepository.findByTicketToken(ticketToken).orElseThrow(NotFoundException::ticket);
        if (entry.getStatus().isTerminal()) {
            throw new ConflictException("ENTRY_NOT_ACTIVE",
                    "This ticket is already %s".formatted(entry.getStatus().name().toLowerCase(Locale.ROOT)));
        }

        release(queue, entry, ActorType.CUSTOMER, null);
        Context context = afterChange(queue, null);
        return viewFactory.ticketView(entry, null);
    }

    // ------------------------------------------------------------------- staff

    /** Functionality 4: call whoever is at the front of the line. */
    @Transactional
    public EntryView callNext(UUID userId, UUID queueId) {
        ServiceQueue queue = lockQueue(queueId);
        accessGuard.requireMember(userId, queue.getEstablishment().getId());
        graceService.expireDue(queue);
        requireOperable(queue);

        List<QueueEntry> waiting = waitingList(queueId);
        if (waiting.isEmpty()) {
            throw new ConflictException("QUEUE_EMPTY", "There is nobody waiting in this queue");
        }

        QueueEntrySelector.Selection selected = selector.select(queue,
                selector.rotation(laneService.list(queue)), waiting, queue.getRoundRobinPosition());
        QueueEntry entry = selected.entry();
        if (queue.getCallStrategy() == ar.edu.itba.cloud.queue.persistence.entity.CallStrategy.ROUND_ROBIN) {
            queue.setRoundRobinPosition(selected.nextRoundRobinPosition());
            queueRepository.save(queue);
        }
        doCall(queue, entry, userId);
        Context context = afterChange(queue, null);
        return view(queue, entry, context);
    }

    @Transactional
    public EntryView callNext(UUID userId, UUID queueId, UUID laneId) {
        ServiceQueue queue = lockQueue(queueId);
        accessGuard.requireMember(userId, queue.getEstablishment().getId());
        graceService.expireDue(queue);
        requireOperable(queue);
        List<QueueEntry> waiting = entryRepository.findAllByQueueIdAndLaneIdAndStatusOrderByOrderKeyAscJoinedAtAsc(queueId, laneId, EntryStatus.WAITING);
        if (waiting.isEmpty()) throw new ConflictException("QUEUE_EMPTY", "There is nobody waiting in this lane");
        QueueEntry entry = waiting.getFirst();
        doCall(queue, entry, userId);
        return view(queue, entry, afterChange(queue, null));
    }

    /** Calls one specific customer, which is how staff skip ahead when someone is not around. */
    @Transactional
    public EntryView call(UUID userId, UUID entryId) {
        Locked locked = lockForEntry(userId, entryId);
        requireOperable(locked.queue());
        doCall(locked.queue(), locked.entry(), userId);
        Context context = afterChange(locked.queue(), null);
        return view(locked.queue(), locked.entry(), context);
    }

    /** The customer showed up and is now being attended. */
    @Transactional
    public EntryView startServing(UUID userId, UUID entryId) {
        Locked locked = lockForEntry(userId, entryId);
        QueueEntry entry = locked.entry();
        requireStatus(entry, EntryStatus.CALLED);

        entry.setStatus(EntryStatus.SERVING);
        entry.setServingStartedAt(clock.instant());
        entry.setGraceExpiresAt(null);
        entryRepository.save(entry);
        eventRecorder.record(locked.queue().getId(), entry.getId(), EventType.ENTRY_SERVING_STARTED,
                ActorType.STAFF, userId, null);

        Context context = afterChange(locked.queue(), null);
        return view(locked.queue(), entry, context);
    }

    /** Service finished. This is the measurement that feeds every future ETA. */
    @Transactional
    public EntryView markServed(UUID userId, UUID entryId) {
        Locked locked = lockForEntry(userId, entryId);
        QueueEntry entry = locked.entry();
        requireStatus(entry, EntryStatus.CALLED, EntryStatus.SERVING);

        Instant now = clock.instant();
        if (entry.getServingStartedAt() == null) {
            // Staff went straight from "called" to "done"; treat the call as the start so the
            // service time still contributes to the moving average.
            entry.setServingStartedAt(entry.getCalledAt() == null ? now : entry.getCalledAt());
        }
        entry.setStatus(EntryStatus.SERVED);
        entry.setFinishedAt(now);
        entry.setGraceExpiresAt(null);
        entryRepository.save(entry);
        eventRecorder.record(locked.queue().getId(), entry.getId(), EventType.ENTRY_SERVED,
                ActorType.STAFF, userId, null);

        Context context = afterChange(locked.queue(), null);
        return view(locked.queue(), entry, context);
    }

    /** Staff declares the customer absent without waiting for the grace period to run out. */
    @Transactional
    public EntryView markNoShow(UUID userId, UUID entryId) {
        Locked locked = lockForEntry(userId, entryId);
        QueueEntry entry = locked.entry();
        requireStatus(entry, EntryStatus.CALLED);

        graceService.apply(locked.queue(), entry, ActorType.STAFF, userId);
        Context context = afterChange(locked.queue(), null);
        return view(locked.queue(), entry, context);
    }

    /** Staff removes a customer from the line. */
    @Transactional
    public EntryView cancel(UUID userId, UUID entryId) {
        Locked locked = lockForEntry(userId, entryId);
        QueueEntry entry = locked.entry();
        if (entry.getStatus().isTerminal()) {
            throw new ConflictException("ENTRY_NOT_ACTIVE",
                    "This entry is already %s".formatted(entry.getStatus().name().toLowerCase(Locale.ROOT)));
        }

        release(locked.queue(), entry, ActorType.STAFF, userId);
        Context context = afterChange(locked.queue(), null);
        return view(locked.queue(), entry, context);
    }

    /**
     * Sends an entry back to WAITING.
     *
     * <p>Undoing a call keeps the customer's place; bringing back someone who had already left or been
     * marked absent puts them at the end, since their old order key no longer means anything.
     */
    @Transactional
    public EntryView requeue(UUID userId, UUID entryId) {
        Locked locked = lockForEntry(userId, entryId);
        ServiceQueue queue = locked.queue();
        QueueEntry entry = locked.entry();
        requireOperable(queue);

        if (entry.getStatus() == EntryStatus.WAITING) {
            throw new ConflictException("ALREADY_WAITING", "This entry is already waiting");
        }
        boolean wasTerminal = entry.getStatus().isTerminal();

        entry.setStatus(EntryStatus.WAITING);
        entry.setCalledAt(null);
        entry.setServingStartedAt(null);
        entry.setFinishedAt(null);
        entry.setGraceExpiresAt(null);
        entry.nextNotificationCycle();
        if (wasTerminal) {
            entry.setOrderKey(ordering.keyForEnd(queue));
            queueRepository.save(queue);
        }
        entryRepository.save(entry);
        eventRecorder.record(queue.getId(), entry.getId(), EventType.ENTRY_REQUEUED, ActorType.STAFF, userId,
                wasTerminal ? "placement=END" : "placement=KEEP_POSITION");

        Context context = afterChange(queue, null);
        return view(queue, entry, context);
    }

    /** Single entry point behind {@code PUT /entries/{id}/status}. */
    @Transactional
    public EntryView transition(UUID userId, UUID entryId, EntryStatus target) {
        return switch (target) {
            case CALLED -> call(userId, entryId);
            case SERVING -> startServing(userId, entryId);
            case SERVED -> markServed(userId, entryId);
            case NO_SHOW -> markNoShow(userId, entryId);
            case LEFT -> cancel(userId, entryId);
            case WAITING -> requeue(userId, entryId);
        };
    }

    /**
     * Releases everyone still in the line, used when a queue is closed. The queue must already be
     * locked by the caller.
     */
    public void releaseAllActive(ServiceQueue queue, UUID userId) {
        List<QueueEntry> active = entryRepository
                .findAllByQueueIdAndStatusInOrderByOrderKeyAscJoinedAtAsc(queue.getId(), EntryStatus.active());
        for (QueueEntry entry : active) {
            notificationService.queueClosed(entry);
            release(queue, entry, ActorType.STAFF, userId);
        }
    }

    // -------------------------------------------------------------- staff reads

    @Transactional(readOnly = true)
    public EntryView get(UUID userId, UUID entryId) {
        QueueEntry entry = entryRepository.findByIdWithQueue(entryId)
                .orElseThrow(() -> NotFoundException.entry(entryId));
        ServiceQueue queue = entry.getQueue();
        accessGuard.requireMember(userId, queue.getEstablishment().getId());
        return view(queue, entry, context(queue));
    }

    /** Functionality 3: the audit trail of one customer's pass through the queue. */
    @Transactional(readOnly = true)
    public List<QueueEventView> events(UUID userId, UUID entryId) {
        requireAccessToEntry(userId, entryId);
        return eventRecorder.forEntry(entryId);
    }

    /** Every notification aimed at one customer, with its delivery outcome. */
    @Transactional(readOnly = true)
    public List<NotificationView> notifications(UUID userId, UUID entryId) {
        requireAccessToEntry(userId, entryId);
        return notificationService.forEntry(entryId);
    }

    private void requireAccessToEntry(UUID userId, UUID entryId) {
        QueueEntry entry = entryRepository.findByIdWithQueue(entryId)
                .orElseThrow(() -> NotFoundException.entry(entryId));
        accessGuard.requireMember(userId, entry.getQueue().getEstablishment().getId());
    }

    // --------------------------------------------------------------- internals

    private void doCall(ServiceQueue queue, QueueEntry entry, UUID userId) {
        requireStatus(entry, EntryStatus.WAITING);
        Instant now = clock.instant();

        entry.setStatus(EntryStatus.CALLED);
        entry.setCalledAt(now);
        // A grace period of zero means the establishment does not want automatic no-shows at all.
        entry.setGraceExpiresAt(queue.getGracePeriodSeconds() > 0
                ? now.plusSeconds(queue.getGracePeriodSeconds())
                : null);
        entryRepository.save(entry);

        eventRecorder.record(queue.getId(), entry.getId(), EventType.ENTRY_CALLED, ActorType.STAFF, userId,
                "graceSeconds=%d".formatted(queue.getGracePeriodSeconds()));
        notificationService.yourTurn(entry);
    }

    private void release(ServiceQueue queue, QueueEntry entry, ActorType actorType, UUID actorId) {
        entry.setStatus(EntryStatus.LEFT);
        entry.setFinishedAt(clock.instant());
        entry.setGraceExpiresAt(null);
        entryRepository.save(entry);
        eventRecorder.record(queue.getId(), entry.getId(), EventType.ENTRY_LEFT, actorType, actorId, null);
    }

    /**
     * Re-reads the line after a change, fires the proximity alerts that the movement made due, and
     * tells anyone streaming that the queue moved.
     */
    private Context afterChange(ServiceQueue queue, Context precomputed) {
        Context context = precomputed != null ? precomputed : context(queue);
        notificationService.evaluateThresholds(queue, context.waiting(), context.inService(),
                context.averageService());
        realtimeBus.publish(queue.getId());
        return context;
    }

    private Context context(ServiceQueue queue) {
        List<QueueEntry> waiting = waitingList(queue.getId());
        List<QueueEntry> inService = entryRepository.findAllByQueueIdAndStatusInOrderByOrderKeyAscJoinedAtAsc(queue.getId(),
                List.of(EntryStatus.CALLED, EntryStatus.SERVING));
        Duration average = estimationService.averageServiceTime(queue).duration();
        return new Context(waiting, inService, average);
    }

    private EntryView view(ServiceQueue queue, QueueEntry entry, Context context) {
        if (entry.getStatus() != EntryStatus.WAITING) return viewFactory.staticEntryView(entry, context.inServiceCount());
        return viewFactory.entryView(entry, estimationService.estimate(queue, context.waiting(), context.inService(), entry, context.averageService()));
    }

    private List<QueueEntry> waitingList(UUID queueId) {
        return entryRepository.findAllByQueueIdAndStatusOrderByOrderKeyAscJoinedAtAsc(queueId, EntryStatus.WAITING);
    }

    private ServiceQueue lockQueue(UUID queueId) {
        return queueRepository.findByIdForUpdate(queueId).orElseThrow(() -> NotFoundException.queue(queueId));
    }

    /**
     * Takes the queue lock before reading the entry, so the entry is never read in a state another
     * transaction is in the middle of changing.
     */
    private Locked lockForEntry(UUID userId, UUID entryId) {
        UUID queueId = entryRepository.findQueueIdByEntryId(entryId)
                .orElseThrow(() -> NotFoundException.entry(entryId));
        ServiceQueue queue = lockQueue(queueId);
        accessGuard.requireMember(userId, queue.getEstablishment().getId());
        graceService.expireDue(queue);

        QueueEntry entry = entryRepository.findByIdWithQueue(entryId)
                .orElseThrow(() -> NotFoundException.entry(entryId));
        return new Locked(queue, entry);
    }

    private void requireOperable(ServiceQueue queue) {
        if (queue.getStatus() == QueueStatus.CLOSED || queue.getArchivedAt() != null) {
            throw new ConflictException("QUEUE_CLOSED", "This queue is closed");
        }
    }

    private static void requireStatus(QueueEntry entry, EntryStatus... allowed) {
        if (Arrays.stream(allowed).noneMatch(status -> status == entry.getStatus())) {
            throw new ConflictException("INVALID_TRANSITION",
                    "An entry in status %s cannot make this transition (expected one of %s)"
                            .formatted(entry.getStatus(), Arrays.toString(allowed)));
        }
    }

    private static int indexOf(List<QueueEntry> entries, UUID entryId) {
        for (int index = 0; index < entries.size(); index++) {
            if (entries.get(index).getId().equals(entryId)) {
                return index;
            }
        }
        return -1;
    }

    private static int indexOfLane(List<QueueEntry> entries, UUID entryId, UUID laneId) {
        int index = 0;
        for (QueueEntry entry : entries) {
            if (laneId == null || laneId.equals(entry.getLane() == null ? null : entry.getLane().getId())) {
                if (entry.getId().equals(entryId)) return index;
                // Position is always expressed in groups. Capacity mode only controls admission.
                index++;
            }
        }
        return -1;
    }

    private static String requireText(String value, String code, String message) {
        String trimmed = value == null ? null : value.trim();
        if (trimmed == null || trimmed.isEmpty()) {
            throw new ValidationException(code, message);
        }
        return trimmed;
    }

    private static String normalizeEmail(String email) {
        if (email == null || email.isBlank()) {
            return null;
        }
        return email.trim().toLowerCase(Locale.ROOT);
    }

    private static String normalizePhone(String phone) {
        if (phone == null || phone.isBlank()) {
            return null;
        }
        return phone.trim();
    }

    /** The state of a queue at one instant, gathered once and reused across a request. */
    private record Context(List<QueueEntry> waiting, List<QueueEntry> inService, Duration averageService) {
        int inServiceCount() { return inService.size(); }
    }

    private record Locked(ServiceQueue queue, QueueEntry entry) {
    }
}
