package ar.edu.itba.cloud.queue.service.command;

/**
 * A customer joining a queue.
 *
 * <p>Name is mandatory and at least one of email or phone must be present: the contact channel is how
 * the personal ticket link and the turn alerts reach them.
 */
public record JoinCommand(String name, String email, String phone, Integer partySize) {
}
