package ar.edu.itba.cloud.queue.realtime;

import ar.edu.itba.cloud.queue.service.QueueService;
import ar.edu.itba.cloud.queue.service.model.QueueBroadcast;
import ar.edu.itba.cloud.queue.service.event.QueueChangedEvent;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * Functionality 2: pushes the new state of a queue to everyone watching it.
 *
 * <p>Runs after commit so subscribers can never be shown a change that did not stick. Staff receive
 * the whole board; each customer receives only their own ticket, recomputed individually because a
 * single movement changes everyone's position behind it.
 */
@Component
public class RealtimeBroadcaster {

    public static final String QUEUE_EVENT = "queue.updated";
    public static final String TICKET_EVENT = "ticket.updated";

    private static final Logger log = LoggerFactory.getLogger(RealtimeBroadcaster.class);

    private final SseHub hub;
    private final QueueService queueService;

    public RealtimeBroadcaster(SseHub hub, QueueService queueService) {
        this.hub = hub;
        this.queueService = queueService;
    }

    /** Entry point for the single-instance transport, which delivers after commit. */
    @TransactionalEventListener(fallbackExecution = true)
    @Transactional(propagation = Propagation.REQUIRES_NEW, readOnly = true)
    public void onQueueChanged(QueueChangedEvent event) {
        push(event.queueId());
    }

    /**
     * Entry point for the PostgreSQL transport. Already past commit by definition, since the database
     * withholds a notification until then.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW, readOnly = true)
    public void broadcast(UUID queueId) {
        push(queueId);
    }

    /** Whether this instance holds any connection that would care about this queue. */
    public boolean hasSubscribers(UUID queueId) {
        return hub.hasStaffSubscribers(queueId) || !hub.subscribedTickets(queueId).isEmpty();
    }

    private void push(UUID queueId) {
        boolean staffWatching = hub.hasStaffSubscribers(queueId);
        Set<UUID> ticketTokens = hub.subscribedTickets(queueId);

        // Most instances hold no connection for most queues. Returning here costs nothing - with
        // delayed connection acquisition, a read-only transaction that issues no query never takes
        // one from the pool.
        if (!staffWatching && ticketTokens.isEmpty()) {
            return;
        }

        QueueBroadcast payload;
        try {
            payload = queueService.readBroadcast(queueId, ticketTokens, staffWatching);
        } catch (Exception ex) {
            log.debug("Could not assemble broadcast for queue {}: {}", queueId, ex.getMessage());
            return;
        }

        if (payload.snapshot() != null) {
            hub.sendToStaff(queueId, QUEUE_EVENT, payload.snapshot());
        }
        payload.tickets().forEach(
                (token, view) -> hub.sendToTicket(queueId, token, TICKET_EVENT, view));
    }
}
