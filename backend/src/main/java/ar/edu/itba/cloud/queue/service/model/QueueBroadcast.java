package ar.edu.itba.cloud.queue.service.model;

import java.util.Map;
import java.util.UUID;

/**
 * Everything one queue change has to push, resolved from a single reading of the line.
 *
 * <p>Staff and customers see the same movement from two angles, so both are built together: reading
 * the line once and deriving every view from it keeps a broadcast at a fixed cost, no matter how many
 * people are watching.
 *
 * @param board   the staff board, or null when nobody is watching it
 * @param tickets ticket view by ticket token, one per watching customer
 */
public record QueueBroadcast(QueueSnapshot board, Map<UUID, TicketView> tickets) {

    private static final QueueBroadcast EMPTY = new QueueBroadcast(null, Map.of());

    public static QueueBroadcast empty() {
        return EMPTY;
    }
}
