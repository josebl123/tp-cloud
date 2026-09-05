package ar.edu.itba.cloud.queue.persistence.repository;

import ar.edu.itba.cloud.queue.persistence.entity.ServiceQueue;
import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ServiceQueueRepository extends JpaRepository<ServiceQueue, UUID> {

    List<ServiceQueue> findAllByEstablishmentIdOrderByNameAsc(UUID establishmentId);
    List<ServiceQueue> findAllByEstablishmentIdAndArchivedAtIsNullOrderByNameAsc(UUID establishmentId);

    @Query("select q from ServiceQueue q join fetch q.establishment where q.id = :id")
    Optional<ServiceQueue> findByIdWithEstablishment(@Param("id") UUID id);

    /**
     * Locks the queue row for the duration of the transaction. Every mutation that allocates a ticket
     * number, an order key, or picks "the next customer" goes through here, which serialises those
     * operations per queue and keeps two staff members from calling the same person.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select q from ServiceQueue q where q.id = :id")
    Optional<ServiceQueue> findByIdForUpdate(@Param("id") UUID id);
}
