package ar.edu.itba.cloud.queue.service.model;

import ar.edu.itba.cloud.queue.persistence.entity.MembershipRole;
import java.time.Instant;
import java.util.UUID;

public record MemberView(
        UUID membershipId,
        UUID userId,
        String email,
        String displayName,
        MembershipRole role,
        Instant joinedAt) {
}
