package ar.edu.itba.cloud.queue.service.command;

import ar.edu.itba.cloud.queue.persistence.entity.SupportedLocale;

/**
 * A customer joining a queue.
 *
 * <p>Name is mandatory and at least one of email or phone must be present: the contact channel is how
 * the personal ticket link and the turn alerts reach them.
 *
 * <p>{@code locale} is resolved by the controller from the request body or the {@code Accept-Language}
 * header, and is remembered so later notifications match the language the customer joined in.
 */
public record JoinCommand(
        String name,
        String email,
        String phone,
        Integer partySize,
        SupportedLocale locale) {
}
