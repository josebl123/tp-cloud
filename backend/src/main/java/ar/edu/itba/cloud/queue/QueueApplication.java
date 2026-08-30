package ar.edu.itba.cloud.queue;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * Q (Queue) - cloud queue-management platform.
 *
 * <p>Layering is strict: {@code persistence} owns entities and repositories, {@code service} owns all
 * business rules and is the only layer that touches entities, and {@code controller} only translates
 * HTTP to and from the service layer.
 */
@SpringBootApplication
@ConfigurationPropertiesScan
@EnableScheduling
public class QueueApplication {

    public static void main(String[] args) {
        SpringApplication.run(QueueApplication.class, args);
    }
}
