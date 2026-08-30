package ar.edu.itba.cloud.queue.service.command;

/** Self-service sign-up: creates the account, the establishment and an OWNER membership at once. */
public record RegisterCommand(
        String email,
        String password,
        String displayName,
        String establishmentName,
        String timezone) {
}
