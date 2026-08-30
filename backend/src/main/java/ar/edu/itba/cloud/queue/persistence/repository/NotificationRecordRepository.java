package ar.edu.itba.cloud.queue.persistence.repository;

import ar.edu.itba.cloud.queue.persistence.entity.NotificationRecord;
import ar.edu.itba.cloud.queue.persistence.entity.NotificationType;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface NotificationRecordRepository extends JpaRepository<NotificationRecord, UUID> {

    boolean existsByEntryIdAndTypeAndCycle(UUID entryId, NotificationType type, int cycle);

    List<NotificationRecord> findAllByEntryIdOrderByCreatedAtAsc(UUID entryId);
}
