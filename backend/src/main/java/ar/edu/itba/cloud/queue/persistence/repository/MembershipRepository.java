package ar.edu.itba.cloud.queue.persistence.repository;

import ar.edu.itba.cloud.queue.persistence.entity.Membership;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface MembershipRepository extends JpaRepository<Membership, UUID> {

    Optional<Membership> findByUserIdAndEstablishmentId(UUID userId, UUID establishmentId);

    @Query("""
            select m from Membership m
            join fetch m.establishment
            where m.user.id = :userId
            order by m.createdAt asc
            """)
    List<Membership> findAllByUserId(@Param("userId") UUID userId);

    @Query("""
            select m from Membership m
            join fetch m.user
            where m.establishment.id = :establishmentId
            order by m.createdAt asc
            """)
    List<Membership> findAllByEstablishmentId(@Param("establishmentId") UUID establishmentId);

    boolean existsByUserIdAndEstablishmentId(UUID userId, UUID establishmentId);
}
