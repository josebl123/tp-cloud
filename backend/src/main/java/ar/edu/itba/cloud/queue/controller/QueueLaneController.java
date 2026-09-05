package ar.edu.itba.cloud.queue.controller;

import ar.edu.itba.cloud.queue.controller.dto.QueueLaneRequest;
import ar.edu.itba.cloud.queue.exception.NotFoundException;
import ar.edu.itba.cloud.queue.persistence.entity.QueueLane;
import ar.edu.itba.cloud.queue.persistence.repository.QueueLaneRepository;
import ar.edu.itba.cloud.queue.persistence.repository.ServiceQueueRepository;
import ar.edu.itba.cloud.queue.security.AuthenticatedUser;
import ar.edu.itba.cloud.queue.security.CurrentUser;
import ar.edu.itba.cloud.queue.service.AccessGuard;
import ar.edu.itba.cloud.queue.service.QueueLaneService;
import ar.edu.itba.cloud.queue.service.model.QueueLaneView;
import jakarta.validation.Valid;
import java.time.Clock;
import java.util.List;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/queues/{queueId}/lanes")
public class QueueLaneController {
    private final ServiceQueueRepository queues;
    private final QueueLaneRepository lanes;
    private final QueueLaneService service;
    private final AccessGuard access;
    private final Clock clock;
    public QueueLaneController(ServiceQueueRepository queues, QueueLaneRepository lanes, QueueLaneService service,
                               AccessGuard access, Clock clock) {
        this.queues = queues;
        this.lanes = lanes;
        this.service = service;
        this.access = access;
        this.clock = clock;
    }

    @GetMapping
    public List<QueueLaneView> list(@CurrentUser AuthenticatedUser u, @PathVariable UUID queueId) {
        var queue = queue(queueId);
        access.requireMember(u.id(), queue.getEstablishment().getId());
        return service.list(queue).stream().map(this::view).toList();
    }

    @PostMapping
    public QueueLaneView create(@CurrentUser AuthenticatedUser user, @PathVariable UUID queueId,
                                @Valid @RequestBody QueueLaneRequest request) {
        var queue = queue(queueId);
        access.requireOwner(user.id(), queue.getEstablishment().getId());
        return view(service.create(queue, request.toCommand(), clock.instant()));
    }

    @PatchMapping("/{laneId}")
    public QueueLaneView update(@CurrentUser AuthenticatedUser user, @PathVariable UUID queueId,
                                @PathVariable UUID laneId, @Valid @RequestBody QueueLaneRequest request) {
        var queue = queue(queueId);
        access.requireOwner(user.id(), queue.getEstablishment().getId());
        var lane = lane(laneId);
        requireQueue(lane, queueId);
        return view(service.update(lane, request.toCommand()));
    }

    @DeleteMapping("/{laneId}")
    public ResponseEntity<Void> delete(@CurrentUser AuthenticatedUser user, @PathVariable UUID queueId,
                                       @PathVariable UUID laneId) {
        var queue = queue(queueId);
        access.requireOwner(user.id(), queue.getEstablishment().getId());
        var lane = lane(laneId);
        requireQueue(lane, queueId);
        service.delete(lane);
        return ResponseEntity.noContent().build();
    }

    private ar.edu.itba.cloud.queue.persistence.entity.ServiceQueue queue(UUID id) {
        return queues.findByIdWithEstablishment(id).orElseThrow(() -> NotFoundException.queue(id));
    }

    private QueueLane lane(UUID id) {
        return lanes.findByIdWithQueue(id).orElseThrow(() -> NotFoundException.queue(id));
    }

    private static void requireQueue(QueueLane lane, UUID queueId) {
        if (!lane.getQueue().getId().equals(queueId)) {
            throw NotFoundException.queue(queueId);
        }
    }

    private QueueLaneView view(QueueLane lane) {
        return new QueueLaneView(lane.getId(), lane.getName(), lane.getMinPartySize(), lane.getMaxPartySize(),
                lane.getPriority(), lane.getCapacityMode(), lane.getMaxSize(), lane.getTimeFactor(), lane.isActive());
    }
}
