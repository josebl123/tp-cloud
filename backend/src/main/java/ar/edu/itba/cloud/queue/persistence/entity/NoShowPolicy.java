package ar.edu.itba.cloud.queue.persistence.entity;

/** What happens to a customer whose grace period expires after being called. */
public enum NoShowPolicy {
    /** Returns to WAITING keeping the original place in line. */
    KEEP_POSITION,
    /** Returns to WAITING a configurable number of positions further back. */
    MOVE_BACK,
    /** Returns to WAITING at the end of the line. */
    MOVE_TO_END,
    /** Leaves the queue permanently as NO_SHOW. */
    REMOVE
}
