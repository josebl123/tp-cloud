package ar.edu.itba.cloud.queue.config;

import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * Tells this JVM apart from the other instances behind the load balancer.
 *
 * <p>Live updates are announced to every instance through the database, and an instance has already
 * pushed its own change to its own subscribers by the time the announcement comes back to it. Stamping
 * the announcement with who made it is what lets the origin recognise and skip its own.
 *
 * <p>Generated per process rather than taken from the instance metadata, so it holds for a container,
 * a laptop and an EC2 instance alike, and cannot collide across restarts.
 */
@Component
public class InstanceId {

    private final String value = UUID.randomUUID().toString();

    public String value() {
        return value;
    }

    @Override
    public String toString() {
        return value;
    }
}
