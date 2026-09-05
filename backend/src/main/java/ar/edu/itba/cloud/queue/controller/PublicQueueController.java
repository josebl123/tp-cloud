package ar.edu.itba.cloud.queue.controller;

import ar.edu.itba.cloud.queue.controller.dto.JoinQueueRequest;
import ar.edu.itba.cloud.queue.service.QrCodeService;
import ar.edu.itba.cloud.queue.service.QueueEntryService;
import ar.edu.itba.cloud.queue.service.QueueService;
import ar.edu.itba.cloud.queue.service.model.PublicQueueView;
import ar.edu.itba.cloud.queue.service.model.QueueAvailabilityView;
import ar.edu.itba.cloud.queue.service.model.TicketView;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirements;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.net.URI;
import java.time.Duration;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Functionality 1: what happens after scanning the QR.
 *
 * <p>No authentication. A queue id is public by design - it is printed on a poster - and nothing here
 * exposes another customer's data.
 */
@RestController
@RequestMapping("/api/v1/public/queues")
@Tag(name = "Queues (public)", description = "Anonymous customer access to a queue")
@SecurityRequirements
public class PublicQueueController {

    private final QueueService queueService;
    private final QueueEntryService entryService;
    private final QrCodeService qrCodeService;

    public PublicQueueController(QueueService queueService,
                                 QueueEntryService entryService,
                                 QrCodeService qrCodeService) {
        this.queueService = queueService;
        this.entryService = entryService;
        this.qrCodeService = qrCodeService;
    }

    @GetMapping("/{queueId}")
    @Operation(summary = "Queue landing page: how many are waiting and how long it looks like")
    public PublicQueueView get(@PathVariable UUID queueId) {
        return queueService.publicView(queueId);
    }

    @GetMapping("/{queueId}/availability")
    @Operation(summary = "Quote availability and wait for a group size without joining")
    public QueueAvailabilityView availability(@PathVariable UUID queueId, @RequestParam int partySize) {
        return queueService.availability(queueId, partySize);
    }

    @GetMapping(value = "/{queueId}/qr", produces = MediaType.IMAGE_PNG_VALUE)
    @Operation(summary = "PNG of the QR code for this queue, ready to print")
    public ResponseEntity<byte[]> qr(@PathVariable UUID queueId,
                                     @RequestParam(defaultValue = "512") int size) {
        byte[] png = qrCodeService.pngFor(queueService.joinUrl(queueId), size);
        return ResponseEntity.ok()
                .contentType(MediaType.IMAGE_PNG)
                .cacheControl(CacheControl.maxAge(Duration.ofHours(1)).cachePublic())
                .body(png);
    }

    @PostMapping("/{queueId}/entries")
    @Operation(summary = "Join the queue",
            description = """
                    Returns the personal ticket. The same link is also delivered to the contact
                    channel supplied, which is how a customer gets back to their place after closing
                    the browser or changing device.
                    """)
    public ResponseEntity<TicketView> join(
            @PathVariable UUID queueId,
            @Valid @RequestBody JoinQueueRequest request,
            @RequestHeader(value = HttpHeaders.ACCEPT_LANGUAGE, required = false) String acceptLanguage) {
        TicketView ticket = entryService.join(queueId, request.toCommand(acceptLanguage));
        return ResponseEntity
                .created(URI.create("/api/v1/public/tickets/" + ticket.ticketToken()))
                .body(ticket);
    }
}
