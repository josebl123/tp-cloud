package ar.edu.itba.cloud.queue.controller;

import ar.edu.itba.cloud.queue.controller.dto.CallRequest;
import ar.edu.itba.cloud.queue.controller.dto.QueueStatusRequest;
import ar.edu.itba.cloud.queue.controller.dto.UpdateQueueRequest;
import ar.edu.itba.cloud.queue.security.AuthenticatedUser;
import ar.edu.itba.cloud.queue.security.CurrentUser;
import ar.edu.itba.cloud.queue.service.MetricsService;
import ar.edu.itba.cloud.queue.service.QueueEntryService;
import ar.edu.itba.cloud.queue.service.QueueService;
import ar.edu.itba.cloud.queue.service.model.EntryView;
import ar.edu.itba.cloud.queue.service.model.MetricsRange;
import ar.edu.itba.cloud.queue.service.model.MetricsView;
import ar.edu.itba.cloud.queue.service.model.QueueEventView;
import ar.edu.itba.cloud.queue.service.model.QueueSnapshot;
import ar.edu.itba.cloud.queue.service.model.QueueView;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Functionality 4: everything the staff panel does with a queue. */
@RestController
@RequestMapping("/api/v1/queues")
@Tag(name = "Queues (staff)", description = "Configure and operate a queue")
public class QueueController {

    private final QueueService queueService;
    private final QueueEntryService entryService;
    private final MetricsService metricsService;

    public QueueController(QueueService queueService,
                           QueueEntryService entryService,
                           MetricsService metricsService) {
        this.queueService = queueService;
        this.entryService = entryService;
        this.metricsService = metricsService;
    }

    @GetMapping("/{queueId}")
    public QueueView get(@CurrentUser AuthenticatedUser user, @PathVariable UUID queueId) {
        return queueService.get(user.id(), queueId);
    }

    @PatchMapping("/{queueId}")
    @Operation(summary = "Update queue configuration (owner only)")
    public QueueView update(@CurrentUser AuthenticatedUser user,
                            @PathVariable UUID queueId,
                            @Valid @RequestBody UpdateQueueRequest request) {
        return queueService.update(user.id(), queueId, request.toCommand());
    }

    @DeleteMapping("/{queueId}")
    @Operation(summary = "Delete a queue and its history (owner only)")
    public ResponseEntity<Void> delete(@CurrentUser AuthenticatedUser user, @PathVariable UUID queueId) {
        queueService.delete(user.id(), queueId);
        return ResponseEntity.noContent().build();
    }

    @PutMapping("/{queueId}/status")
    @Operation(summary = "Open, pause or close the queue",
            description = """
                    PAUSED stops new customers from joining while staff keep working through the
                    people already in line. CLOSED additionally releases everyone still waiting and
                    notifies them, so nobody is left holding a place in a queue that stopped.
                    """)
    public QueueView changeStatus(@CurrentUser AuthenticatedUser user,
                                  @PathVariable UUID queueId,
                                  @Valid @RequestBody QueueStatusRequest request) {
        return queueService.changeStatus(user.id(), queueId, request.status());
    }

    @GetMapping("/{queueId}/board")
    @Operation(summary = "The live board with lane context and policy-aware estimated waits")
    public QueueSnapshot board(@CurrentUser AuthenticatedUser user, @PathVariable UUID queueId) {
        return queueService.getSnapshot(user.id(), queueId);
    }

    @PostMapping("/{queueId}/calls")
    @Operation(summary = "Call the next customer, or a specific one when entryId is supplied")
    public EntryView call(@CurrentUser AuthenticatedUser user,
                          @PathVariable UUID queueId,
                          @RequestBody(required = false) CallRequest request) {
        if (request == null || request.entryId() == null) {
            return request != null && request.laneId() != null
                    ? entryService.callNext(user.id(), queueId, request.laneId())
                    : entryService.callNext(user.id(), queueId);
        }
        return entryService.call(user.id(), request.entryId());
    }

    @GetMapping("/{queueId}/events")
    @Operation(summary = "Recent queue timeline, newest first")
    public List<QueueEventView> events(@CurrentUser AuthenticatedUser user,
                                       @PathVariable UUID queueId,
                                       @RequestParam(defaultValue = "50") int limit) {
        return queueService.events(user.id(), queueId, limit);
    }

    @GetMapping("/{queueId}/metrics")
    public MetricsView metrics(@CurrentUser AuthenticatedUser user,
                               @PathVariable UUID queueId,
                               @RequestParam(defaultValue = "TODAY") MetricsRange range) {
        return metricsService.forQueue(user.id(), queueId, range);
    }
}
