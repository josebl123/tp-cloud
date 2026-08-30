package ar.edu.itba.cloud.queue.realtime;

import ar.edu.itba.cloud.queue.service.QueueService;
import ar.edu.itba.cloud.queue.service.TicketService;
import ar.edu.itba.cloud.queue.service.event.QueueChangedEvent;
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
    private final TicketService ticketService;

    public RealtimeBroadcaster(SseHub hub, QueueService queueService, TicketService ticketService) {
        this.hub = hub;
        this.queueService = queueService;
        this.ticketService = ticketService;
    }

    @TransactionalEventListener(fallbackExecution = true)
    @Transactional(propagation = Propagation.REQUIRES_NEW, readOnly = true)
    public void onQueueChanged(QueueChangedEvent event) {
        UUID queueId = event.queueId();

        if (hub.hasStaffSubscribers(queueId)) {
            try {
                hub.sendToStaff(queueId, QUEUE_EVENT, queueService.readSnapshot(queueId));
            } catch (Exception ex) {
                log.debug("Could not broadcast board for queue {}: {}", queueId, ex.getMessage());
            }
        }

        for (UUID ticketToken : hub.subscribedTickets(queueId)) {
            try {
                hub.sendToTicket(queueId, ticketToken, TICKET_EVENT, ticketService.read(ticketToken));
            } catch (Exception ex) {
                log.debug("Could not broadcast ticket {}: {}", ticketToken, ex.getMessage());
            }
        }
    }
}
