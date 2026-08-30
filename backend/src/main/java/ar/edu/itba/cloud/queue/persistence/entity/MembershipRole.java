package ar.edu.itba.cloud.queue.persistence.entity;

/** Role a user holds inside an establishment. */
public enum MembershipRole {
    /** Full control: queue configuration, member management. */
    OWNER,
    /** Day-to-day operation of the queues. */
    STAFF
}
