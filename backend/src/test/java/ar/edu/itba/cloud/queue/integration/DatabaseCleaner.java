package ar.edu.itba.cloud.queue.integration;

import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Resets the schema between tests.
 *
 * <p>Wrapping tests in a rolled-back transaction is not an option here: the code under test relies on
 * real commits (pessimistic locks, after-commit notification delivery), so the data has to be cleared
 * for real instead.
 */
public class DatabaseCleaner {

    private static final String TRUNCATE = """
            TRUNCATE TABLE notification_record, queue_event, queue_entry, service_queue,
                           membership, establishment, user_account
            RESTART IDENTITY CASCADE
            """;

    private final JdbcTemplate jdbcTemplate;

    public DatabaseCleaner(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public void clean() {
        jdbcTemplate.execute(TRUNCATE);
    }
}
