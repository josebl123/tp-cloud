package ar.edu.itba.cloud.queue.service.model;

/** Time window a metrics query covers, anchored to the establishment's local day. */
public enum MetricsRange {
    TODAY(1),
    LAST_7_DAYS(7);

    private final int days;

    MetricsRange(int days) {
        this.days = days;
    }

    public int days() {
        return days;
    }
}
