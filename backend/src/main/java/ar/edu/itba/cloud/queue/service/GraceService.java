package ar.edu.itba.cloud.queue.service;

import ar.edu.itba.cloud.queue.persistence.entity.ActorType;
import ar.edu.itba.cloud.queue.persistence.entity.EntryStatus;
import ar.edu.itba.cloud.queue.persistence.entity.EventType;
import ar.edu.itba.cloud.queue.persistence.entity.NoShowPolicy;
import ar.edu.itba.cloud.queue.persistence.entity.QueueEntry;
import ar.edu.itba.cloud.queue.persistence.entity.ServiceQueue;
import ar.edu.itba.cloud.queue.persistence.repository.QueueEntryRepository;
import ar.edu.itba.cloud.queue.persistence.repository.ServiceQueueRepository;
import ar.edu.itba.cloud.queue.service.event.QueueChangedEvent;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Applies the establishment's no-show policy once a called customer's grace period runs out.
 *
 * <p>Expiry is evaluated in two places on purpose: a background sweep keeps the line moving when
 * nobody is looking, and every read of a queue or a ticket expires first, so a client can never be
 * shown a state the clock has already invalidated.
 *
 * <p>All methods here assume the caller already holds the pessimistic lock on the queue row.
 */
@Service
public class GraceService {

    private final QueueEntryRepository entryRepository;
    private final ServiceQueueRepository queueRepository;
    private final QueueOrdering ordering;
    private final EventRecorder eventRecorder;
    private final NotificationService notificationService;
    private final ApplicationEventPublisher publisher;
    private final Clock clock;

    public GraceService(QueueEntryRepository entryRepository,
                        ServiceQueueRepository queueRepository,
                        QueueOrdering ordering,
                        EventRecorder eventRecorder,
                        NotificationService notificationService,
                        ApplicationEventPublisher publisher,
                        Clock clock) {
        this.entryRepository = entryRepository;
        this.queueRepository = queueRepository;
        this.ordering = ordering;
        this.eventRecorder = eventRecorder;
        this.notificationService = notificationService;
        this.publisher = publisher;
        this.clock = clock;
    }

    /**
     * Takes the queue lock itself and expires whatever is due. This is the entry point for callers that
     * are not already inside a queue transaction, such as the background sweep.
     *
     * @return true when at least one entry changed
     */
    @Transactional
    public boolean expireQueue(UUID queueId) {
        ServiceQueue queue = queueRepository.findByIdForUpdate(queueId).orElse(null);
        if (queue == null) {
            return false;
        }
        if (!expireDue(queue)) {
            return false;
        }
        queueRepository.save(queue);
        publisher.publishEvent(new QueueChangedEvent(queueId));
        return true;
    }

    /**
     * Expires whatever is overdue in this queue, taking the queue lock only when there is something to
     * expire. For callers that are inside a transaction but hold no lock yet - every read path.
     *
     * <p>Reads have to expire before answering, or a customer would be shown a call the clock already
     * invalidated. Doing that by locking first made every reader of a queue queue up behind the same
     * exclusive row lock, on public endpoints that never write: the lock was taken, held for the rest
     * of the transaction, and released without a single row changing. Since expiry is rare and
     * {@code ix_entry_grace} answers "is anything overdue?" as a plain indexed read, asking first
     * costs one cheap query and keeps the lock on the rare path that actually mutates.
     *
     * @return true when at least one entry changed, so the caller knows to broadcast
     */
    public boolean expireDueIfAny(UUID queueId) {
        boolean anythingDue = entryRepository.existsByQueueIdAndStatusAndGraceExpiresAtLessThanEqual(
                queueId, EntryStatus.CALLED, clock.instant());
        if (!anythingDue) {
            return false;
        }
        // Re-checked under the lock by expireDue: another transaction may have got here first.
        ServiceQueue queue = queueRepository.findByIdForUpdate(queueId).orElse(null);
        return queue != null && expireDue(queue);
    }

    /**
     * Resolves every called customer whose deadline has passed.
     *
     * <p>The caller must already hold the queue lock.
     *
     * @return true when at least one entry changed, so the caller knows to broadcast
     */
    public boolean expireDue(ServiceQueue queue) {
        List<QueueEntry> expired = entryRepository
                .findAllByQueueIdAndStatusAndGraceExpiresAtLessThanEqual(
                        queue.getId(), EntryStatus.CALLED, clock.instant());
        if (expired.isEmpty()) {
            return false;
        }
        for (QueueEntry entry : expired) {
            apply(queue, entry, ActorType.SYSTEM, null);
        }
        return true;
    }

    /**
     * Applies the no-show policy to a single called entry.
     *
     * @return the customer's new 1-based position, or null when the policy removed them
     */
    public Integer apply(ServiceQueue queue, QueueEntry entry, ActorType actorType, UUID actorId) {
        Instant now = clock.instant();
        NoShowPolicy policy = queue.getNoShowPolicy();

        entry.incrementNoShowCount();
        entry.setGraceExpiresAt(null);

        Integer newPosition = null;
        if (policy == NoShowPolicy.REMOVE) {
            entry.setStatus(EntryStatus.NO_SHOW);
            entry.setFinishedAt(now);
        } else {
            // The line the entry is being placed back into, without the entry itself.
            List<QueueEntry> others = waitingExcluding(queue.getId(), entry.getId());

            entry.setStatus(EntryStatus.WAITING);
            entry.setCalledAt(null);
            entry.setServingStartedAt(null);
            entry.setFinishedAt(null);
            // A fresh pass through the line: proximity and turn alerts become eligible again.
            entry.nextNotificationCycle();

            switch (policy) {
                case KEEP_POSITION -> {
                    // The existing order key already puts them back where they were.
                }
                case MOVE_TO_END -> entry.setOrderKey(ordering.keyForEnd(queue));
                case MOVE_BACK -> entry.setOrderKey(
                        ordering.keyForPositionBack(queue, others, queue.getMoveBackPositions()));
                case REMOVE -> throw new IllegalStateException("Unreachable");
            }
            newPosition = positionAmong(others, entry);
        }

        entryRepository.save(entry);
        eventRecorder.record(queue.getId(), entry.getId(), EventType.ENTRY_NO_SHOW, actorType, actorId,
                "policy=%s noShowCount=%d".formatted(policy, entry.getNoShowCount()));
        notificationService.noShow(entry, policy, newPosition);
        return newPosition;
    }

    private List<QueueEntry> waitingExcluding(UUID queueId, UUID entryId) {
        return entryRepository
                .findAllByQueueIdAndStatusOrderByOrderKeyAscJoinedAtAsc(queueId, EntryStatus.WAITING)
                .stream()
                .filter(candidate -> !candidate.getId().equals(entryId))
                .toList();
    }

    /** 1-based position the entry lands on, given the rest of the line and its new order key. */
    private int positionAmong(List<QueueEntry> others, QueueEntry entry) {
        int ahead = 0;
        for (QueueEntry other : others) {
            if (other.getOrderKey() < entry.getOrderKey()) {
                ahead++;
            }
        }
        return ahead + 1;
    }
}
