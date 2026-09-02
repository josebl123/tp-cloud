package ar.edu.itba.cloud.queue.controller;

import ar.edu.itba.cloud.queue.realtime.RealtimeBroadcaster;
import ar.edu.itba.cloud.queue.realtime.SseHub;
import ar.edu.itba.cloud.queue.service.QueueEntryService;
import ar.edu.itba.cloud.queue.service.TicketService;
import ar.edu.itba.cloud.queue.service.model.NotificationView;
import ar.edu.itba.cloud.queue.service.model.TicketView;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirements;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.List;
import java.util.UUID;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * Functionalities 2, 3 and 5: following your own turn, and giving it up.
 *
 * <p>The ticket token is the credential. It is unguessable, scoped to a single entry, and is the only
 * thing a customer ever has to keep.
 */
@RestController
@RequestMapping("/api/v1/public/tickets")
@Tag(name = "Tickets (public)", description = "A customer's own place in the line")
@SecurityRequirements
public class TicketController {

    private final TicketService ticketService;
    private final QueueEntryService entryService;
    private final SseHub sseHub;

    public TicketController(TicketService ticketService, QueueEntryService entryService, SseHub sseHub) {
        this.ticketService = ticketService;
        this.entryService = entryService;
        this.sseHub = sseHub;
    }

    @GetMapping("/{ticketToken}")
    @Operation(summary = "Current position, people ahead and estimated wait")
    public TicketView get(@PathVariable UUID ticketToken) {
        return ticketService.get(ticketToken);
    }

    @DeleteMapping("/{ticketToken}")
    @Operation(summary = "Leave the queue",
            description = """
                    Frees the place immediately so everyone behind moves up and their estimates stay
                    honest. The ticket itself is kept, marked as LEFT, for the audit trail.
                    """)
    public TicketView leave(@PathVariable UUID ticketToken) {
        return entryService.leave(ticketToken);
    }

    @GetMapping("/{ticketToken}/notifications")
    @Operation(summary = "Notifications sent to this customer, with delivery status")
    public List<NotificationView> notifications(@PathVariable UUID ticketToken) {
        return ticketService.notifications(ticketToken);
    }

    @GetMapping(value = "/{ticketToken}/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    @Operation(summary = "Live updates for this ticket over Server-Sent Events",
            description = """
                    Emits a `ticket.updated` event carrying the same payload as `GET /{ticketToken}`
                    whenever the line moves. The current state is pushed immediately on connect, so a
                    client never needs a separate first fetch.
                    """)
    public SseEmitter stream(@PathVariable UUID ticketToken, HttpServletResponse response) {
        Streams.prepare(response);
        TicketView current = ticketService.get(ticketToken);
        SseEmitter emitter = sseHub.subscribeTicket(current.queue().id(), ticketToken);
        sseHub.sendInitial(emitter, RealtimeBroadcaster.TICKET_EVENT, current);
        return emitter;
    }
}
