package ar.edu.itba.cloud.queue.service;

import ar.edu.itba.cloud.queue.persistence.entity.ActorType;
import ar.edu.itba.cloud.queue.persistence.entity.EventType;
import ar.edu.itba.cloud.queue.persistence.entity.QueueEvent;
import ar.edu.itba.cloud.queue.persistence.repository.QueueEventRepository;
import ar.edu.itba.cloud.queue.service.model.QueueEventView;
import java.time.Clock;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Single writer of the queue timeline.
 *
 * <p>Every state change goes through here, which is what makes "los eventos quedan registrados" true
 * by construction rather than by remembering to log in each branch.
 */
@Service
public class EventRecorder {

    private static final int MAX_DETAIL_LENGTH = 500;

    private final QueueEventRepository repository;
    private final Clock clock;

    public EventRecorder(QueueEventRepository repository, Clock clock) {
        this.repository = repository;
        this.clock = clock;
    }

    public void record(UUID queueId, UUID entryId, EventType type, ActorType actorType, UUID actorId, String detail) {
        repository.save(new QueueEvent(queueId, entryId, type, actorType, actorId, truncate(detail), clock.instant()));
    }

    public void recordBySystem(UUID queueId, UUID entryId, EventType type, String detail) {
        record(queueId, entryId, type, ActorType.SYSTEM, null, detail);
    }

    @Transactional(readOnly = true)
    public List<QueueEventView> recentForQueue(UUID queueId, int limit) {
        return repository.findAllByQueueIdOrderByOccurredAtDesc(queueId, PageRequest.of(0, limit))
                .stream()
                .map(EventRecorder::toView)
                .toList();
    }

    @Transactional(readOnly = true)
    public List<QueueEventView> forEntry(UUID entryId) {
        return repository.findAllByEntryIdOrderByOccurredAtAsc(entryId)
                .stream()
                .map(EventRecorder::toView)
                .toList();
    }

    private static QueueEventView toView(QueueEvent event) {
        return new QueueEventView(event.getId(), event.getQueueId(), event.getEntryId(), event.getType(),
                event.getActorType(), event.getActorId(), event.getDetail(), event.getOccurredAt());
    }

    private static String truncate(String detail) {
        if (detail == null || detail.length() <= MAX_DETAIL_LENGTH) {
            return detail;
        }
        return detail.substring(0, MAX_DETAIL_LENGTH);
    }
}
