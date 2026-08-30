package ar.edu.itba.cloud.queue.controller;

import ar.edu.itba.cloud.queue.controller.dto.AddMemberRequest;
import ar.edu.itba.cloud.queue.controller.dto.CreateQueueRequest;
import ar.edu.itba.cloud.queue.controller.dto.EstablishmentRequest;
import ar.edu.itba.cloud.queue.security.AuthenticatedUser;
import ar.edu.itba.cloud.queue.security.CurrentUser;
import ar.edu.itba.cloud.queue.service.EstablishmentService;
import ar.edu.itba.cloud.queue.service.MetricsService;
import ar.edu.itba.cloud.queue.service.QueueService;
import ar.edu.itba.cloud.queue.service.model.EstablishmentView;
import ar.edu.itba.cloud.queue.service.model.MemberView;
import ar.edu.itba.cloud.queue.service.model.MetricsRange;
import ar.edu.itba.cloud.queue.service.model.MetricsView;
import ar.edu.itba.cloud.queue.service.model.QueueView;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.net.URI;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/establishments")
@Tag(name = "Establishments", description = "Businesses, their staff and their queues")
public class EstablishmentController {

    private final EstablishmentService establishmentService;
    private final QueueService queueService;
    private final MetricsService metricsService;

    public EstablishmentController(EstablishmentService establishmentService,
                                   QueueService queueService,
                                   MetricsService metricsService) {
        this.establishmentService = establishmentService;
        this.queueService = queueService;
        this.metricsService = metricsService;
    }

    @GetMapping
    @Operation(summary = "Establishments the current user belongs to")
    public List<EstablishmentView> list(@CurrentUser AuthenticatedUser user) {
        return establishmentService.listForUser(user.id());
    }

    @PostMapping
    @Operation(summary = "Create an establishment owned by the current user")
    public ResponseEntity<EstablishmentView> create(@CurrentUser AuthenticatedUser user,
                                                    @Valid @RequestBody EstablishmentRequest request) {
        EstablishmentView created = establishmentService.create(user.id(), request.toCommand());
        return ResponseEntity.created(URI.create("/api/v1/establishments/" + created.id())).body(created);
    }

    @GetMapping("/{establishmentId}")
    public EstablishmentView get(@CurrentUser AuthenticatedUser user, @PathVariable UUID establishmentId) {
        return establishmentService.get(user.id(), establishmentId);
    }

    @PatchMapping("/{establishmentId}")
    @Operation(summary = "Update name or time zone (owner only)")
    public EstablishmentView update(@CurrentUser AuthenticatedUser user,
                                    @PathVariable UUID establishmentId,
                                    @Valid @RequestBody EstablishmentRequest request) {
        return establishmentService.update(user.id(), establishmentId, request.toCommand());
    }

    @GetMapping("/{establishmentId}/members")
    public List<MemberView> members(@CurrentUser AuthenticatedUser user, @PathVariable UUID establishmentId) {
        return establishmentService.listMembers(user.id(), establishmentId);
    }

    @PostMapping("/{establishmentId}/members")
    @Operation(summary = "Add a colleague, creating their account if the email is unknown (owner only)")
    public ResponseEntity<MemberView> addMember(@CurrentUser AuthenticatedUser user,
                                                @PathVariable UUID establishmentId,
                                                @Valid @RequestBody AddMemberRequest request) {
        MemberView created = establishmentService.addMember(user.id(), establishmentId, request.toCommand());
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

    @GetMapping("/{establishmentId}/queues")
    public List<QueueView> queues(@CurrentUser AuthenticatedUser user, @PathVariable UUID establishmentId) {
        return queueService.listForEstablishment(user.id(), establishmentId);
    }

    @PostMapping("/{establishmentId}/queues")
    @Operation(summary = "Create a queue, which is also a new QR code (owner only)")
    public ResponseEntity<QueueView> createQueue(@CurrentUser AuthenticatedUser user,
                                                 @PathVariable UUID establishmentId,
                                                 @Valid @RequestBody CreateQueueRequest request) {
        QueueView created = queueService.create(user.id(), establishmentId, request.toCommand());
        return ResponseEntity.created(URI.create("/api/v1/queues/" + created.id())).body(created);
    }

    @GetMapping("/{establishmentId}/metrics")
    @Operation(summary = "Aggregated metrics across every queue of the establishment")
    public MetricsView metrics(@CurrentUser AuthenticatedUser user,
                               @PathVariable UUID establishmentId,
                               @RequestParam(defaultValue = "TODAY") MetricsRange range) {
        return metricsService.forEstablishment(user.id(), establishmentId, range);
    }
}
