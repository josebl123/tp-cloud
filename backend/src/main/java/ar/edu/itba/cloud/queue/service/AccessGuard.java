package ar.edu.itba.cloud.queue.service;

import ar.edu.itba.cloud.queue.exception.ForbiddenException;
import ar.edu.itba.cloud.queue.persistence.entity.Membership;
import ar.edu.itba.cloud.queue.persistence.entity.MembershipRole;
import ar.edu.itba.cloud.queue.persistence.repository.MembershipRepository;
import java.util.UUID;
import org.springframework.stereotype.Service;

/**
 * Authorisation for staff-side requests.
 *
 * <p>Permissions are not global: a token proves who you are, membership proves what you may touch.
 * Every service method that reaches an establishment or a queue starts here.
 */
@Service
public class AccessGuard {

    private final MembershipRepository membershipRepository;

    public AccessGuard(MembershipRepository membershipRepository) {
        this.membershipRepository = membershipRepository;
    }

    /** Any role is enough: operating queues is the STAFF job. */
    public Membership requireMember(UUID userId, UUID establishmentId) {
        return membershipRepository.findByUserIdAndEstablishmentId(userId, establishmentId)
                .orElseThrow(ForbiddenException::notAMember);
    }

    /** Configuration and member management are restricted to the owner. */
    public Membership requireOwner(UUID userId, UUID establishmentId) {
        Membership membership = requireMember(userId, establishmentId);
        if (membership.getRole() != MembershipRole.OWNER) {
            throw ForbiddenException.ownerOnly();
        }
        return membership;
    }
}
