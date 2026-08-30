package ar.edu.itba.cloud.queue.integration;

import java.time.Instant;
import java.time.ZoneOffset;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.testcontainers.containers.PostgreSQLContainer;

/**
 * Shared test infrastructure: a real PostgreSQL and a clock the tests control.
 *
 * <p>The container is a bean, so Spring's context cache keeps a single instance alive for the whole
 * run instead of one per test class.
 */
@TestConfiguration(proxyBeanMethods = false)
public class TestSupportConfig {

    public static final Instant START = Instant.parse("2026-03-02T15:00:00Z");

    @Bean
    @ServiceConnection
    @SuppressWarnings("resource")
    public PostgreSQLContainer<?> postgresContainer() {
        return new PostgreSQLContainer<>("postgres:16-alpine");
    }

    /** Named differently from the production {@code clock} bean so it wins by {@code @Primary}. */
    @Bean
    @Primary
    public MutableClock testClock() {
        return new MutableClock(START, ZoneOffset.UTC);
    }

    @Bean
    public DatabaseCleaner databaseCleaner(org.springframework.jdbc.core.JdbcTemplate jdbcTemplate) {
        return new DatabaseCleaner(jdbcTemplate);
    }
}
