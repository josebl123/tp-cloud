package ar.edu.itba.cloud.queue.controller;

import ar.edu.itba.cloud.queue.realtime.RealtimeBroadcaster;
import ar.edu.itba.cloud.queue.realtime.SseHub;
import ar.edu.itba.cloud.queue.security.AuthenticatedUser;
import ar.edu.itba.cloud.queue.security.CurrentUser;
import ar.edu.itba.cloud.queue.service.QueueService;
import ar.edu.itba.cloud.queue.service.model.QueueSnapshot;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.UUID;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/** Live staff board. */
@RestController
@RequestMapping("/api/v1/queues")
@Tag(name = "Queues (staff)")
public class QueueStreamController {

    private final QueueService queueService;
    private final SseHub sseHub;

    public QueueStreamController(QueueService queueService, SseHub sseHub) {
        this.queueService = queueService;
        this.sseHub = sseHub;
    }

    @GetMapping(value = "/{queueId}/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    @Operation(summary = "Live board over Server-Sent Events",
            description = """
                    Emits a `queue.updated` event with the same payload as `GET /{queueId}/board`
                    whenever the line moves, plus the current board immediately on connect.

                    The browser `EventSource` API cannot set an Authorization header, so this endpoint
                    also accepts the token as `?access_token=...`.
                    """)
    public SseEmitter stream(@CurrentUser AuthenticatedUser user, @PathVariable UUID queueId) {
        // Reading the board first is also the authorisation check: a non-member never gets an emitter.
        QueueSnapshot snapshot = queueService.getSnapshot(user.id(), queueId);
        SseEmitter emitter = sseHub.subscribeStaff(queueId);
        sseHub.sendInitial(emitter, RealtimeBroadcaster.QUEUE_EVENT, snapshot);
        return emitter;
    }
}
