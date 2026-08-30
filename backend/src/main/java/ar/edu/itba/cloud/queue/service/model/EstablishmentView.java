package ar.edu.itba.cloud.queue.service.model;

import ar.edu.itba.cloud.queue.persistence.entity.MembershipRole;
import java.time.Instant;
import java.util.UUID;

public record EstablishmentView(
        UUID id,
        String name,
        String timezone,
        /** Role the requesting user holds here; null when the caller is not a member. */
        MembershipRole role,
        Instant createdAt) {
}
