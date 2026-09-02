package ar.edu.itba.cloud.queue.service;

import ar.edu.itba.cloud.queue.exception.NotFoundException;
import ar.edu.itba.cloud.queue.persistence.entity.EntryStatus;
import ar.edu.itba.cloud.queue.persistence.entity.QueueEntry;
import ar.edu.itba.cloud.queue.persistence.entity.ServiceQueue;
import ar.edu.itba.cloud.queue.persistence.repository.QueueEntryRepository;
import ar.edu.itba.cloud.queue.persistence.repository.ServiceQueueRepository;
import ar.edu.itba.cloud.queue.service.event.QueueChangedEvent;
import ar.edu.itba.cloud.queue.service.model.NotificationView;
import ar.edu.itba.cloud.queue.service.model.TicketView;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Functionality 2: what a customer sees while they wait.
 *
 * <p>The ticket token in the link is the whole authorisation story here - it is unguessable, scoped to
 * one entry, and reveals nothing about anyone else in the line.
 */
@Service
public class TicketService {

    private final QueueEntryRepository entryRepository;
    private final ServiceQueueRepository queueRepository;
    private final GraceService graceService;
    private final EstimationService estimationService;
    private final QueueViewFactory viewFactory;
    private final NotificationService notificationService;
    private final ApplicationEventPublisher publisher;

    public TicketService(QueueEntryRepository entryRepository,
                         ServiceQueueRepository queueRepository,
                         GraceService graceService,
                         EstimationService estimationService,
                         QueueViewFactory viewFactory,
                         NotificationService notificationService,
                         ApplicationEventPublisher publisher) {
        this.entryRepository = entryRepository;
        this.queueRepository = queueRepository;
        this.graceService = graceService;
        this.estimationService = estimationService;
        this.viewFactory = viewFactory;
        this.notificationService = notificationService;
        this.publisher = publisher;
    }

    /**
     * Current state of a ticket, expiring any overdue grace period first so a customer is never shown
     * a call the clock has already invalidated.
     */
    @Transactional
    public TicketView get(UUID ticketToken) {
        UUID queueId = entryRepository.findQueueIdByTicketToken(ticketToken)
                .orElseThrow(NotFoundException::ticket);
        ServiceQueue queue = queueRepository.findByIdForUpdate(queueId)
                .orElseThrow(() -> NotFoundException.queue(queueId));

        if (graceService.expireDue(queue)) {
            publisher.publishEvent(new QueueChangedEvent(queueId));
        }

        QueueEntry entry = entryRepository.findByTicketToken(ticketToken).orElseThrow(NotFoundException::ticket);
        return build(queue, entry);
    }

    /** Pure read, used when pushing updates to subscribers after a change has already been applied. */
    @Transactional(readOnly = true)
    public TicketView read(UUID ticketToken) {
        QueueEntry entry = entryRepository.findByTicketToken(ticketToken).orElseThrow(NotFoundException::ticket);
        return build(entry.getQueue(), entry);
    }

    /** Functionality 3: the customer's own notification history. */
    @Transactional(readOnly = true)
    public List<NotificationView> notifications(UUID ticketToken) {
        QueueEntry entry = entryRepository.findByTicketToken(ticketToken).orElseThrow(NotFoundException::ticket);
        return notificationService.forEntry(entry.getId());
    }

    private TicketView build(ServiceQueue queue, QueueEntry entry) {
        Duration average = estimationService.averageServiceTime(queue).duration();
        if (entry.getStatus() != EntryStatus.WAITING) return viewFactory.ticketView(entry, null);
        List<QueueEntry> waiting = entryRepository.findAllByQueueIdAndStatusOrderByOrderKeyAscJoinedAtAsc(queue.getId(), EntryStatus.WAITING);
        List<QueueEntry> inService = entryRepository.findAllByQueueIdAndStatusInOrderByOrderKeyAscJoinedAtAsc(queue.getId(),
                List.of(EntryStatus.CALLED, EntryStatus.SERVING));
        return viewFactory.ticketView(entry, estimationService.estimate(queue, waiting, inService, entry, average));
    }
}
