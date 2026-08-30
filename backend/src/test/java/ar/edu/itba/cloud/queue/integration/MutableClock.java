package ar.edu.itba.cloud.queue.integration;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.concurrent.atomic.AtomicReference;

/**
 * A clock the tests can move by hand.
 *
 * <p>Grace periods and metrics windows are time-driven; without this they could only be tested by
 * sleeping. Zoned views share the same underlying instant, so advancing time is visible everywhere.
 */
public class MutableClock extends Clock {

    private final AtomicReference<Instant> instant;
    private final ZoneId zone;

    public MutableClock(Instant start, ZoneId zone) {
        this(new AtomicReference<>(start), zone);
    }

    private MutableClock(AtomicReference<Instant> instant, ZoneId zone) {
        this.instant = instant;
        this.zone = zone;
    }

    @Override
    public ZoneId getZone() {
        return zone;
    }

    @Override
    public Clock withZone(ZoneId otherZone) {
        return new MutableClock(instant, otherZone);
    }

    @Override
    public Instant instant() {
        return instant.get();
    }

    public void advance(Duration amount) {
        instant.updateAndGet(current -> current.plus(amount));
    }

    public void setInstant(Instant value) {
        instant.set(value);
    }
}
