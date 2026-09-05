package ar.edu.itba.cloud.queue.realtime;

import java.util.UUID;

/**
 * What travels on the notification channel: which queue moved, and which instance moved it.
 *
 * <p>Kept as a tiny value with its own encoding so the wire format is one readable thing rather than
 * string handling spread across the sender and the receiver.
 *
 * <p>PostgreSQL caps a notification payload at 8000 bytes; two UUIDs and a separator are nowhere near
 * it. The separator is a character that cannot occur in a UUID, so parsing needs no escaping.
 *
 * @param queueId the queue whose line changed
 * @param origin  the {@code InstanceId} of the instance that made the change
 */
public record QueueChangeNotification(UUID queueId, String origin) {

    private static final char SEPARATOR = '|';

    public QueueChangeNotification {
        if (queueId == null) {
            throw new IllegalArgumentException("queueId is required");
        }
        if (origin == null || origin.isBlank() || origin.indexOf(SEPARATOR) >= 0) {
            throw new IllegalArgumentException("origin must be present and must not contain '|'");
        }
    }

    public String encode() {
        return queueId + String.valueOf(SEPARATOR) + origin;
    }

    /**
     * Reads a payload back.
     *
     * @return null when the payload is malformed - an unreadable announcement is dropped rather than
     *         allowed to kill the thread that listens for all of them
     */
    public static QueueChangeNotification decode(String payload) {
        if (payload == null) {
            return null;
        }
        int separator = payload.indexOf(SEPARATOR);
        if (separator <= 0 || separator == payload.length() - 1) {
            return null;
        }
        try {
            return new QueueChangeNotification(
                    UUID.fromString(payload.substring(0, separator)),
                    payload.substring(separator + 1));
        } catch (IllegalArgumentException ex) {
            return null;
        }
    }

    /** True when this instance is the one that produced the change, and has already pushed it. */
    public boolean isFrom(String instanceId) {
        return origin.equals(instanceId);
    }
}
