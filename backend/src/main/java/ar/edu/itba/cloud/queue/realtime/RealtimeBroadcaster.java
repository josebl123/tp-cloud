package ar.edu.itba.cloud.queue.realtime;

import ar.edu.itba.cloud.queue.service.QueueService;
import ar.edu.itba.cloud.queue.service.event.QueueChangedEvent;
import ar.edu.itba.cloud.queue.service.model.QueueBroadcast;
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
 * the whole board; each customer receives only their own ticket, because a single movement changes
 * everyone's position behind it.
 *
 * <p>All of those views come out of {@link QueueService#readBroadcast} in one transaction: the cost of
 * a broadcast is set by the length of the line, not by how many people are watching it. This class
 * then only writes bytes to sockets, and never touches the database while doing so.
 *
 * <p>Two things drive a push, and both end in {@link #broadcast}: the commit of a change made on this
 * instance, and {@link QueueChangeListener} relaying a change made on another one. An instance
 * therefore never waits on the database round trip to serve its own subscribers.
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

    /** A change committed on this instance. */
    @TransactionalEventListener(fallbackExecution = true)
    @Transactional(propagation = Propagation.REQUIRES_NEW, readOnly = true)
    public void onQueueChanged(QueueChangedEvent event) {
        broadcast(event.queueId());
    }

    /**
     * Pushes the current state of a queue to everyone this instance is holding a stream for.
     *
     * <p>Safe to call with nobody watching and safe to call from any thread: it returns immediately
     * when this instance has no subscribers for the queue, which is the common case once there are
     * several instances and each holds only its own share of the customers.
     */
    public void broadcast(UUID queueId) {
        boolean staffWatching = hub.hasStaffSubscribers(queueId);
        Set<UUID> ticketTokens = hub.subscribedTickets(queueId);
        if (!staffWatching && ticketTokens.isEmpty()) {
            return;
        }

        QueueBroadcast broadcast;
        try {
            broadcast = queueService.readBroadcast(queueId, staffWatching, ticketTokens);
        } catch (Exception ex) {
            log.debug("Could not read queue {} to broadcast it: {}", queueId, ex.getMessage());
            return;
        }

        if (broadcast.board() != null) {
            hub.sendToStaff(queueId, QUEUE_EVENT, broadcast.board());
        }
        // A subscriber that has gone away is dropped by the hub; it cannot stop the others.
        broadcast.tickets().forEach((token, view) -> hub.sendToTicket(queueId, token, TICKET_EVENT, view));
    }
}
