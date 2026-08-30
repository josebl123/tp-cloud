package ar.edu.itba.cloud.queue.service.command;

import ar.edu.itba.cloud.queue.persistence.entity.MembershipRole;

/**
 * Adds a colleague to an establishment. An existing account is linked; an unknown email creates one
 * with the supplied password.
 */
public record AddMemberCommand(
        String email,
        String password,
        String displayName,
        MembershipRole role) {
}
