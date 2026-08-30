package ar.edu.itba.cloud.queue.persistence.repository;

import ar.edu.itba.cloud.queue.persistence.entity.Establishment;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface EstablishmentRepository extends JpaRepository<Establishment, UUID> {

    @Query("""
            select m.establishment from Membership m
            where m.user.id = :userId
            order by m.establishment.name asc
            """)
    List<Establishment> findAllForUser(@Param("userId") UUID userId);
}
