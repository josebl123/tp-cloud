package ar.edu.itba.cloud.queue.service.model;

import ar.edu.itba.cloud.queue.persistence.entity.EntryStatus;
import java.time.Instant;
import java.util.UUID;

/** What a customer sees about their own place in the line. */
public record TicketView(
        UUID ticketToken,
        long ticketNumber,
        String customerName,
        Integer partySize,
        EntryStatus status,
        Integer position,
        Integer peopleAhead,
        Integer estimatedWaitMinutes,
        int noShowCount,
        Instant joinedAt,
        Instant calledAt,
        Instant finishedAt,
        Instant graceExpiresAt,
        Long graceSecondsRemaining,
        QueueSummary queue,
        String ticketUrl) {
}
