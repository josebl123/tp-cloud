package ar.edu.itba.cloud.queue.persistence.repository;

import ar.edu.itba.cloud.queue.persistence.entity.QueueEvent;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

public interface QueueEventRepository extends JpaRepository<QueueEvent, UUID> {

    List<QueueEvent> findAllByQueueIdOrderByOccurredAtDesc(UUID queueId, Pageable pageable);

    List<QueueEvent> findAllByEntryIdOrderByOccurredAtAsc(UUID entryId);
}
