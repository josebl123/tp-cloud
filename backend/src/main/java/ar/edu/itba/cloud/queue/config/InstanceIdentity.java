package ar.edu.itba.cloud.queue.config;

import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.actuate.info.Info;
import org.springframework.boot.actuate.info.InfoContributor;
import org.springframework.stereotype.Component;

/**
 * Which instance is this?
 *
 * <p>Behind an Auto Scaling Group there is no single server any more, and "which one answered?"
 * becomes a question you need answered constantly - when reading logs, when checking that the load
 * balancer is actually distributing, and when demonstrating that a change made on one instance
 * reached a stream held by another.
 *
 * <p>The id is supplied by the environment ({@code INSTANCE_ID}, set from EC2 instance metadata at
 * boot) and degrades to the hostname and then to a random value, so it is always present and never a
 * reason for startup to fail.
 */
@Component
public class InstanceIdentity implements InfoContributor {

    private static final Logger log = LoggerFactory.getLogger(InstanceIdentity.class);

    private final String id;

    public InstanceIdentity(@Value("${INSTANCE_ID:}") String configuredId,
                            @Value("${HOSTNAME:}") String hostname) {
        this.id = resolve(configuredId, hostname);
        log.info("Instance identity: {}", this.id);
    }

    public String id() {
        return id;
    }

    @Override
    public void contribute(Info.Builder builder) {
        builder.withDetail("instance", Map.of("id", id));
    }

    private static String resolve(String configuredId, String hostname) {
        if (configuredId != null && !configuredId.isBlank()) {
            return configuredId.trim();
        }
        if (hostname != null && !hostname.isBlank()) {
            return hostname.trim();
        }
        try {
            return InetAddress.getLocalHost().getHostName();
        } catch (UnknownHostException ex) {
            // Never worth failing startup over; a random id still distinguishes instances.
            return "instance-" + UUID.randomUUID().toString().substring(0, 8);
        }
    }
}
