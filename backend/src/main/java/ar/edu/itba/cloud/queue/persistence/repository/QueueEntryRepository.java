package ar.edu.itba.cloud.queue.persistence.repository;

import ar.edu.itba.cloud.queue.persistence.entity.EntryStatus;
import ar.edu.itba.cloud.queue.persistence.entity.QueueEntry;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface QueueEntryRepository extends JpaRepository<QueueEntry, UUID> {

    @Query("""
            select e from QueueEntry e
            join fetch e.queue q
            join fetch q.establishment
            where e.ticketToken = :token
            """)
    Optional<QueueEntry> findByTicketToken(@Param("token") UUID token);

    @Query("""
            select e from QueueEntry e
            join fetch e.queue q
            join fetch q.establishment
            where e.id = :id
            """)
    Optional<QueueEntry> findByIdWithQueue(@Param("id") UUID id);

    /**
     * Loads several tickets at once.
     *
     * <p>Used when broadcasting to the customers watching a queue: the ones still in the line are
     * already in memory from the board, and this fetches whatever handful is left in a single
     * statement rather than one per subscriber.
     */
    @Query("""
            select e from QueueEntry e
            join fetch e.queue q
            join fetch q.establishment
            where e.ticketToken in :tokens
            """)
    List<QueueEntry> findAllByTicketTokenIn(@Param("tokens") Collection<UUID> tokens);

    /**
     * Resolves which queue an entry belongs to without loading it.
     *
     * <p>Used to take the queue lock <em>before</em> reading the entry, so the entry is never read in
     * a state another transaction is about to change.
     */
    @Query("select e.queue.id from QueueEntry e where e.id = :entryId")
    Optional<UUID> findQueueIdByEntryId(@Param("entryId") UUID entryId);

    /** Same, for a customer arriving with nothing but their ticket token. */
    @Query("select e.queue.id from QueueEntry e where e.ticketToken = :token")
    Optional<UUID> findQueueIdByTicketToken(@Param("token") UUID token);

    /** The line itself: everyone still holding a place, in service order. */
    List<QueueEntry> findAllByQueueIdAndStatusInOrderByOrderKeyAscJoinedAtAsc(
            UUID queueId, Collection<EntryStatus> statuses);

    List<QueueEntry> findAllByQueueIdAndStatusOrderByOrderKeyAscJoinedAtAsc(UUID queueId, EntryStatus status);

    List<QueueEntry> findAllByQueueIdAndLaneIdAndStatusIn(UUID queueId, UUID laneId, Collection<EntryStatus> statuses);
    List<QueueEntry> findAllByQueueIdAndLaneIdAndStatusOrderByOrderKeyAscJoinedAtAsc(UUID queueId, UUID laneId, EntryStatus status);

    long countByQueueIdAndStatus(UUID queueId, EntryStatus status);

    long countByQueueIdAndStatusIn(UUID queueId, Collection<EntryStatus> statuses);
    long countByLaneIdAndStatusIn(UUID laneId, Collection<EntryStatus> statuses);

    /** Entries whose grace period has run out and still sit in CALLED. */
    /**
     * Whether anything in this queue is past its deadline.
     *
     * <p>Served by {@code ix_entry_grace}, and it takes no lock: this is what lets a read find out that
     * it has nothing to expire - the overwhelmingly common case - without serialising against every
     * other reader of the same queue.
     */
    boolean existsByQueueIdAndStatusAndGraceExpiresAtLessThanEqual(
            UUID queueId, EntryStatus status, Instant deadline);

    List<QueueEntry> findAllByQueueIdAndStatusAndGraceExpiresAtLessThanEqual(
            UUID queueId, EntryStatus status, Instant deadline);

    @Query("""
            select distinct e.queue.id from QueueEntry e
            where e.status = :status and e.graceExpiresAt <= :deadline
            """)
    List<UUID> findQueueIdsWithExpiredGrace(@Param("status") EntryStatus status,
                                            @Param("deadline") Instant deadline);

    @Query("""
            select distinct e.queue.id from QueueEntry e
            where e.status in :statuses
            """)
    List<UUID> findQueueIdsWithEntriesInStatus(@Param("statuses") Collection<EntryStatus> statuses);

    /** Most recent completed services, newest first, used to average the real service time. */
    @Query("""
            select new ar.edu.itba.cloud.queue.persistence.repository.EntryTimings(
                e.status, e.joinedAt, e.calledAt, e.servingStartedAt, e.finishedAt)
            from QueueEntry e
            where e.queue.id = :queueId
              and e.status = ar.edu.itba.cloud.queue.persistence.entity.EntryStatus.SERVED
              and e.servingStartedAt is not null
              and e.finishedAt is not null
            order by e.finishedAt desc
            """)
    List<EntryTimings> findRecentServiceTimings(@Param("queueId") UUID queueId, Pageable pageable);

    @Query("""
            select new ar.edu.itba.cloud.queue.persistence.repository.EntryTimings(
                e.status, e.joinedAt, e.calledAt, e.servingStartedAt, e.finishedAt)
            from QueueEntry e
            where e.queue.id = :queueId
              and e.finishedAt >= :from and e.finishedAt < :to
            """)
    List<EntryTimings> findFinishedTimingsByQueue(@Param("queueId") UUID queueId,
                                                  @Param("from") Instant from,
                                                  @Param("to") Instant to);

    @Query("""
            select new ar.edu.itba.cloud.queue.persistence.repository.EntryTimings(
                e.status, e.joinedAt, e.calledAt, e.servingStartedAt, e.finishedAt)
            from QueueEntry e
            where e.queue.establishment.id = :establishmentId
              and e.finishedAt >= :from and e.finishedAt < :to
            """)
    List<EntryTimings> findFinishedTimingsByEstablishment(@Param("establishmentId") UUID establishmentId,
                                                          @Param("from") Instant from,
                                                          @Param("to") Instant to);

    @Query("""
            select count(e) from QueueEntry e
            where e.queue.establishment.id = :establishmentId and e.status in :statuses
            """)
    long countByEstablishmentAndStatusIn(@Param("establishmentId") UUID establishmentId,
                                         @Param("statuses") Collection<EntryStatus> statuses);
}
