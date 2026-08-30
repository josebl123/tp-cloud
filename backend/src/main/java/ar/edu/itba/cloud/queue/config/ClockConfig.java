package ar.edu.itba.cloud.queue.config;

import java.time.Clock;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * The whole application reads time through this bean rather than {@code Instant.now()}, which is what
 * makes grace periods and metrics windows testable without sleeping.
 */
@Configuration
public class ClockConfig {

    @Bean
    public Clock clock() {
        return Clock.systemUTC();
    }
}
