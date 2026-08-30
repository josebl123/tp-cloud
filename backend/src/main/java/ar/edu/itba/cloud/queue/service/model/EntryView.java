package ar.edu.itba.cloud.queue.service.model;

import ar.edu.itba.cloud.queue.persistence.entity.EntryStatus;
import java.time.Instant;
import java.util.UUID;

/**
 * Staff-facing view of one entry. Includes contact details, which staff need in order to reach the
 * customer; the customer-facing {@link TicketView} deliberately does not expose other people's data.
 */
public record EntryView(
        UUID id,
        UUID ticketToken,
        long ticketNumber,
        String customerName,
        String customerEmail,
        String customerPhone,
        Integer partySize,
        EntryStatus status,
        /** 1-based place in line; null unless WAITING. */
        Integer position,
        Integer peopleAhead,
        Integer estimatedWaitMinutes,
        int noShowCount,
        Instant joinedAt,
        Instant calledAt,
        Instant servingStartedAt,
        Instant finishedAt,
        Instant graceExpiresAt,
        /** Seconds left to show up before the no-show policy applies; null when not applicable. */
        Long graceSecondsRemaining) {
}
