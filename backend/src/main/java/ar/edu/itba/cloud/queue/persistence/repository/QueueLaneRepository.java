package ar.edu.itba.cloud.queue.persistence.repository;

import ar.edu.itba.cloud.queue.persistence.entity.QueueLane;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface QueueLaneRepository extends JpaRepository<QueueLane, UUID> {
    List<QueueLane> findAllByQueueIdOrderByPriorityAscMinPartySizeAsc(UUID queueId);
    Optional<QueueLane> findByQueueIdAndName(UUID queueId, String name);
    @Query("select lane from QueueLane lane join fetch lane.queue where lane.id = :id")
    Optional<QueueLane> findByIdWithQueue(@Param("id") UUID id);
    long countByIdAndQueueId(UUID id, UUID queueId);
}
