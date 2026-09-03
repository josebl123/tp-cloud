package ar.edu.itba.cloud.queue.service.model;

import java.util.Map;
import java.util.UUID;

/**
 * Everything one queue change has to push out, assembled in a single pass.
 *
 * <p>A queue movement has to reach the staff board and every customer watching their own ticket.
 * Built naively that is one set of queries per subscriber, all of them asking the same questions
 * about the same queue. This carries the whole fan-out instead, so the database is asked once no
 * matter how many people are watching.
 *
 * @param snapshot the staff board, or null when no staff are connected to this queue
 * @param tickets  the view to push to each watching customer, keyed by their ticket token
 */
public record QueueBroadcast(QueueSnapshot snapshot, Map<UUID, TicketView> tickets) {
}
