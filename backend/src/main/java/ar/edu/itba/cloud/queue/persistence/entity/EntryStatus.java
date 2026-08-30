package ar.edu.itba.cloud.queue.persistence.entity;

import java.util.Set;

/**
 * State of a customer inside a queue.
 *
 * <pre>
 *   WAITING --call--&gt; CALLED --start--&gt; SERVING --finish--&gt; SERVED
 *      |                 |  |                  |
 *      |                 |  +--grace expires--&gt; NO_SHOW (policy REMOVE)
 *      |                 |  +--grace expires--&gt; WAITING (policies KEEP_POSITION / MOVE_BACK / MOVE_TO_END)
 *      |                 +--requeue--&gt; WAITING
 *      +--customer leaves / staff cancels--&gt; LEFT
 * </pre>
 */
public enum EntryStatus {
    WAITING,
    CALLED,
    SERVING,
    SERVED,
    LEFT,
    NO_SHOW;

    private static final Set<EntryStatus> ACTIVE = Set.of(WAITING, CALLED, SERVING);

    /** True while the customer still occupies a place in the line. */
    public boolean isActive() {
        return ACTIVE.contains(this);
    }

    /** True once the customer has left the line for good. */
    public boolean isTerminal() {
        return !isActive();
    }

    /** Statuses that still hold a place in the line. */
    public static Set<EntryStatus> active() {
        return ACTIVE;
    }
}
